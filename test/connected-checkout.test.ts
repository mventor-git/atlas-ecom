import test from "node:test";
import assert from "node:assert/strict";
import {
  ConnectedCatalog,
  ConnectedCheckout,
  ErpAuditConsumer,
  InMemoryOrderCommandStore,
  OrderBook,
  type ErpAuditSnapshot,
} from "../src/index.ts";
import { AtlasErpClient } from "../src/erp-client.ts";

const TOKEN = "connected-checkout-test-token";
const ITEM = { item_id: "item-1", sku: "SKU-1", name: "Widget", price_cents: 1250 };

function audit(cursor = "cursor-1"): ErpAuditSnapshot {
  return {
    app_id: "atlas-erp",
    type: "snapshot",
    capability: "audit.snapshot",
    connect_version: "1.0.0",
    cursor,
    data: {
      items: [ITEM],
      stock: [{ item_id: ITEM.item_id, quantity: 4 }],
      sales: [],
      journals: [],
      stock_movements: [],
    },
  };
}

interface FakeErp {
  client: AtlasErpClient;
  sales: { sale_id: string; customer_id: string; lines: unknown[] }[];
}

/** An AtlasErpClient over a stub transport, so the tests count real peer writes. */
function fakeErp(
  overrides: { status?: number; total_cents?: number; onPost?: () => Promise<void> } = {},
): FakeErp {
  const sales: FakeErp["sales"] = [];
  const fetchImpl: typeof globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      sale_id: string;
      customer_id: string;
      lines: unknown[];
    };
    sales.push(body);
    await overrides.onPost?.();
    const status = overrides.status ?? 201;
    const payload = {
      sale: {
        sale_id: body.sale_id,
        customer_id: body.customer_id,
        journal_id: `journal-${body.sale_id}`,
        total_cents: overrides.total_cents ?? ITEM.price_cents,
        lines: [
          {
            item_id: ITEM.item_id,
            quantity: 1,
            unit_price_cents: ITEM.price_cents,
            total_cents: ITEM.price_cents,
          },
        ],
      },
    };
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return {
    client: new AtlasErpClient({ baseUrl: "http://127.0.0.1:1", token: TOKEN, fetch: fetchImpl }),
    sales,
  };
}

function harness(
  erp: FakeErp = fakeErp(),
  allowWrites = true,
): { checkout: ConnectedCheckout; orderBook: OrderBook; store: InMemoryOrderCommandStore; erp: FakeErp } {
  const consumer = new ErpAuditConsumer();
  consumer.apply(audit());
  const orderBook = new OrderBook();
  const store = new InMemoryOrderCommandStore();
  return {
    checkout: new ConnectedCheckout({
      catalog: new ConnectedCatalog(consumer),
      client: erp.client,
      store,
      orderBook,
      customerId: "connected-checkout-test",
      allowWrites,
    }),
    orderBook,
    store,
    erp,
  };
}

const REQUEST = { key: "ecom-key-1", itemId: ITEM.item_id, quantity: 1 };

test("connected checkout refuses to be built without an explicit write opt-in", () => {
  assert.throws(
    () => harness(fakeErp(), false),
    /refusing to write: connected checkout requires allowWrites: true/,
  );
});

test("connected checkout submits one sale and records a submitted connected order", async () => {
  const { checkout, orderBook, store, erp } = harness();

  const receipt = await checkout.checkout(REQUEST);

  assert.equal(receipt.replayed, false);
  assert.equal(receipt.order.id, "ecom-key-1");
  assert.equal(receipt.order.status, "submitted");
  assert.equal(receipt.order.source, "connected");
  assert.equal(receipt.order.remote_sale_id, "ecom-ecom-key-1");
  assert.equal(receipt.order.total_cents, ITEM.price_cents);
  assert.deepEqual(receipt.order.lines, [
    {
      product_id: ITEM.item_id,
      name: ITEM.name,
      unit_price_cents: ITEM.price_cents,
      quantity: 1,
      line_total_cents: ITEM.price_cents,
    },
  ]);
  assert.equal(Object.isFrozen(receipt.order), true);
  assert.equal(Object.isFrozen(receipt.order.lines[0]), true);
  assert.equal(erp.sales.length, 1, "exactly one peer write");
  assert.equal(erp.sales[0]?.customer_id, "connected-checkout-test");
  assert.equal(store.get("ecom-key-1")?.status, "completed");

  const recorded = orderBook.getOrder("ecom-key-1");
  assert.deepEqual(recorded, receipt.order);
  assert.deepEqual(orderBook.listOrders(), [receipt.order]);
  assert.deepEqual(orderBook.summary(), { order_count: 1, total_cents: ITEM.price_cents });
});

test("the same key with the same payload replays the stored order without a second sale", async () => {
  const { checkout, orderBook, erp } = harness();

  const first = await checkout.checkout(REQUEST);
  const second = await checkout.checkout({ ...REQUEST, quantity: 1 });

  assert.equal(second.replayed, true);
  assert.equal(second.order.remote_sale_id, first.order.remote_sale_id);
  assert.deepEqual(second.order, first.order);
  assert.equal(erp.sales.length, 1, "the replay must not post again");
  assert.equal(orderBook.listOrders().length, 1);
});

test("the same key with a different payload is a conflict, not a second order", async () => {
  const { checkout, orderBook, erp } = harness();
  await checkout.checkout(REQUEST);

  await assert.rejects(
    () => checkout.checkout({ ...REQUEST, quantity: 3 }),
    /Order "ecom-key-1" was already recorded with a different request/,
  );
  assert.equal(erp.sales.length, 1);
  assert.equal(orderBook.listOrders().length, 1);
});

test("a key whose submission is in flight conflicts, and only one sale is posted", async () => {
  let saleStarted = (): void => undefined;
  const started = new Promise<void>((resolve) => {
    saleStarted = resolve;
  });
  let releaseSale = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    releaseSale = resolve;
  });
  const erp = fakeErp({
    onPost: async () => {
      saleStarted();
      await held;
    },
  });
  const { checkout, orderBook, store } = harness(erp);

  // The first attempt has claimed the key and is still talking to the peer.
  const inFlight = checkout.checkout(REQUEST);
  await started;

  await assert.rejects(
    () => checkout.checkout(REQUEST),
    /Order "ecom-key-1" already has a submission in progress/,
  );
  assert.equal(orderBook.listOrders().length, 0);

  releaseSale();
  await inFlight;
  assert.equal(erp.sales.length, 1, "the in-flight key posted exactly one sale");
  assert.equal(store.get("ecom-key-1")?.status, "completed");
  assert.equal(orderBook.listOrders().length, 1);
});

test("a failed peer submission aborts the receipt so the key can be retried", async () => {
  const erp = fakeErp({ status: 409 });
  const { checkout, orderBook, store } = harness(erp);

  await assert.rejects(() => checkout.checkout(REQUEST), /HTTP 409/);

  assert.equal(store.get("ecom-key-1"), undefined, "the pending claim is released");
  assert.deepEqual(orderBook.listOrders(), []);
  assert.equal(erp.sales.length, 1, "the submission was attempted once");
});

test("a peer total that does not match the order aborts the receipt", async () => {
  const erp = fakeErp({ total_cents: 1 });
  const { checkout, orderBook, store } = harness(erp);

  await assert.rejects(() => checkout.checkout(REQUEST), /Peer charged 1 cents, expected 1250/);

  assert.equal(store.get("ecom-key-1"), undefined);
  assert.deepEqual(orderBook.listOrders(), []);
});

test("connected checkout refuses unknown items, overselling, and bad quantities", async () => {
  const { checkout, erp } = harness();

  await assert.rejects(() => checkout.checkout({ ...REQUEST, itemId: "missing" }), /no item "missing"/);
  await assert.rejects(() => checkout.checkout({ ...REQUEST, quantity: 5 }), /Only 4 of "item-1" available/);
  await assert.rejects(() => checkout.checkout({ ...REQUEST, quantity: 0 }), /at least 1/);
  await assert.rejects(() => checkout.checkout({ ...REQUEST, key: " " }), /key must be a non-empty string/);
  assert.equal(erp.sales.length, 0);
});

test("the order book records a connected order once and never replaces it", async () => {
  const { checkout, orderBook } = harness();
  const { order } = await checkout.checkout(REQUEST);

  assert.throws(() => orderBook.recordConnectedOrder(order), /already recorded/);
  assert.throws(
    () => orderBook.recordConnectedOrder({ id: "local", status: "created", lines: [], total_cents: 0 }),
    /only a submitted connected order/,
  );
  assert.throws(
    () =>
      orderBook.recordConnectedOrder({
        id: "no-sale",
        status: "submitted",
        source: "connected",
        lines: [],
        total_cents: 0,
      }),
    /requires the peer's remote_sale_id/,
  );
  assert.deepEqual(orderBook.listOrders().map((entry) => entry.id), ["ecom-key-1"]);
});

test("a replay into a fresh order book restores the connected order once", async () => {
  const consumer = new ErpAuditConsumer();
  consumer.apply(audit());
  const catalog = new ConnectedCatalog(consumer);
  const erp = fakeErp();
  const store = new InMemoryOrderCommandStore();
  const build = (orderBook: OrderBook): ConnectedCheckout =>
    new ConnectedCheckout({
      catalog,
      client: erp.client,
      store,
      orderBook,
      customerId: "connected-checkout-test",
      allowWrites: true,
    });

  const first = await build(new OrderBook()).checkout(REQUEST);
  const replayed = new OrderBook();
  const second = await build(replayed).checkout(REQUEST);

  assert.equal(second.replayed, true);
  assert.deepEqual(second.order, first.order);
  assert.equal(erp.sales.length, 1);
  assert.equal(replayed.listOrders().length, 1);
});
