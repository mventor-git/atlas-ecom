import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ConnectedCatalog,
  ConnectedCheckout,
  ErpAuditConsumer,
  OrderBook,
  PostgresOrderCommandStore,
  type ErpAuditSnapshot,
} from "../src/index.ts";
import { AtlasErpClient } from "../src/erp-client.ts";

/**
 * Real PostgreSQL coverage for the durable order store. It runs only when
 * ATLAS_ECOM_DATABASE_URL names a database this test may create its own table
 * in; without it the whole file is skipped, so `npm test` stays hermetic.
 */
const DATABASE_URL = process.env.ATLAS_ECOM_DATABASE_URL?.trim();
const ITEM = { item_id: "item-1", sku: "SKU-1", name: "Widget", price_cents: 1250 };

function audit(): ErpAuditSnapshot {
  return {
    app_id: "atlas-erp",
    type: "snapshot",
    capability: "audit.snapshot",
    connect_version: "1.0.0",
    cursor: "cursor-1",
    data: {
      items: [ITEM],
      stock: [{ item_id: ITEM.item_id, quantity: 4 }],
      sales: [],
      journals: [],
      stock_movements: [],
    },
  };
}

async function openStore(): Promise<PostgresOrderCommandStore> {
  const store = new PostgresOrderCommandStore(DATABASE_URL as string);
  await store.ensureSchema();
  return store;
}

const options = DATABASE_URL === undefined ? { skip: "ATLAS_ECOM_DATABASE_URL is not set" } : {};

test("the order store keeps one claim per id and replays the receipt after a reopen", options, async () => {
  const orderId = `store-${randomUUID()}`;
  let store = await openStore();
  try {
    assert.deepEqual(await store.reserve(orderId, "hash-a"), { outcome: "reserved" });

    // A second claim of the same id is a conflict, never a second reservation.
    assert.deepEqual(await store.reserve(orderId, "hash-a"), {
      outcome: "conflict",
      reason: `Order "${orderId}" already has a submission in progress`,
    });
    assert.deepEqual(await store.reserve(orderId, "hash-b"), {
      outcome: "conflict",
      reason: `Order "${orderId}" was already recorded with a different request`,
    });

    const receipt = { id: orderId, status: "submitted", total_cents: 1250 };
    await store.complete(orderId, receipt);
    await store.close();

    // Reopening is the point: the receipt must survive the connection, not the memory.
    store = await openStore();
    assert.deepEqual(await store.reserve(orderId, "hash-a"), { outcome: "replay", response: receipt });
    assert.deepEqual(await store.reserve(orderId, "hash-b"), {
      outcome: "conflict",
      reason: `Order "${orderId}" was already recorded with a different request`,
    });
    await assert.rejects(() => store.complete(orderId, receipt), /no pending submission to complete/);
  } finally {
    await store.close().catch(() => undefined);
  }
});

test("a pending claim survives a reopen, and abort releases only pending claims", options, async () => {
  const pendingId = `pending-${randomUUID()}`;
  const completedId = `completed-${randomUUID()}`;
  let store = await openStore();
  try {
    await store.reserve(pendingId, "hash-pending");
    await store.reserve(completedId, "hash-completed");
    await store.complete(completedId, { id: completedId, total_cents: 400 });
    await store.close();

    store = await openStore();
    assert.deepEqual(await store.reserve(pendingId, "hash-pending"), {
      outcome: "conflict",
      reason: `Order "${pendingId}" already has a submission in progress`,
    });

    await store.abort(pendingId);
    assert.deepEqual(await store.reserve(pendingId, "hash-pending"), { outcome: "reserved" });
    // A completed receipt is the durable answer for its id and is never released.
    await store.abort(completedId);
    assert.deepEqual(await store.reserve(completedId, "hash-completed"), {
      outcome: "replay",
      response: { id: completedId, total_cents: 400 },
    });
  } finally {
    await store.close().catch(() => undefined);
  }
});

test("ensureSchema is safe to repeat and concurrent claims of one id resolve to one", options, async () => {
  const orderId = `concurrent-${randomUUID()}`;
  const store = await openStore();
  try {
    await store.ensureSchema();
    await store.ensureSchema();

    const claims = await Promise.all(
      Array.from({ length: 4 }, () => store.reserve(orderId, "hash-a")),
    );
    const reserved = claims.filter((claim) => claim.outcome === "reserved");
    assert.equal(reserved.length, 1, `expected one winner, got ${JSON.stringify(claims)}`);
    assert.equal(
      claims.filter((claim) => claim.outcome === "conflict").length,
      3,
    );

    await store.complete(orderId, { id: orderId });
    const replays = await Promise.all(
      Array.from({ length: 3 }, () => store.reserve(orderId, "hash-a")),
    );
    assert.equal(
      replays.every((replay) => replay.outcome === "replay"),
      true,
      `expected replays, got ${JSON.stringify(replays)}`,
    );
  } finally {
    await store.close().catch(() => undefined);
  }
});

test("a connected checkout replays from postgres after the store is reopened", options, async () => {
  const key = `checkout-${randomUUID()}`;
  const consumer = new ErpAuditConsumer();
  consumer.apply(audit());
  const catalog = new ConnectedCatalog(consumer);
  const orderBook = new OrderBook();
  const sales: string[] = [];
  const fetchImpl: typeof globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { sale_id: string; customer_id: string };
    sales.push(body.sale_id);
    return new Response(
      JSON.stringify({
        sale: {
          sale_id: body.sale_id,
          customer_id: body.customer_id,
          journal_id: "journal-1",
          total_cents: ITEM.price_cents,
          lines: [
            {
              item_id: ITEM.item_id,
              quantity: 1,
              unit_price_cents: ITEM.price_cents,
              total_cents: ITEM.price_cents,
            },
          ],
        },
      }),
      { status: 201, headers: { "content-type": "application/json" } },
    );
  };
  const client = new AtlasErpClient({
    baseUrl: "http://127.0.0.1:1",
    token: "postgres-checkout-test",
    fetch: fetchImpl,
  });

  let store = await openStore();
  try {
    const build = (): ConnectedCheckout =>
      new ConnectedCheckout({
        catalog,
        client,
        store,
        orderBook,
        customerId: "postgres-checkout-test",
        allowWrites: true,
      });

    const first = await build().checkout({ key, itemId: ITEM.item_id, quantity: 1 });
    assert.equal(first.replayed, false);
    assert.equal(sales.length, 1);

    // A new connection, a new store, and a brand new checkout object: the key
    // must still replay from the row the first attempt left behind.
    await store.close();
    store = await openStore();
    const second = await build().checkout({ key, itemId: ITEM.item_id, quantity: 1 });

    assert.equal(second.replayed, true);
    assert.deepEqual(second.order, first.order);
    assert.equal(sales.length, 1, "the reopened store must not post a second sale");
    assert.equal(orderBook.listOrders().length, 1);

    await assert.rejects(
      () => build().checkout({ key, itemId: ITEM.item_id, quantity: 2 }),
      /was already recorded with a different request/,
    );
    assert.equal(sales.length, 1);
  } finally {
    await store.close().catch(() => undefined);
  }
});
