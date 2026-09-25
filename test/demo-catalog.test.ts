import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEMO_PRODUCT_SEEDS, createDemoStore, demoVariantId } from "../src/index.ts";

/**
 * The demo fixture claims to be `db/seed.sql` in memory. These tests are the
 * check on that claim: the committed seed is the source of truth, so any seed
 * edit that is not mirrored in the fixture has to fail here rather than quietly
 * showing a different catalogue in the browser than in the example database.
 */

const seed = readFileSync(fileURLToPath(new URL("../db/seed.sql", import.meta.url)), "utf8");

/**
 * Every VALUES row of one insert, as `'first column', rest of the row`. The
 * opening quote is consumed by the match, so it is put back.
 */
function seedTuples(section: string): string[] {
  const start = seed.indexOf(section);
  assert.notEqual(start, -1, `db/seed.sql no longer has the ${section} section`);
  const values = seed.slice(start);
  const end = values.indexOf("ON CONFLICT");
  return [...(end === -1 ? values : values.slice(0, end)).matchAll(/\(\s*'([^']*)'([^)]*)\)/g)].map(
    (match) => `'${match[1]}'${match[2]}`,
  );
}

test("the fixture matches the committed seed's product identity, price and status", () => {
  const products = seedTuples("INSERT INTO ecom_example.products");
  assert.equal(products.length, 6);

  for (const seedProduct of DEMO_PRODUCT_SEEDS) {
    const row = products.find((candidate) => candidate.startsWith(`'${seedProduct.id}',`));
    assert.notEqual(row, undefined, `db/seed.sql no longer has product ${seedProduct.id}`);
    assert.match(row ?? "", new RegExp(`'${seedProduct.sku}'`));
    assert.match(row ?? "", new RegExp(`'${seedProduct.name}'`));
    assert.match(row ?? "", new RegExp(`'${seedProduct.brand}'`));
    assert.match(row ?? "", new RegExp(`'cat-${seedProduct.category.toLowerCase()}',`));
    assert.match(row ?? "", new RegExp(String(seedProduct.price_cents)));
    assert.ok((row ?? "").endsWith("'active'"), `${seedProduct.id} is no longer active in the seed`);
  }
});

test("the fixture matches the committed seed's variants, prices and status", () => {
  const variants = seedTuples("INSERT INTO ecom_example.product_variants");
  assert.equal(variants.length, 37);

  for (const seedProduct of DEMO_PRODUCT_SEEDS) {
    for (const [color, size] of seedProduct.variants.map(([color, size]) => [color, size] as const)) {
      const variant_id = demoVariantId(seedProduct.sku, color, size);
      const row = variants.find((candidate) => candidate.startsWith(`'${variant_id}',`));
      assert.notEqual(row, undefined, `db/seed.sql no longer has variant ${variant_id}`);
      assert.match(row ?? "", new RegExp(`'${seedProduct.id}'`));
      assert.match(row ?? "", new RegExp(`'${color}',\\s*'${size}',`));
      assert.match(row ?? "", new RegExp(String(seedProduct.price_cents)));
    }
  }
});

test("the fixture reproduces the seed's one-unit and inactive edge cases", () => {
  const variants = seedTuples("INSERT INTO ecom_example.product_variants");
  assert.equal(variants.filter((row) => row.endsWith("'inactive'")).length, 2);
  assert.ok(
    variants
      .find((row) => row.startsWith("'SOL-TRAIL-BTL-EMBER-750ML',"))
      ?.endsWith("'inactive'"),
    "the seed's 750ml Ember variant is no longer inactive",
  );

  const store = createDemoStore();
  const ember750 = store.catalog.getProduct("SOL-TRAIL-BTL-EMBER-750ML");
  assert.equal(ember750?.active, false);
  assert.equal(ember750?.quantity, 1);
  const ember500 = store.catalog.getProduct("SOL-TRAIL-BTL-EMBER-500ML");
  assert.equal(ember500?.active, false);
  assert.equal(ember500?.quantity, 14);
});

test("the fixture's stock is the seed's on hand less reserved", () => {
  const stock = seedTuples("INSERT INTO ecom_example.inventory_levels");
  assert.equal(stock.length, 37);

  const available = new Map<string, number>();
  for (const row of stock) {
    const [variant_id, onHand, reserved] = row.split(",").map((part) => part.trim().replace(/'/g, ""));
    const on_hand = Number(onHand);
    const quantity_reserved = Number(reserved);
    assert.ok(Number.isInteger(on_hand) && Number.isInteger(quantity_reserved), `bad stock row: ${row}`);
    available.set(variant_id, on_hand - quantity_reserved);
  }

  const store = createDemoStore();
  let checked = 0;
  for (const [variant_id, units] of available) {
    const product = store.catalog.getProduct(variant_id);
    assert.notEqual(product, undefined, `db/seed.sql has stock for ${variant_id}, the fixture does not`);
    assert.equal(product?.quantity, units, `stock drift for ${variant_id}`);
    checked += 1;
  }
  assert.equal(checked, 37);
});

test("every seeded variant reaches the catalog with its image, colour, size and price", () => {
  const store = createDemoStore();
  const products = store.products;
  assert.equal(products.length, 6);

  const variants = products.flatMap((product) => product.variants);
  assert.equal(variants.length, 37);
  assert.deepEqual(
    [...new Set(products.map((product) => product.sku))],
    ["AUR-LIN-SHIRT", "MER-COURT-SNEAK", "HAR-WOOL-THROW", "TER-POUR-01", "SOL-TRAIL-BTL", "LOOM-TOTE-01"],
  );

  for (const variant of variants) {
    const product = store.catalog.getProduct(variant.id);
    assert.notEqual(product, undefined, `${variant.id} is missing from the catalog`);
    assert.equal(product?.id, variant.id);
    assert.equal(product?.color, variant.color);
    assert.equal(product?.size, variant.size);
    assert.match(product?.image_url ?? "", /^https:\/\/images\.unsplash\.com\/photo-[0-9a-f-]+\?/);
    assert.match(product?.image_alt ?? "", / example catalogue$/);
    assert.equal(typeof product?.price_cents, "number");
  }

  // The seed shares one photo per colour, so 37 variants use 13 distinct images.
  const photos = new Set(variants.map((variant) => store.catalog.getProduct(variant.id)?.image_url));
  assert.equal(photos.size, 13);
});

test("an explicit product id is required to be unique and a duplicate is refused", () => {
  const store = createDemoStore();
  assert.throws(
    () =>
      store.catalog.addProduct({
        id: "AUR-LIN-SHIRT-SAND-M",
        name: "Duplicate",
        price_cents: 100,
        quantity: 1,
      }),
    /already exists/,
  );
  assert.throws(
    () => store.catalog.addProduct({ id: "  ", name: "Blank id", price_cents: 100, quantity: 1 }),
    /Product id must be a non-empty string/,
  );
});
