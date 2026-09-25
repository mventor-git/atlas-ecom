# Atlas Ecom example database

A small, realistic PostgreSQL dataset for Atlas Ecom: 6 products, 37 colour/size
variants, one image per variant, and stock per variant.

**This is example data, not a migration set.** Nothing in `src/` reads these
tables. The only table the application currently owns is `connected_orders`,
created in code by `PostgresOrderCommandStore`. Treat `db/` as something you
load to look at realistic commerce data, to drive a future persistence slice, or
to compare against the atlas-erp example database — not as the schema Ecom will
ship. There is no down-migration, no version table, and no migration runner.

## Files

| File | What it is |
| --- | --- |
| `schema.sql` | Five tables in a dedicated `ecom_example` schema. Idempotent (`CREATE SCHEMA`/`CREATE TABLE IF NOT EXISTS`). |
| `seed.sql` | The shared catalogue: 6 categories, 6 products, 37 variants, 37 images, 37 stock rows. Idempotent (upserts on every natural key). |
| `README.md` | This file. |

Everything lives in the `ecom_example` schema rather than `public`, so the
example data can sit in the same database as real Ecom tables without
colliding, and can be removed with one statement:

```sql
DROP SCHEMA ecom_example CASCADE;
```

## Load order

`schema.sql` first, then `seed.sql`. `seed.sql` depends on the tables, so the
order is not optional. Both files are plain SQL in a single transaction each, so
a failure part-way leaves the database unchanged.

```sh
createdb atlas_ecom
psql -d atlas_ecom -v ON_ERROR_STOP=1 -f db/schema.sql
psql -d atlas_ecom -v ON_ERROR_STOP=1 -f db/seed.sql
```

Notes:

- `-v ON_ERROR_STOP=1` matters. Without it `psql` reports an error and carries
  on, and a seed that half-loaded still "succeeds".
- `atlas_ecom` is the database name in `contract.md`. If you already have a
  real one, load into a scratch database instead and point
  `ATLAS_ECOM_DATABASE_URL` at it.
- Loading `seed.sql` twice is a no-op: every insert upserts on its primary key.
  Loading `schema.sql` twice is a no-op too.
- If `psql` is remote, the same two commands work over any connection string
  that `createdb`/`psql` accept; no server-side files are needed.

## The shared catalogue identity

`products.product_id` deliberately holds the **same value as the ERP item
master `item_id`**, and `products.price_cents` holds the same integer-cents
price. `product_variants.variant_id` is the deterministic composite
`<PRODUCT SKU>-<COLOR>-<SIZE>`, for example `AUR-LIN-SHIRT-SAND-XS`, and the
sellable variant SKU is the same string (the schema enforces
`CHECK (sku = variant_id)` so the two cannot drift).

This is the point of the dataset: the same item, SKU, price and variant ids
appear in Ecom's `ecom_example` schema and in the atlas-erp example database, so
the two can be diffed or later joined by id instead of by name or price.

| `product_id` | `sku` | Name | Brand | Category | `price_cents` |
| --- | --- | --- | --- | --- | --- |
| `item-aurora-linen-shirt` | `AUR-LIN-SHIRT` | Aurora Everyday Linen Shirt | Northline | Apparel | 8900 |
| `item-meridian-court-sneaker` | `MER-COURT-SNEAK` | Meridian Court Sneaker | Meridian | Footwear | 12900 |
| `item-harbor-wool-throw` | `HAR-WOOL-THROW` | Harbor Wool Throw | Hearthline | Home | 11900 |
| `item-terra-pour-over-set` | `TER-POUR-01` | Terra Pour-Over Set | Kiln & Coast | Kitchen | 6400 |
| `item-solstice-trail-bottle` | `SOL-TRAIL-BTL` | Solstice Trail Bottle | Fieldcraft | Outdoors | 3200 |
| `item-loom-everyday-tote` | `LOOM-TOTE-01` | Loom Everyday Tote | Loom | Bags | 7400 |

Variant matrix: shirt 3 colours x 5 sizes (15), sneaker 2 x 6 (12), throw 2 x 1
(2), pour-over 2 x 1 (2), bottle 2 x 2 (4), tote 2 x 1 (2). The two `Ember`
bottle variants are seeded `inactive` on purpose, so the data includes a colour
that is catalogued but not sellable. `SOL-TRAIL-BTL-EMBER-750ML` has 1 unit on
hand, so there is a real oversell case to reject.

**If the atlas-erp example seed changes, change this one in the same commit.**
The two files are only comparable while their identity agrees, and nothing in
either repository enforces that.

## Images, and the Unsplash question

Every variant has **exactly one** `product_variant_images` row. That is
structural, not a convention: the table's primary key is `variant_id`, also a
foreign key to the variant, so a second image for a variant cannot be inserted
and an image cannot outlive its variant.

Each `image_url` is an `https://images.unsplash.com/...` CDN link and each
`source_url` is `https://unsplash.com/`. Both are pinned by `CHECK` constraints,
so the provenance is in the schema instead of in a convention nobody remembers.
A colour picks one photo and every size in that colour reuses it, so the dataset
uses 13 distinct photos across 37 images. `alt_text` is composed from the
product name, colour and size, so it always describes the row it sits on.

All 13 URLs were confirmed to return HTTP 200 with `image/jpeg` when this file
was written.

**These are placeholder links, not licensed production imagery.** Linking a CDN
URL is not the same as being licensed to sell the photograph. Before any of this
reaches a real storefront you need the normal review Unsplash licensing actually
requires: the Unsplash License terms at the time of use, per-photographer
attribution where the photographer has asked for it, the API terms if you ever
switch to the API instead of these direct links, your own hotlinking and
caching terms, and a decision about whether to download and self-host the assets
instead. That review is product work and has not been done. Nothing in this
repository depends on these URLs resolving.

## Verification

Run these after loading. They are also the acceptance checks for changing the
seed.

### Row counts

Expect `6 / 6 / 37 / 37 / 37`.

```sql
SELECT 'categories'            AS relation, count(*) FROM ecom_example.categories
UNION ALL SELECT 'products',                    count(*) FROM ecom_example.products
UNION ALL SELECT 'product_variants',            count(*) FROM ecom_example.product_variants
UNION ALL SELECT 'product_variant_images',      count(*) FROM ecom_example.product_variant_images
UNION ALL SELECT 'inventory_levels',            count(*) FROM ecom_example.inventory_levels
ORDER BY relation;
```

### No-missing-image invariant

Expect `0`. This is the one invariant worth checking on every load, and
`seed.sql` already asserts it inside its own transaction, so a broken seed
fails to load rather than leaving a half-built database.

```sql
SELECT count(*) AS variants_without_image
FROM ecom_example.product_variants v
WHERE NOT EXISTS (
    SELECT 1 FROM ecom_example.product_variant_images i
    WHERE i.variant_id = v.variant_id
);
```

### Image provenance

Both expect `0`. The schema `CHECK`s make these unreachable, so a non-zero
result means someone widened the constraints on purpose.

```sql
SELECT count(*) AS non_unsplash_cdn FROM ecom_example.product_variant_images
WHERE image_url NOT LIKE 'https://images.unsplash.com/%';

SELECT count(*) AS wrong_source FROM ecom_example.product_variant_images
WHERE source_url <> 'https://unsplash.com/';

SELECT count(*) AS blank_alt_text FROM ecom_example.product_variant_images
WHERE btrim(alt_text) = '';
```

### Per-product 1:1:1 breakdown

Every `variants`, `images` and `stock` column must be equal, and every product
must have at least one variant.

```sql
SELECT p.sku,
       p.price_cents,
       count(DISTINCT v.variant_id) AS variants,
       count(DISTINCT i.variant_id) AS images,
       count(DISTINCT s.variant_id) AS stock,
       string_agg(DISTINCT v.color, ', ' ORDER BY v.color) AS colors
FROM ecom_example.products p
LEFT JOIN ecom_example.product_variants       v ON v.product_id = p.product_id
LEFT JOIN ecom_example.product_variant_images i ON i.variant_id = v.variant_id
LEFT JOIN ecom_example.inventory_levels       s ON s.variant_id = v.variant_id
GROUP BY p.product_id, p.sku, p.price_cents
ORDER BY p.sku;
```

### Referential integrity

Expect `0` for every count. Foreign keys already enforce this, so a non-zero
result means the constraints were dropped.

```sql
SELECT
    (SELECT count(*) FROM ecom_example.product_variants
      WHERE product_id NOT IN (SELECT product_id FROM ecom_example.products))
  + (SELECT count(*) FROM ecom_example.products
      WHERE category_id NOT IN (SELECT category_id FROM ecom_example.categories))
  + (SELECT count(*) FROM ecom_example.inventory_levels
      WHERE variant_id NOT IN (SELECT variant_id FROM ecom_example.product_variants))
    AS orphan_rows;
```

## What a storefront would read

The natural storefront join is product -> variant -> image -> stock, with
missing stock treated as unavailable, which matches how `ConnectedCatalog`
already projects a peer item with no stock record as quantity 0.

```sql
SELECT p.sku, v.variant_id, v.color, v.size,
       v.price_cents, s.quantity_on_hand - s.quantity_reserved AS available,
       i.image_url, i.alt_text
FROM ecom_example.products p
JOIN ecom_example.product_variants       v ON v.product_id = p.product_id
LEFT JOIN ecom_example.inventory_levels  s ON s.variant_id = v.variant_id
LEFT JOIN ecom_example.product_variant_images i ON i.variant_id = v.variant_id
WHERE p.status = 'active'
  AND v.status = 'active'
ORDER BY p.sku, v.color, v.size;
```
