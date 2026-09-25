import { Pool } from "pg";

/**
 * Ecom's durable record of a submitted connected order command.
 *
 * The receipt is the whole point of this store: a retried checkout must be
 * able to answer "did this order already reach the peer, and what did the peer
 * return?" after a restart, without a second write. `request_hash` is the hash
 * of the exact payload that was submitted, so a replay of the same key with a
 * different payload is a conflict rather than a silent second order.
 */
export type OrderCommandStatus = "pending" | "completed";

export interface OrderCommand {
  readonly order_id: string;
  readonly request_hash: string;
  readonly status: OrderCommandStatus;
  /** The peer's receipt, stored as JSON. Null while the command is pending. */
  readonly response: unknown;
  readonly created_at: string;
  readonly updated_at: string;
}

export type OrderReservation =
  | { readonly outcome: "reserved" }
  | { readonly outcome: "replay"; readonly response: unknown }
  | { readonly outcome: "conflict"; readonly reason: string };

/**
 * The narrow command surface a checkout needs. Two adapters implement it: an
 * in-memory one for tests and standalone use, and a PostgreSQL one for the
 * durable case. Neither is required for local checkout to work.
 */
export interface OrderCommandStore {
  /** Creates the backing schema if it is missing. Safe to call repeatedly. */
  ensureSchema(): Promise<void>;
  /**
   * Claims `orderId` for one attempt. Concurrent callers of the same id cannot
   * both be reserved: exactly one gets `reserved`, and the others get a
   * `replay` of the completed receipt or a `conflict` naming the reason.
   */
  reserve(orderId: string, requestHash: string): Promise<OrderReservation>;
  /** Stores the receipt. Fails when the id is not a pending reservation. */
  complete(orderId: string, response: unknown): Promise<void>;
  /**
   * Releases a pending reservation after a failed submission, so the caller can
   * retry the same id. A completed receipt is never released.
   */
  abort(orderId: string): Promise<void>;
  close(): Promise<void>;
}

function requireKey(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function requireHash(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Order command request hash must be a non-empty string");
  }
  return value;
}

/** Compares a stored command against the incoming one and names the outcome. */
function classify(
  existing: Pick<OrderCommand, "request_hash" | "status" | "response">,
  orderId: string,
  requestHash: string,
): OrderReservation {
  if (existing.request_hash !== requestHash) {
    return {
      outcome: "conflict",
      reason: `Order "${orderId}" was already recorded with a different request`,
    };
  }
  if (existing.status === "pending") {
    return {
      outcome: "conflict",
      reason: `Order "${orderId}" already has a submission in progress`,
    };
  }
  return { outcome: "replay", response: existing.response };
}

/** Process-local command store. Lost on restart, so it cannot prove durability. */
export class InMemoryOrderCommandStore implements OrderCommandStore {
  private readonly commands = new Map<string, OrderCommand>();

  async ensureSchema(): Promise<void> {
    // Nothing to create.
  }

  async reserve(orderId: string, requestHash: string): Promise<OrderReservation> {
    requireKey(orderId, "Order id");
    requireHash(requestHash);

    const existing = this.commands.get(orderId);
    if (existing === undefined) {
      const now = new Date().toISOString();
      this.commands.set(orderId, {
        order_id: orderId,
        request_hash: requestHash,
        status: "pending",
        response: null,
        created_at: now,
        updated_at: now,
      });
      return { outcome: "reserved" };
    }
    return classify(existing, orderId, requestHash);
  }

  async complete(orderId: string, response: unknown): Promise<void> {
    requireKey(orderId, "Order id");
    const existing = this.commands.get(orderId);
    if (existing === undefined || existing.status !== "pending") {
      throw new Error(`Order "${orderId}" has no pending submission to complete`);
    }
    this.commands.set(orderId, {
      ...existing,
      status: "completed",
      response,
      updated_at: new Date().toISOString(),
    });
  }

  async abort(orderId: string): Promise<void> {
    requireKey(orderId, "Order id");
    const existing = this.commands.get(orderId);
    // A completed receipt is the durable answer for this id; never discard it.
    if (existing?.status === "pending") {
      this.commands.delete(orderId);
    }
  }

  async close(): Promise<void> {
    // No connection to release.
  }

  /** Test and smoke readback only; the checkout never reads the store directly. */
  get(orderId: string): OrderCommand | undefined {
    return this.commands.get(orderId);
  }
}

/**
 * The durable `connected_orders` table in Ecom's own database. Ecom owns this
 * table: it records Ecom's command state, never a peer's data. The table name
 * is a constant, so no caller-supplied value ever reaches the SQL text.
 */
const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS connected_orders (
    order_id     text PRIMARY KEY,
    request_hash text NOT NULL,
    status       text NOT NULL CHECK (status IN ('pending', 'completed')),
    response     jsonb,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
  )
`;

interface CommandRow {
  order_id: string;
  request_hash: string;
  status: string;
  /** node-postgres hands back jsonb already parsed. */
  response: unknown;
}

export class PostgresOrderCommandStore implements OrderCommandStore {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    if (typeof connectionString !== "string" || connectionString.trim() === "") {
      throw new Error("Postgres order store requires a connection string");
    }
    this.pool = new Pool({ connectionString });
  }

  async ensureSchema(): Promise<void> {
    await this.pool.query(CREATE_TABLE);
  }

  /**
   * `INSERT ... ON CONFLICT DO NOTHING` inside one transaction: a concurrent
   * claim of the same id blocks on the speculative insertion until the other
   * transaction commits, so the following read always sees the winner's row
   * instead of two callers both believing they reserved it.
   */
  async reserve(orderId: string, requestHash: string): Promise<OrderReservation> {
    requireKey(orderId, "Order id");
    requireHash(requestHash);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO connected_orders (order_id, request_hash, status)
         VALUES ($1, $2, 'pending')
         ON CONFLICT (order_id) DO NOTHING
         RETURNING order_id`,
        [orderId, requestHash],
      );
      if (inserted.rowCount === 1) {
        await client.query("COMMIT");
        return { outcome: "reserved" };
      }
      const existing = await client.query<CommandRow>(
        "SELECT order_id, request_hash, status, response FROM connected_orders"
          + " WHERE order_id = $1",
        [orderId],
      );
      const row = existing.rows[0];
      if (row === undefined) {
        // Read before COMMIT, so the rollback below is the correct response.
        throw new Error(`Order "${orderId}" vanished while it was being reserved`);
      }
      await client.query("COMMIT");
      return classify(row, orderId, requestHash);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async complete(orderId: string, response: unknown): Promise<void> {
    requireKey(orderId, "Order id");
    // The status guard makes a second completion a visible failure instead of
    // an overwrite of the receipt the first attempt stored.
    const result = await this.pool.query(
      `UPDATE connected_orders
         SET status = 'completed', response = $2::jsonb, updated_at = now()
       WHERE order_id = $1 AND status = 'pending'
       RETURNING order_id`,
      [orderId, JSON.stringify(response ?? null)],
    );
    if (result.rowCount !== 1) {
      throw new Error(`Order "${orderId}" has no pending submission to complete`);
    }
  }

  async abort(orderId: string): Promise<void> {
    requireKey(orderId, "Order id");
    await this.pool.query(
      "DELETE FROM connected_orders WHERE order_id = $1 AND status = 'pending'",
      [orderId],
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
