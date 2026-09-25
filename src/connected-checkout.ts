import { createHash } from "node:crypto";
import type { Order, OrderBook, OrderLine } from "./commerce.ts";
import type { AtlasErpClient, ErpManualSale } from "./erp-client.ts";
import type { ConnectedCatalog } from "./erp-consumer.ts";
import type { OrderCommandStore } from "./postgres-order-store.ts";

export interface ConnectedCheckoutOptions {
  catalog: ConnectedCatalog;
  client: AtlasErpClient;
  store: OrderCommandStore;
  orderBook: OrderBook;
  /** Forwarded to the peer as the sale's customer. */
  customerId: string;
  /**
   * Writing to a peer is opt-in. Without it the checkout refuses to be built,
   * so no caller can post a sale by wiring the object up and forgetting a flag.
   */
  allowWrites: boolean;
}

export interface ConnectedCheckoutRequest {
  /**
   * Ecom's own idempotency key. It becomes the order id, so the same key can
   * never produce a second order, and it is the key a retry must reuse.
   */
  key: string;
  itemId: string;
  quantity: number;
}

export interface ConnectedCheckoutReceipt {
  /** The immutable Ecom order: `submitted`, `source: "connected"`. */
  readonly order: Order;
  /** True when the answer came from the durable receipt, not a new sale. */
  readonly replayed: boolean;
}

const SUBMITTED = "submitted" as const;

function requireKey(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function requireInteger(value: unknown, label: string, minimum: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) {
    throw new Error(`${label} must be an integer of at least ${minimum}`);
  }
  return value;
}

function requireQuantity(value: number): number {
  return requireInteger(value, "Connected checkout quantity", 1);
}

/** The exact payload that reaches the peer, in a fixed key order so it hashes stably. */
interface Submission {
  readonly item_id: string;
  readonly quantity: number;
  readonly unit_price_cents: number;
}

function submissionHash(submission: Submission): string {
  return createHash("sha256").update(JSON.stringify(submission)).digest("hex");
}

/**
 * Rebuilds an order from a durable receipt. The receipt round-trips through
 * JSON, so it is validated here rather than trusted: a store that was edited
 * by hand must fail loudly instead of handing back a malformed order.
 */
function readReceipt(value: unknown, key: string): Order {
  const label = `Stored receipt for order "${key}"`;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is not an order`);
  }
  const record = value as Record<string, unknown>;
  if (record.id !== key || record.status !== SUBMITTED) {
    throw new Error(`${label} is not the submitted order for "${key}"`);
  }
  if (record.source !== "connected") {
    throw new Error(`${label} is not a connected order`);
  }
  if (!Array.isArray(record.lines) || record.lines.length === 0) {
    throw new Error(`${label} has no order lines`);
  }
  return {
    id: key,
    status: SUBMITTED,
    source: "connected",
    remote_sale_id: requireKey(record.remote_sale_id, `${label}.remote_sale_id`),
    lines: record.lines.map((line, index) => readLine(line, `${label} line ${index}`)),
    total_cents: requireInteger(record.total_cents, `${label}.total_cents`, 0),
  };
}

function readLine(value: unknown, label: string): OrderLine {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is not an order line`);
  }
  const line = value as Record<string, unknown>;
  return {
    product_id: requireKey(line.product_id, `${label}.product_id`),
    // A peer may publish an unnamed item, same as the ERP audit projection.
    name: typeof line.name === "string" ? line.name : "",
    unit_price_cents: requireInteger(line.unit_price_cents, `${label}.unit_price_cents`, 0),
    quantity: requireInteger(line.quantity, `${label}.quantity`, 1),
    line_total_cents: requireInteger(line.line_total_cents, `${label}.line_total_cents`, 0),
  };
}

/**
 * A connected checkout: one Ecom order, one peer submission, one durable
 * receipt.
 *
 * The Ecom order id is the caller's idempotency key, so a retry of the same
 * key cannot become a second order. The receipt is reserved before the peer is
 * written to and completed only after the peer answered, which is what makes a
 * replay safe: the same key with the same payload returns the stored order
 * without a second write, and the same key with a different payload, or a key
 * whose submission is still in flight, is a conflict. Ecom keeps the order;
 * the peer keeps the sale; the order carries the peer's `sale_id` so the two
 * can be reconciled without either side owning the other's data.
 */
export class ConnectedCheckout {
  private readonly catalog: ConnectedCatalog;
  private readonly client: AtlasErpClient;
  private readonly store: OrderCommandStore;
  private readonly orderBook: OrderBook;
  private readonly customerId: string;

  constructor(options: ConnectedCheckoutOptions) {
    if (options.allowWrites !== true) {
      throw new Error("refusing to write: connected checkout requires allowWrites: true");
    }
    this.catalog = options.catalog;
    this.client = options.client;
    this.store = options.store;
    this.orderBook = options.orderBook;
    this.customerId = requireKey(options.customerId, "Connected checkout customerId");
  }

  async checkout(request: ConnectedCheckoutRequest): Promise<ConnectedCheckoutReceipt> {
    const key = requireKey(request.key, "Connected checkout key");
    const quantity = requireQuantity(request.quantity);

    const item = this.catalog.getById(requireKey(request.itemId, "Connected checkout itemId"));
    if (item === undefined) {
      throw new Error(`Connected catalog has no item "${request.itemId}"`);
    }
    if (quantity > item.quantity) {
      throw new Error(`Only ${item.quantity} of "${item.item_id}" available`);
    }
    if (!Number.isInteger(item.price_cents) || item.price_cents < 1) {
      throw new Error(`Item "${item.item_id}" has no sellable price`);
    }

    const submission: Submission = {
      item_id: item.item_id,
      quantity,
      unit_price_cents: item.price_cents,
    };
    const reservation = await this.store.reserve(key, submissionHash(submission));
    if (reservation.outcome === "conflict") {
      throw new Error(reservation.reason);
    }
    if (reservation.outcome === "replay") {
      return { order: this.record(readReceipt(reservation.response, key)), replayed: true };
    }

    let sale: ErpManualSale;
    try {
      sale = await this.client.createManualSale({
        customerId: this.customerId,
        // Derived from the key, so even a released claim that is retried cannot
        // become a second peer sale: the peer rejects a repeated sale id.
        saleId: `ecom-${key}`,
        lines: [
          {
            itemId: submission.item_id,
            quantity: submission.quantity,
            unitPriceCents: submission.unit_price_cents,
          },
        ],
      });
      if (sale.total_cents !== submission.unit_price_cents * submission.quantity) {
        throw new Error(
          `Peer charged ${sale.total_cents} cents, expected ${submission.unit_price_cents * submission.quantity}`,
        );
      }
    } catch (error) {
      // Release the claim so the caller can retry the key. A failed abort would
      // leave the claim pending, which is the safe direction: the retry then
      // conflicts instead of risking a second submission.
      await this.store.abort(key).catch(() => undefined);
      throw error;
    }

    const order: Order = {
      id: key,
      status: SUBMITTED,
      source: "connected",
      remote_sale_id: sale.sale_id,
      lines: [
        {
          product_id: submission.item_id,
          name: item.name,
          unit_price_cents: submission.unit_price_cents,
          quantity: submission.quantity,
          line_total_cents: submission.unit_price_cents * submission.quantity,
        },
      ],
      total_cents: sale.total_cents,
    };
    await this.store.complete(key, order);
    return { order: this.record(order), replayed: false };
  }

  /** Recording is idempotent, so a replayed order never replaces the first one. */
  private record(order: Order): Order {
    return this.orderBook.getOrder(order.id) ?? this.orderBook.recordConnectedOrder(order);
  }
}
