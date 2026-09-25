import { randomUUID } from "node:crypto";
import { ConnectedCheckout } from "./connected-checkout.ts";
import { OrderBook } from "./commerce.ts";
import { AtlasErpClient } from "./erp-client.ts";
import { ConnectedCatalog, ErpAuditConsumer } from "./erp-consumer.ts";
import { PostgresOrderCommandStore } from "./postgres-order-store.ts";
import { CONNECT_VERSION, handshake } from "./protocol.ts";

/**
 * A real connected checkout against a real peer and a real database.
 *
 * It sells one unit from the connected catalog, closes the order store, opens
 * a new one, and repeats the same Ecom idempotency key: the replay must return
 * the stored order and leave the peer's audit state untouched, which is the
 * whole point of a durable receipt. The write is refused unless
 * ATLAS_ERP_ALLOW_WRITE=1 is set explicitly, and the connection string is
 * never printed.
 */
const WRITE_FLAG = "ATLAS_ERP_ALLOW_WRITE";
const CUSTOMER_ID = "ecom-checkout-smoke";

function requireEnvironment(
  name: "ATLAS_ERP_URL" | "ATLAS_ERP_CONNECT_TOKEN" | "ATLAS_ECOM_DATABASE_URL",
): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

function requireWritePermission(): void {
  if (process.env[WRITE_FLAG] !== "1") {
    throw new Error(`refusing to write: set ${WRITE_FLAG}=1 to run a connected checkout`);
  }
}

async function openStore(databaseUrl: string): Promise<PostgresOrderCommandStore> {
  const store = new PostgresOrderCommandStore(databaseUrl);
  await store.ensureSchema();
  return store;
}

async function main(): Promise<void> {
  requireWritePermission();
  // Read the whole configuration first, so a half-configured run fails before
  // it opens a peer connection or a database session.
  const erpUrl = requireEnvironment("ATLAS_ERP_URL");
  const token = requireEnvironment("ATLAS_ERP_CONNECT_TOKEN");
  const databaseUrl = requireEnvironment("ATLAS_ECOM_DATABASE_URL");
  const client = new AtlasErpClient({ baseUrl: erpUrl, token });

  const [manifest, audit] = await Promise.all([client.manifest(), client.auditSnapshot()]);
  if (manifest.app_id !== "atlas-erp") {
    throw new Error(`Expected ERP app_id "atlas-erp", got "${manifest.app_id}"`);
  }
  const versionCheck = handshake({ connect_version: CONNECT_VERSION }, manifest);
  if (!versionCheck.accepted) {
    throw new Error(`ERP connect version check failed: ${versionCheck.reason ?? "unknown reason"}`);
  }

  const consumer = new ErpAuditConsumer();
  consumer.apply(audit);
  const catalog = new ConnectedCatalog(consumer);

  const item = catalog.list().find((entry) => entry.quantity > 0 && entry.price_cents > 0);
  if (item === undefined) {
    throw new Error("ERP published no available catalog item to sell");
  }

  // One Ecom-owned key for both attempts, so the second is a replay by design.
  const key = `ecom-smoke-${randomUUID()}`;
  const quantity = 1;
  const orderBook = new OrderBook();
  const checkoutFor = (store: PostgresOrderCommandStore): ConnectedCheckout =>
    new ConnectedCheckout({
      catalog,
      client,
      store,
      orderBook,
      customerId: CUSTOMER_ID,
      allowWrites: true,
    });

  let store = await openStore(databaseUrl);
  try {
    const first = await checkoutFor(store).checkout({ key, itemId: item.item_id, quantity });

    // Read the peer again and prove the write landed: a new synchronization
    // position and exactly the submitted quantity less stock.
    if (!consumer.apply(await client.auditSnapshot())) {
      throw new Error(`ERP audit cursor did not advance after the sale: still ${String(consumer.cursor)}`);
    }
    const expectedQuantity = item.quantity - quantity;
    const soldQuantity = catalog.getById(item.item_id)?.quantity;
    if (soldQuantity !== expectedQuantity) {
      throw new Error(
        `Stock for "${item.item_id}" is ${String(soldQuantity)} after selling ${quantity}, expected ${expectedQuantity}`,
      );
    }

    // Durable means durable: drop the store and open a new one before replaying.
    await store.close();
    store = await openStore(databaseUrl);
    const replay = await checkoutFor(store).checkout({ key, itemId: item.item_id, quantity });

    if (!replay.replayed) {
      throw new Error("The repeated checkout key was not answered from the stored receipt");
    }
    if (replay.order.id !== first.order.id || replay.order.remote_sale_id !== first.order.remote_sale_id) {
      throw new Error("The replayed order does not match the first submitted order");
    }
    // The replay must not have touched the peer: identical data means the peer
    // is still at the same position with the same stock.
    if (consumer.apply(await client.auditSnapshot())) {
      throw new Error("The replayed checkout changed the peer's audit state");
    }
    const replayedQuantity = catalog.getById(item.item_id)?.quantity;
    if (replayedQuantity !== expectedQuantity) {
      throw new Error(
        `Stock for "${item.item_id}" is ${String(replayedQuantity)} after the replay, expected ${expectedQuantity}`,
      );
    }
    const connectedOrders = orderBook.listOrders().filter((order) => order.source === "connected");
    if (connectedOrders.length !== 1) {
      throw new Error(`OrderBook holds ${connectedOrders.length} connected orders, expected 1`);
    }

    console.log(
      JSON.stringify({
        ok: true,
        transport: "loopback-http",
        checkout: "connected",
        write: true,
        erp_app_id: manifest.app_id,
        audit_cursor: consumer.cursor,
        item_count: catalog.list().length,
        sold_item_id: item.item_id,
        post_order_quantity: replayedQuantity,
        order_id: first.order.id,
        order_status: first.order.status,
        order_source: first.order.source,
        total_cents: first.order.total_cents,
        sale_id: first.order.remote_sale_id,
        replayed: replay.replayed,
        durable_replay: true,
        order_store: "postgres",
        order_store_table: "connected_orders",
        order_book_connected_orders: connectedOrders.length,
      }),
    );
  } finally {
    await store.close().catch(() => undefined);
  }
}

try {
  await main();
} catch (error) {
  const detail = error instanceof Error ? error.message : "unknown error";
  console.error(`atlas-ecom connected checkout smoke failed: ${detail}`);
  process.exitCode = 1;
}
