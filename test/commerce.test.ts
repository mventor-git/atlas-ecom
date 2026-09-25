import test from "node:test";
import assert from "node:assert/strict";
import { Cart, OrderBook, StandaloneCatalog } from "../src/index.ts";

function catalogWith(...products: Array<{ name: string; price_cents: number; quantity: number }>) {
  const catalog = new StandaloneCatalog();
  return { catalog, products: products.map((product) => catalog.addProduct(product)) };
}

test("standalone catalog adds products with stable ids and lists them as active", () => {
  const { catalog, products } = catalogWith(
    { name: "Atlas Coffee", price_cents: 1250, quantity: 10 },
    { name: "Atlas Mug", price_cents: 1800, quantity: 0 },
  );

  const [coffee, mug] = products;
  assert.notEqual(coffee.id, mug.id);
  assert.equal(coffee.active, true);
  assert.equal(catalog.getProduct(coffee.id)?.name, "Atlas Coffee");
  assert.deepEqual(
    catalog.listProducts().map((product) => product.id),
    [coffee.id, mug.id],
  );
});

test("updating a product keeps its id and replaces the given fields only", () => {
  const { catalog, products } = catalogWith({ name: "Atlas Coffee", price_cents: 1250, quantity: 10 });
  const [coffee] = products;

  const updated = catalog.updateProduct(coffee.id, { price_cents: 1500 });

  assert.equal(updated.id, coffee.id);
  assert.equal(updated.name, "Atlas Coffee");
  assert.equal(updated.price_cents, 1500);
  assert.equal(updated.quantity, 10);
  assert.equal(catalog.getProduct(coffee.id)?.price_cents, 1500);
  assert.throws(() => catalog.updateProduct("missing", { name: "x" }), /Unknown product/);
});

test("cart totals integer cents across products", () => {
  const { catalog, products } = catalogWith(
    { name: "Atlas Coffee", price_cents: 1250, quantity: 10 },
    { name: "Atlas Mug", price_cents: 1800, quantity: 4 },
  );
  const [coffee, mug] = products;
  const cart = new Cart(catalog);

  assert.equal(cart.totalCents(), 0);
  cart.addItem(coffee.id, 2);
  cart.addItem(mug.id, 1);

  assert.equal(cart.totalCents(), 4300);
  assert.deepEqual(cart.listLines(), [
    { product_id: coffee.id, name: "Atlas Coffee", unit_price_cents: 1250, quantity: 2, line_total_cents: 2500 },
    { product_id: mug.id, name: "Atlas Mug", unit_price_cents: 1800, quantity: 1, line_total_cents: 1800 },
  ]);
});

test("cart refuses unknown and inactive products", () => {
  const { catalog, products } = catalogWith({ name: "Atlas Coffee", price_cents: 1250, quantity: 10 });
  const [coffee] = products;
  const cart = new Cart(catalog);

  assert.throws(() => cart.addItem("missing", 1), /Unknown product "missing"/);
  catalog.deactivateProduct(coffee.id);
  assert.throws(() => cart.addItem(coffee.id, 1), /not active/);
  assert.equal(cart.totalCents(), 0);
});

test("cart refuses a non-positive quantity and more than the available stock", () => {
  const { catalog, products } = catalogWith({ name: "Atlas Coffee", price_cents: 1250, quantity: 2 });
  const [coffee] = products;
  const cart = new Cart(catalog);

  for (const quantity of [0, -1, 1.5]) {
    assert.throws(() => cart.addItem(coffee.id, quantity), /Cart quantity must be an integer of at least 1/);
  }
  assert.throws(() => cart.addItem(coffee.id, 3), /Only 2 of .* available/);
  assert.equal(cart.listLines().length, 0);

  const partial = new Cart(catalog);
  partial.addItem(coffee.id, 1);
  assert.throws(() => partial.addItem(coffee.id, 2), /Only 2/);
  assert.equal(partial.listLines()[0]?.quantity, 1);
});

test("deactivating a product hides it from the storefront list", () => {
  const { catalog, products } = catalogWith(
    { name: "Atlas Coffee", price_cents: 1250, quantity: 10 },
    { name: "Atlas Mug", price_cents: 1800, quantity: 4 },
  );
  const [coffee, mug] = products;

  catalog.deactivateProduct(coffee.id);

  assert.deepEqual(
    catalog.listProducts().map((product) => product.id),
    [mug.id],
  );
  assert.equal(catalog.getProduct(coffee.id)?.active, false);
});

test("repeated adds aggregate into one line regardless of order", () => {
  const { catalog, products } = catalogWith(
    { name: "Atlas Coffee", price_cents: 1250, quantity: 10 },
    { name: "Atlas Mug", price_cents: 1800, quantity: 10 },
  );
  const [coffee, mug] = products;
  const cart = new Cart(catalog);

  cart.addItem(coffee.id, 1);
  cart.addItem(mug.id, 3);
  cart.addItem(coffee.id, 2);

  assert.deepEqual(
    cart.listLines().map((line) => [line.product_id, line.quantity]),
    [
      [coffee.id, 3],
      [mug.id, 3],
    ],
  );
  assert.equal(cart.totalCents(), 9150);
  assert.throws(() => cart.addItem(coffee.id, 8), /Only 10/);
});

test("checkout creates a created order, decrements stock once, and clears the cart", () => {
  const { catalog, products } = catalogWith(
    { name: "Atlas Coffee", price_cents: 1250, quantity: 10 },
    { name: "Atlas Mug", price_cents: 1800, quantity: 4 },
  );
  const [coffee, mug] = products;
  const cart = new Cart(catalog);
  cart.addItem(coffee.id, 2);
  cart.addItem(mug.id, 1);

  const order = cart.checkout();

  assert.equal(typeof order.id, "string");
  assert.ok(order.id.length > 0);
  assert.equal(order.status, "created");
  assert.equal(order.total_cents, 4300);
  assert.deepEqual(cart.listLines(), []);
  assert.equal(cart.totalCents(), 0);
  assert.equal(catalog.getProduct(coffee.id)?.quantity, 8);
  assert.equal(catalog.getProduct(mug.id)?.quantity, 3);
});

test("default cart exposes checkout orders through its order book", () => {
  const { catalog, products } = catalogWith({ name: "Atlas Coffee", price_cents: 1250, quantity: 2 });
  const [coffee] = products;
  const cart = new Cart(catalog);
  cart.addItem(coffee.id, 2);

  const order = cart.checkout();

  assert.deepEqual(cart.orders.getOrder(order.id), order);
  assert.deepEqual(cart.orders.listOrders(), [order]);
  assert.deepEqual(cart.orders.summary(), { order_count: 1, total_cents: 2500 });
});

test("checkout records a successful order for readback and unknown ids are absent", () => {
  const { catalog, products } = catalogWith(
    { name: "Atlas Coffee", price_cents: 1250, quantity: 10 },
    { name: "Atlas Mug", price_cents: 1800, quantity: 4 },
  );
  const [coffee, mug] = products;
  const orders = new OrderBook();
  const cart = new Cart(catalog, orders);
  cart.addItem(coffee.id, 2);
  cart.addItem(mug.id, 1);

  const order = cart.checkout();

  assert.deepEqual(orders.listOrders(), [order]);
  assert.deepEqual(orders.getOrder(order.id), order);
});

test("order lookup returns undefined for unknown ids", () => {
  const orders = new OrderBook();

  assert.equal(orders.getOrder("missing"), undefined);
});

test("order reads are isolated and immutable", () => {
  const { catalog, products } = catalogWith({ name: "Atlas Coffee", price_cents: 1250, quantity: 2 });
  const [coffee] = products;
  const orders = new OrderBook();
  const cart = new Cart(catalog, orders);
  cart.addItem(coffee.id, 2);
  const order = cart.checkout();

  const first = orders.getOrder(order.id);
  const listed = orders.listOrders();
  assert.ok(first);
  assert.notEqual(first, orders.getOrder(order.id));
  assert.notEqual(listed[0], first);
  assert.equal(Object.isFrozen(listed), true);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.lines), true);
  assert.equal(Object.isFrozen(first.lines[0]), true);
  assert.throws(() => Object.assign(first.lines[0], { name: "Changed" }), TypeError);
  assert.throws(() => Object.assign(listed, { length: 0 }), TypeError);
  assert.deepEqual(orders.getOrder(order.id), order);
});

test("order summary reports checkout count and total cents", () => {
  const { catalog, products } = catalogWith(
    { name: "Atlas Coffee", price_cents: 1250, quantity: 4 },
    { name: "Atlas Mug", price_cents: 1800, quantity: 3 },
  );
  const [coffee, mug] = products;
  const orders = new OrderBook();
  const cart = new Cart(catalog, orders);
  cart.addItem(coffee.id, 2);
  cart.addItem(mug.id, 1);
  cart.checkout();
  cart.addItem(coffee.id, 1);
  cart.checkout();

  const summary = orders.summary();

  assert.deepEqual(summary, { order_count: 2, total_cents: 5550 });
  assert.equal(Object.isFrozen(summary), true);
});

test("checkout rejects an empty cart", () => {
  const { catalog } = catalogWith();
  const cart = new Cart(catalog);

  assert.throws(() => cart.checkout(), /empty cart/i);
});

test("checkout rejects a stale price without clearing the cart or changing stock", () => {
  const { catalog, products } = catalogWith({ name: "Atlas Coffee", price_cents: 1250, quantity: 5 });
  const [coffee] = products;
  const orders = new OrderBook();
  const cart = new Cart(catalog, orders);
  cart.addItem(coffee.id, 2);
  catalog.updateProduct(coffee.id, { price_cents: 1300 });
  const before = cart.listLines();

  assert.throws(() => cart.checkout(), /price.*changed/i);
  assert.deepEqual(cart.listLines(), before);
  assert.equal(catalog.getProduct(coffee.id)?.quantity, 5);
  assert.deepEqual(orders.listOrders(), []);
});

test("checkout rejects an inactive product without mutating the cart or stock", () => {
  const { catalog, products } = catalogWith({ name: "Atlas Coffee", price_cents: 1250, quantity: 5 });
  const [coffee] = products;
  const cart = new Cart(catalog);
  cart.addItem(coffee.id, 2);
  catalog.deactivateProduct(coffee.id);
  const before = cart.listLines();

  assert.throws(() => cart.checkout(), /not active/i);
  assert.deepEqual(cart.listLines(), before);
  assert.equal(catalog.getProduct(coffee.id)?.quantity, 5);
});

test("checkout rejects insufficient stock without partially decrementing other products", () => {
  const { catalog, products } = catalogWith(
    { name: "Atlas Coffee", price_cents: 1250, quantity: 5 },
    { name: "Atlas Mug", price_cents: 1800, quantity: 2 },
  );
  const [coffee, mug] = products;
  const cart = new Cart(catalog);
  cart.addItem(coffee.id, 2);
  cart.addItem(mug.id, 2);
  catalog.updateProduct(mug.id, { quantity: 1 });
  const before = cart.listLines();

  assert.throws(() => cart.checkout(), /Only 1 .* available/);
  assert.deepEqual(cart.listLines(), before);
  assert.equal(catalog.getProduct(coffee.id)?.quantity, 5);
  assert.equal(catalog.getProduct(mug.id)?.quantity, 1);
});

test("checkout rejects duplicate product lines without mutating stock or the cart", () => {
  const { catalog, products } = catalogWith(
    { name: "Atlas Coffee", price_cents: 1250, quantity: 5 },
    { name: "Atlas Mug", price_cents: 1800, quantity: 2 },
  );
  const [coffee, mug] = products;
  const cart = new Cart(catalog);
  cart.addItem(coffee.id, 1);
  cart.addItem(coffee.id, 1);
  cart.addItem(mug.id, 1);
  const before = cart.listLines();
  assert.equal(before.length, 2);
  assert.equal(before[0]?.quantity, 2);

  const duplicateLine = { ...before[0], quantity: 3, line_total_cents: 3750 };
  assert.throws(
    () => catalog.commitCheckout([...before, duplicateLine]),
    /Duplicate product/,
  );
  assert.deepEqual(cart.listLines(), before);
  assert.equal(catalog.getProduct(coffee.id)?.quantity, 5);
  assert.equal(catalog.getProduct(mug.id)?.quantity, 2);
});

test("order lines and total remain immutable snapshots after catalog changes", () => {
  const { catalog, products } = catalogWith(
    { name: "Atlas Coffee", price_cents: 1250, quantity: 4 },
    { name: "Atlas Mug", price_cents: 1800, quantity: 3 },
  );
  const [coffee, mug] = products;
  const cart = new Cart(catalog);
  cart.addItem(coffee.id, 2);
  cart.addItem(mug.id, 1);
  const order = cart.checkout();

  catalog.updateProduct(coffee.id, { name: "Changed Coffee", price_cents: 2000, quantity: 0 });
  catalog.updateProduct(mug.id, { name: "Changed Mug", price_cents: 2500, quantity: 0 });

  assert.deepEqual(order.lines, [
    { product_id: coffee.id, name: "Atlas Coffee", unit_price_cents: 1250, quantity: 2, line_total_cents: 2500 },
    { product_id: mug.id, name: "Atlas Mug", unit_price_cents: 1800, quantity: 1, line_total_cents: 1800 },
  ]);
  assert.equal(order.total_cents, 4300);
  assert.equal(Object.isFrozen(order), true);
  assert.equal(Object.isFrozen(order.lines), true);
  assert.equal(Object.isFrozen(order.lines[0]), true);
});
