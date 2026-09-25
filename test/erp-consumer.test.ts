import test from "node:test";
import assert from "node:assert/strict";
import {
  ConnectedCatalog,
  ErpAuditConsumer,
  StandaloneCatalog,
  type ErpAuditSnapshot,
} from "../src/index.ts";

function audit(overrides: Partial<ErpAuditSnapshot> = {}): ErpAuditSnapshot {
  return {
    app_id: "atlas-erp",
    type: "snapshot",
    capability: "audit.snapshot",
    connect_version: "1.0.0",
    cursor: "cursor-1",
    data: {
      items: [
        { item_id: "item-1", sku: "SKU-1", name: "Widget", price_cents: 1250 },
        { item_id: "item-2", sku: "SKU-2", name: "Gadget", price_cents: 400 },
        { item_id: "item-3", sku: "SKU-3", name: "Unstocked", price_cents: 900 },
      ],
      stock: [
        { item_id: "item-1", quantity: 4 },
        { item_id: "item-2", quantity: 0 },
      ],
      sales: [],
      journals: [],
      stock_movements: [],
    },
    ...overrides,
  };
}

test("consumer applies a snapshot and exposes typed items, stock, and cursor", () => {
  const consumer = new ErpAuditConsumer();
  assert.equal(consumer.cursor, null);
  assert.deepEqual(consumer.listItems(), []);

  assert.equal(consumer.apply(audit()), true);

  assert.equal(consumer.cursor, "cursor-1");
  assert.equal(consumer.appId, "atlas-erp");
  assert.equal(consumer.capability, "audit.snapshot");
  assert.deepEqual(consumer.listItems(), audit().data.items);
  assert.equal(consumer.getStockLevel("item-1")?.quantity, 4);
  assert.equal(consumer.getStockLevel("missing"), undefined);
});

test("consumer ignores an already-seen cursor and applies a new one", () => {
  const consumer = new ErpAuditConsumer();
  consumer.apply(audit());

  const restocked = audit({
    cursor: "cursor-1",
    data: { ...audit().data, stock: [{ item_id: "item-1", quantity: 9 }] },
  });
  assert.equal(consumer.apply(restocked), false, "a repeated cursor is a no-op");
  assert.equal(consumer.getStockLevel("item-1")?.quantity, 4);

  const next = audit({
    cursor: "cursor-2",
    data: { ...audit().data, stock: [{ item_id: "item-1", quantity: 9 }] },
  });
  assert.equal(consumer.apply(next), true);
  assert.equal(consumer.cursor, "cursor-2");
  assert.equal(consumer.getStockLevel("item-1")?.quantity, 9);
});

test("consumer rejects a changed app or capability identity", () => {
  const consumer = new ErpAuditConsumer();
  consumer.apply(audit());

  assert.throws(
    () => consumer.apply(audit({ app_id: "atlas-erp-2" })),
    /identity changed: expected atlas-erp\/audit\.snapshot/,
  );
  assert.throws(
    () => consumer.apply(audit({ capability: "audit.delta" })),
    /identity changed/,
  );
  assert.equal(consumer.appId, "atlas-erp");
  assert.equal(consumer.cursor, "cursor-1", "a rejected snapshot leaves the applied state alone");
});

test("consumer dedupes only against the last applied cursor", () => {
  const consumer = new ErpAuditConsumer();
  consumer.apply(audit());
  consumer.apply(audit({ cursor: "cursor-2" }));

  // This profile is snapshot-only, so no seen-cursor set is retained: replaying
  // an older position is a fresh read, not a rejected duplicate.
  assert.equal(consumer.apply(audit({ cursor: "cursor-1" })), true);
  assert.equal(consumer.cursor, "cursor-1");
});

test("connected catalog joins ERP items to current stock by item id", () => {
  const consumer = new ErpAuditConsumer();
  consumer.apply(audit());
  const catalog = new ConnectedCatalog(consumer);

  assert.deepEqual(catalog.list(), [
    { item_id: "item-1", sku: "SKU-1", name: "Widget", price_cents: 1250, quantity: 4 },
    { item_id: "item-2", sku: "SKU-2", name: "Gadget", price_cents: 400, quantity: 0 },
    { item_id: "item-3", sku: "SKU-3", name: "Unstocked", price_cents: 900, quantity: 0 },
  ]);
  assert.equal(catalog.getById("item-2")?.quantity, 0);
  assert.equal(catalog.getBySku("SKU-1")?.price_cents, 1250);
  assert.equal(catalog.getById("missing"), undefined);
  assert.equal(catalog.getBySku("SKU-missing"), undefined);
});

test("connected catalog is a read view and leaves the standalone catalog alone", () => {
  const standalone = new StandaloneCatalog();
  const local = standalone.addProduct({ name: "Atlas Coffee", price_cents: 1250, quantity: 10 });

  const consumer = new ErpAuditConsumer();
  consumer.apply(audit());
  const catalog = new ConnectedCatalog(consumer);

  assert.equal(catalog.getById(local.id), undefined);
  assert.equal(standalone.listProducts().length, 1);
  assert.equal(standalone.getProduct(local.id)?.quantity, 10);

  catalog.list();
  assert.equal(standalone.listProducts().length, 1);
  assert.deepEqual(
    catalog.list().map((entry) => entry.sku),
    ["SKU-1", "SKU-2", "SKU-3"],
  );
});
