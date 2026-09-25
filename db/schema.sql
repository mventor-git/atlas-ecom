-- atlas-ecom example database: schema
--
-- This is EXAMPLE DATA, not a production migration set. Nothing here is wired
-- into the application yet; the product slice that reads a real database still
-- only owns the `connected_orders` receipt table created in code.
--
-- Scope: the tables live in the `ecom_example` schema rather than `public`, so
-- this example dataset can sit in the same database as real Ecom tables
-- without colliding with them and can be dropped with a single
-- `DROP SCHEMA ecom_example CASCADE`.
--
-- Every table is keyed by a natural text identifier (no sequences), so the
-- seed is deterministic and `ON CONFLICT (<key>) DO UPDATE` reloads cleanly.
--
-- Load with:  psql -d <db> -v ON_ERROR_STOP=1 -f db/schema.sql

BEGIN;

CREATE SCHEMA IF NOT EXISTS ecom_example;

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ecom_example.categories (
    category_id  text PRIMARY KEY,
    name         text NOT NULL UNIQUE CHECK (btrim(name) <> ''),
    slug         text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    description  text NOT NULL DEFAULT '',
    sort_order   integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- products
--
-- `product_id` deliberately carries the same value as the ERP item master
-- `item_id` (for example `item-aurora-linen-shirt`). The two example databases
-- are meant to be comparable, and a later connect/compare pass joins on this
-- column rather than on names or prices.
--
-- `price_cents` is the catalogue price in integer cents, matching the ERP
-- `price_cents` and the in-process `Product.price_cents`.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ecom_example.products (
    product_id   text PRIMARY KEY,
    sku          text NOT NULL UNIQUE CHECK (btrim(sku) <> ''),
    name         text NOT NULL CHECK (btrim(name) <> ''),
    brand        text NOT NULL CHECK (btrim(brand) <> ''),
    category_id  text NOT NULL
                 REFERENCES ecom_example.categories (category_id)
                 ON UPDATE CASCADE ON DELETE RESTRICT,
    description  text NOT NULL DEFAULT '',
    price_cents  integer NOT NULL CHECK (price_cents >= 0),
    status       text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'inactive', 'draft')),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS products_category_idx
    ON ecom_example.products (category_id);

CREATE INDEX IF NOT EXISTS products_status_idx
    ON ecom_example.products (status);

-- ---------------------------------------------------------------------------
-- product_variants
--
-- The variant identifier is the deterministic composite
-- `<PRODUCT SKU>-<COLOR>-<SIZE>`, for example `AUR-LIN-SHIRT-SAND-XS`. It is
-- derived from the shared catalogue identity rather than generated, so the same
-- variant gets the same id in this database and in the ERP example database and
-- the two can be diffed without a mapping table.
--
-- For this example dataset the sellable variant SKU is the variant id, so the
-- `sku` column is constrained to agree rather than allowed to drift. If real
-- merchandising ever needs a separate sellable code, drop this check first.
--
-- Colour and size are separate explicit columns, never one packed "option"
-- string, so a storefront can filter on either without parsing.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ecom_example.product_variants (
    variant_id   text PRIMARY KEY,
    product_id   text NOT NULL
                 REFERENCES ecom_example.products (product_id)
                 ON UPDATE CASCADE ON DELETE CASCADE,
    sku          text NOT NULL UNIQUE CHECK (sku = variant_id),
    color        text NOT NULL CHECK (btrim(color) <> ''),
    size         text NOT NULL CHECK (btrim(size) <> ''),
    price_cents  integer NOT NULL CHECK (price_cents >= 0),
    status       text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'inactive', 'draft')),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT product_variants_option_uniq UNIQUE (product_id, color, size)
);

CREATE INDEX IF NOT EXISTS product_variants_product_idx
    ON ecom_example.product_variants (product_id);

-- ---------------------------------------------------------------------------
-- product_variant_images
--
-- Exactly one image per variant, enforced by making `variant_id` the primary
-- key rather than a surrogate id plus a "position 1" convention. A second
-- image for a variant is therefore impossible to insert by accident, and the
-- no-missing-image invariant is a foreign key away (every variant is expected
-- to have a row here; the seed asserts that at the end of its transaction).
--
-- The two CHECK constraints keep the image provenance in the schema instead of
-- in a convention nobody remembers: the bytes must come from the Unsplash CDN
-- and the credit must point at Unsplash. These are example-data constraints.
-- Replacing them with a general media table is real production work.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ecom_example.product_variant_images (
    variant_id   text PRIMARY KEY
                 REFERENCES ecom_example.product_variants (variant_id)
                 ON UPDATE CASCADE ON DELETE CASCADE,
    image_url    text NOT NULL
                 CHECK (image_url LIKE 'https://images.unsplash.com/%'),
    source_url   text NOT NULL DEFAULT 'https://unsplash.com/'
                 CHECK (source_url = 'https://unsplash.com/'),
    alt_text     text NOT NULL CHECK (btrim(alt_text) <> ''),
    position     smallint NOT NULL DEFAULT 1 CHECK (position > 0),
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- inventory_levels
--
-- Stock is per variant, keyed one-to-one with the variant. A variant with no
-- row here reads as unavailable, which is the same "no stock record means zero"
-- join the connected catalogue projection already uses.
--
-- Quantities must be positive and a reservation can never exceed what is on
-- hand, so an oversell is rejected by the database rather than by whichever
-- code path forgot to check.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ecom_example.inventory_levels (
    variant_id          text PRIMARY KEY
                        REFERENCES ecom_example.product_variants (variant_id)
                        ON UPDATE CASCADE ON DELETE CASCADE,
    quantity_on_hand    integer NOT NULL CHECK (quantity_on_hand > 0),
    quantity_reserved   integer NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0),
    reorder_point       integer NOT NULL DEFAULT 5 CHECK (reorder_point >= 0),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT inventory_levels_not_oversold
        CHECK (quantity_reserved <= quantity_on_hand)
);

COMMIT;
