-- atlas-ecom example database: seed
--
-- EXAMPLE DATA. This is the shared catalogue identity used by both example
-- databases, so the same item, SKU, price and variant ids appear in
-- atlas_ecom's `ecom_example` schema and in the ERP example item master. That
-- is the point: a later compare or connect pass can diff the two by id.
--
-- 6 products -> 37 variants -> 37 image rows -> 37 stock rows.
--
-- Re-runnable. Every insert upserts on its natural key, so loading this file
-- twice leaves the same rows rather than a second copy or an error.
--
-- Load AFTER db/schema.sql:
--   psql -d <db> -v ON_ERROR_STOP=1 -f db/seed.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------
INSERT INTO ecom_example.categories (category_id, name, slug, description, sort_order)
VALUES
    ('cat-apparel',  'Apparel',  'apparel',  'Everyday clothing, cut from natural fibres.',        10),
    ('cat-footwear', 'Footwear', 'footwear', 'Shoes built on resoleable, stitched-last construction.', 20),
    ('cat-home',     'Home',     'home',     'Textiles and soft goods for living spaces.',          30),
    ('cat-kitchen',  'Kitchen',  'kitchen',  'Small-batch tools for slow, deliberate brewing.',    40),
    ('cat-outdoors', 'Outdoors', 'outdoors', 'Packs and vessels for long days outside.',            50),
    ('cat-bags',     'Bags',     'bags',     'Carry goods for commuting, errands and travel.',      60)
ON CONFLICT (category_id) DO UPDATE
SET name        = EXCLUDED.name,
    slug        = EXCLUDED.slug,
    description = EXCLUDED.description,
    sort_order  = EXCLUDED.sort_order;

-- ---------------------------------------------------------------------------
-- products
--
-- `product_id` = the ERP `item_id` for the same product. `price_cents` is the
-- same integer-cents price the ERP item master and the in-process catalogue
-- carry, so no rounding rule is introduced anywhere in the chain.
-- ---------------------------------------------------------------------------
INSERT INTO ecom_example.products
    (product_id, sku, name, brand, category_id, description, price_cents, status)
VALUES
    ('item-aurora-linen-shirt', 'AUR-LIN-SHIRT', 'Aurora Everyday Linen Shirt',
     'Northline', 'cat-apparel',
     'A relaxed linen-cotton shirt that survives a real week. Washed down before '
     'it reaches you, cut boxy through the body with a straight hem, and finished '
     'with a single patch pocket that sits high enough to keep its line when the '
     'shirt is tucked. The cloth softens with every wash rather than going limp.',
     8900, 'active'),

    ('item-meridian-court-sneaker', 'MER-COURT-SNEAK', 'Meridian Court Sneaker',
     'Meridian', 'cat-footwear',
     'A low-profile court sneaker on a stitched leather upper and a cupsole that '
     'takes a resole. The heel counter is rigid enough to walk a full day in and '
     'the toe box is deliberately roomy, so it suits a wider foot without a '
     'deliberately wide last. Break it in for a week and it stops arguing.',
     12900, 'active'),

    ('item-harbor-wool-throw', 'HAR-WOOL-THROW', 'Harbor Wool Throw',
     'Hearthline', 'cat-home',
     'A dense throw woven in a lambswool and alpaca blend, heavy enough to hold '
     'its own over a chair back rather than needing to be folded over something. '
     'The herringbone weave is finished with a hand-knotted fringe. It is the '
     'throw you keep moving from the sofa to the end of the bed.',
     11900, 'active'),

    ('item-terra-pour-over-set', 'TER-POUR-01', 'Terra Pour-Over Set',
     'Kiln & Coast', 'cat-kitchen',
     'A single-litre dripper and carafe in unglazed stoneware, sized so the brew '
     'sits in the carafe and nowhere else. The dripper has a single large hole '
     'rather than a spiral, which slows the draw down without starving the bed. '
     'Dishwasher safe, and it stains the way unglazed clay is supposed to.',
     6400, 'active'),

    ('item-solstice-trail-bottle', 'SOL-TRAIL-BTL', 'Solstice Trail Bottle',
     'Fieldcraft', 'cat-outdoors',
     'A single-wall stainless bottle with a wide mouth, so it fits a brush and '
     'a collapsible filter and cleans without a brush adapter. The 500 ml version '
     'is the one that fits a standard bottle pocket; the 750 ml is for longer days '
     'and a wider cage. The lid seal is replaceable.',
     3200, 'active'),

    ('item-loom-everyday-tote', 'LOOM-TOTE-01', 'Loom Everyday Tote',
     'Loom', 'cat-bags',
     'A flat-bottomed tote in 18oz cotton canvas with a bridle-leather base that '
     'is the part that usually gives out. Sized to stand up on its own when you '
     'set it down, which is the difference between a tote you use and a tote you '
     'carry by pinching. Straps are long enough to go over a winter coat.',
     7400, 'active')
ON CONFLICT (product_id) DO UPDATE
SET sku         = EXCLUDED.sku,
    name        = EXCLUDED.name,
    brand       = EXCLUDED.brand,
    category_id = EXCLUDED.category_id,
    description = EXCLUDED.description,
    price_cents = EXCLUDED.price_cents,
    status      = EXCLUDED.status,
    updated_at  = now();

-- ---------------------------------------------------------------------------
-- product_variants
--
-- `variant_id` is `<PRODUCT SKU>-<COLOR>-<SIZE>`, uppercased with spaces and
-- punctuation removed: "One Size" -> ONESIZE, "500ml" -> 500ML, "1L" -> 1L,
-- "40" -> 40. No sequence, no hash, no chance of a different id on reload.
--
-- The variant SKU equals the variant id, which the schema CHECK enforces.
--
-- Two `SOL-TRAIL-BTL` Ember variants are `inactive` on purpose so the example
-- data covers a colour that is still catalogued but not sellable. They still get
-- an image row, because the no-missing-image invariant is about the data, not
-- about sellability.
-- ---------------------------------------------------------------------------
INSERT INTO ecom_example.product_variants
    (variant_id, product_id, sku, color, size, price_cents, status)
VALUES
    -- item-aurora-linen-shirt / AUR-LIN-SHIRT: 3 colours x 5 sizes
    ('AUR-LIN-SHIRT-SAND-XS', 'item-aurora-linen-shirt', 'AUR-LIN-SHIRT-SAND-XS', 'Sand',  'XS',  8900, 'active'),
    ('AUR-LIN-SHIRT-SAND-S',  'item-aurora-linen-shirt', 'AUR-LIN-SHIRT-SAND-S',  'Sand',  'S',   8900, 'active'),
    ('AUR-LIN-SHIRT-SAND-M',  'item-aurora-linen-shirt', 'AUR-LIN-SHIRT-SAND-M',  'Sand',  'M',   8900, 'active'),
    ('AUR-LIN-SHIRT-SAND-L',  'item-aurora-linen-shirt', 'AUR-LIN-SHIRT-SAND-L',  'Sand',  'L',   8900, 'active'),
    ('AUR-LIN-SHIRT-SAND-XL', 'item-aurora-linen-shirt', 'AUR-LIN-SHIRT-SAND-XL', 'Sand',  'XL',  8900, 'active'),
    ('AUR-LIN-SHIRT-NAVY-XS', 'item-aurora-linen-shirt', 'AUR-LIN-SHIRT-NAVY-XS', 'Navy',  'XS',  8900, 'active'),
    ('AUR-LIN-SHIRT-NAVY-S',  'item-aurora-linen-shirt', 'AUR-LIN-SHIRT-NAVY-S',  'Navy',  'S',   8900, 'active'),
    ('AUR-LIN-SHIRT-NAVY-M',  'item-aurora-linen-shirt', 'AUR-LIN-SHIRT-NAVY-M',  'Navy',  'M',   8900, 'active'),
    ('AUR-LIN-SHIRT-NAVY-L',  'item-aurora-linen-shirt', 'AUR-LIN-SHIRT-NAVY-L',  'Navy',  'L',   8900, 'active'),
    ('AUR-LIN-SHIRT-NAVY-XL', 'item-aurora-linen-shirt', 'AUR-LIN-SHIRT-NAVY-XL', 'Navy',  'XL',  8900, 'active'),
    ('AUR-LIN-SHIRT-OLIVE-XS','item-aurora-linen-shirt', 'AUR-LIN-SHIRT-OLIVE-XS','Olive', 'XS',  8900, 'active'),
    ('AUR-LIN-SHIRT-OLIVE-S', 'item-aurora-linen-shirt', 'AUR-LIN-SHIRT-OLIVE-S', 'Olive', 'S',   8900, 'active'),
    ('AUR-LIN-SHIRT-OLIVE-M', 'item-aurora-linen-shirt', 'AUR-LIN-SHIRT-OLIVE-M', 'Olive', 'M',   8900, 'active'),
    ('AUR-LIN-SHIRT-OLIVE-L', 'item-aurora-linen-shirt', 'AUR-LIN-SHIRT-OLIVE-L', 'Olive', 'L',   8900, 'active'),
    ('AUR-LIN-SHIRT-OLIVE-XL','item-aurora-linen-shirt', 'AUR-LIN-SHIRT-OLIVE-XL','Olive', 'XL',  8900, 'active'),

    -- item-meridian-court-sneaker / MER-COURT-SNEAK: 2 colours x 6 sizes
    ('MER-COURT-SNEAK-CHALK-40', 'item-meridian-court-sneaker', 'MER-COURT-SNEAK-CHALK-40', 'Chalk', '40', 12900, 'active'),
    ('MER-COURT-SNEAK-CHALK-41', 'item-meridian-court-sneaker', 'MER-COURT-SNEAK-CHALK-41', 'Chalk', '41', 12900, 'active'),
    ('MER-COURT-SNEAK-CHALK-42', 'item-meridian-court-sneaker', 'MER-COURT-SNEAK-CHALK-42', 'Chalk', '42', 12900, 'active'),
    ('MER-COURT-SNEAK-CHALK-43', 'item-meridian-court-sneaker', 'MER-COURT-SNEAK-CHALK-43', 'Chalk', '43', 12900, 'active'),
    ('MER-COURT-SNEAK-CHALK-44', 'item-meridian-court-sneaker', 'MER-COURT-SNEAK-CHALK-44', 'Chalk', '44', 12900, 'active'),
    ('MER-COURT-SNEAK-CHALK-45', 'item-meridian-court-sneaker', 'MER-COURT-SNEAK-CHALK-45', 'Chalk', '45', 12900, 'active'),
    ('MER-COURT-SNEAK-INK-40',   'item-meridian-court-sneaker', 'MER-COURT-SNEAK-INK-40',   'Ink',   '40', 12900, 'active'),
    ('MER-COURT-SNEAK-INK-41',   'item-meridian-court-sneaker', 'MER-COURT-SNEAK-INK-41',   'Ink',   '41', 12900, 'active'),
    ('MER-COURT-SNEAK-INK-42',   'item-meridian-court-sneaker', 'MER-COURT-SNEAK-INK-42',   'Ink',   '42', 12900, 'active'),
    ('MER-COURT-SNEAK-INK-43',   'item-meridian-court-sneaker', 'MER-COURT-SNEAK-INK-43',   'Ink',   '43', 12900, 'active'),
    ('MER-COURT-SNEAK-INK-44',   'item-meridian-court-sneaker', 'MER-COURT-SNEAK-INK-44',   'Ink',   '44', 12900, 'active'),
    ('MER-COURT-SNEAK-INK-45',   'item-meridian-court-sneaker', 'MER-COURT-SNEAK-INK-45',   'Ink',   '45', 12900, 'active'),

    -- item-harbor-wool-throw / HAR-WOOL-THROW: 2 colours x 1 size
    ('HAR-WOOL-THROW-FOG-ONESIZE',  'item-harbor-wool-throw', 'HAR-WOOL-THROW-FOG-ONESIZE',  'Fog',  'One Size', 11900, 'active'),
    ('HAR-WOOL-THROW-RUST-ONESIZE', 'item-harbor-wool-throw', 'HAR-WOOL-THROW-RUST-ONESIZE', 'Rust', 'One Size', 11900, 'active'),

    -- item-terra-pour-over-set / TER-POUR-01: 2 colours x 1 size
    ('TER-POUR-01-SAND-1L', 'item-terra-pour-over-set', 'TER-POUR-01-SAND-1L', 'Sand', '1L', 6400, 'active'),
    ('TER-POUR-01-CLAY-1L', 'item-terra-pour-over-set', 'TER-POUR-01-CLAY-1L', 'Clay', '1L', 6400, 'active'),

    -- item-solstice-trail-bottle / SOL-TRAIL-BTL: 2 colours x 2 sizes
    ('SOL-TRAIL-BTL-GLACIER-500ML', 'item-solstice-trail-bottle', 'SOL-TRAIL-BTL-GLACIER-500ML', 'Glacier', '500ml', 3200, 'active'),
    ('SOL-TRAIL-BTL-GLACIER-750ML', 'item-solstice-trail-bottle', 'SOL-TRAIL-BTL-GLACIER-750ML', 'Glacier', '750ml', 3200, 'active'),
    ('SOL-TRAIL-BTL-EMBER-500ML',   'item-solstice-trail-bottle', 'SOL-TRAIL-BTL-EMBER-500ML',   'Ember',   '500ml', 3200, 'inactive'),
    ('SOL-TRAIL-BTL-EMBER-750ML',   'item-solstice-trail-bottle', 'SOL-TRAIL-BTL-EMBER-750ML',   'Ember',   '750ml', 3200, 'inactive'),

    -- item-loom-everyday-tote / LOOM-TOTE-01: 2 colours x 1 size
    ('LOOM-TOTE-01-INK-ONESIZE',  'item-loom-everyday-tote', 'LOOM-TOTE-01-INK-ONESIZE',  'Ink',  'One Size', 7400, 'active'),
    ('LOOM-TOTE-01-CLAY-ONESIZE', 'item-loom-everyday-tote', 'LOOM-TOTE-01-CLAY-ONESIZE', 'Clay', 'One Size', 7400, 'active')
ON CONFLICT (variant_id) DO UPDATE
SET product_id  = EXCLUDED.product_id,
    sku         = EXCLUDED.sku,
    color       = EXCLUDED.color,
    size        = EXCLUDED.size,
    price_cents = EXCLUDED.price_cents,
    status      = EXCLUDED.status,
    updated_at  = now();

-- ---------------------------------------------------------------------------
-- product_variant_images
--
-- One row per variant, 37 rows, driven off the variant table so the count
-- cannot drift from the variant count. A colour picks one photo and every size
-- in that colour reuses it, so the image set is 13 distinct Unsplash photos
-- rather than 37 near-duplicates.
--
-- `image_url` is an Unsplash CDN URL and `source_url` is the Unsplash source
-- page. These are placeholder links for an example database, not licensed
-- production imagery; see db/README.md before using any of them for real.
--
-- `alt_text` is composed from the product name, the colour and the size rather
-- than typed 37 times, so it always describes the row it sits on.
-- ---------------------------------------------------------------------------
INSERT INTO ecom_example.product_variant_images
    (variant_id, image_url, source_url, alt_text, position)
SELECT v.variant_id,
       'https://images.unsplash.com/' || c.photo_id
           || '?auto=format&fit=crop&w=1200&q=80',
       'https://unsplash.com/',
       p.name || ' in ' || v.color || ', size ' || v.size
           || ', from the ' || p.brand || ' example catalogue',
       1
FROM ecom_example.product_variants v
JOIN ecom_example.products p
  ON p.product_id = v.product_id
JOIN (VALUES
    ('item-aurora-linen-shirt',   'Sand',   'photo-1521572163474-6864f9cf17ab'),
    ('item-aurora-linen-shirt',   'Navy',   'photo-1596755094514-f87e34085b2c'),
    ('item-aurora-linen-shirt',   'Olive',  'photo-1602810318383-e386cc2a3ccf'),
    ('item-meridian-court-sneaker','Chalk',  'photo-1595950653106-6c9ebd614d3a'),
    ('item-meridian-court-sneaker','Ink',    'photo-1542291026-7eec264c27ff'),
    ('item-harbor-wool-throw',    'Fog',    'photo-1519710164239-da123dc03ef4'),
    ('item-harbor-wool-throw',    'Rust',   'photo-1616486338812-3dadae4b4ace'),
    ('item-terra-pour-over-set',  'Sand',   'photo-1514432324607-a09d9b4aefdd'),
    ('item-terra-pour-over-set',  'Clay',   'photo-1447933601403-0c6688de566e'),
    ('item-solstice-trail-bottle','Glacier','photo-1602143407151-7111542de6e8'),
    ('item-solstice-trail-bottle','Ember',  'photo-1523362628745-0c100150b504'),
    ('item-loom-everyday-tote',   'Ink',    'photo-1594223274512-ad4803739b7c'),
    ('item-loom-everyday-tote',   'Clay',   'photo-1590874103328-eac38a683ce7')
) AS c (product_id, color, photo_id)
  ON c.product_id = v.product_id
 AND c.color      = v.color
ON CONFLICT (variant_id) DO UPDATE
SET image_url  = EXCLUDED.image_url,
    source_url = EXCLUDED.source_url,
    alt_text   = EXCLUDED.alt_text,
    position   = EXCLUDED.position;

-- ---------------------------------------------------------------------------
-- inventory_levels
--
-- Stock is written as literal variant ids on purpose: a typo here is a foreign
-- key violation, not a row nobody notices. The 1-unit and 2-unit entries are
-- deliberate, so the example data includes near-sold-out variants that a
-- checkout oversell check has something to reject.
-- ---------------------------------------------------------------------------
INSERT INTO ecom_example.inventory_levels
    (variant_id, quantity_on_hand, quantity_reserved, reorder_point)
VALUES
    ('AUR-LIN-SHIRT-SAND-XS',   24, 1, 6),
    ('AUR-LIN-SHIRT-SAND-S',    31, 2, 6),
    ('AUR-LIN-SHIRT-SAND-M',    38, 3, 8),
    ('AUR-LIN-SHIRT-SAND-L',    27, 1, 6),
    ('AUR-LIN-SHIRT-SAND-XL',   12, 0, 6),
    ('AUR-LIN-SHIRT-NAVY-XS',   19, 0, 6),
    ('AUR-LIN-SHIRT-NAVY-S',    26, 1, 6),
    ('AUR-LIN-SHIRT-NAVY-M',    33, 2, 8),
    ('AUR-LIN-SHIRT-NAVY-L',    21, 1, 6),
    ('AUR-LIN-SHIRT-NAVY-XL',    8, 0, 6),
    ('AUR-LIN-SHIRT-OLIVE-XS',  14, 0, 6),
    ('AUR-LIN-SHIRT-OLIVE-S',   17, 1, 6),
    ('AUR-LIN-SHIRT-OLIVE-M',   22, 1, 6),
    ('AUR-LIN-SHIRT-OLIVE-L',   15, 0, 6),
    ('AUR-LIN-SHIRT-OLIVE-XL',   5, 0, 6),
    ('MER-COURT-SNEAK-CHALK-40', 16, 1, 4),
    ('MER-COURT-SNEAK-CHALK-41', 22, 2, 4),
    ('MER-COURT-SNEAK-CHALK-42', 25, 3, 5),
    ('MER-COURT-SNEAK-CHALK-43', 18, 1, 4),
    ('MER-COURT-SNEAK-CHALK-44', 11, 0, 4),
    ('MER-COURT-SNEAK-CHALK-45',  6, 0, 4),
    ('MER-COURT-SNEAK-INK-40',   14, 0, 4),
    ('MER-COURT-SNEAK-INK-41',   19, 1, 4),
    ('MER-COURT-SNEAK-INK-42',   21, 2, 5),
    ('MER-COURT-SNEAK-INK-43',   15, 1, 4),
    ('MER-COURT-SNEAK-INK-44',    9, 0, 4),
    ('MER-COURT-SNEAK-INK-45',    3, 0, 4),
    ('HAR-WOOL-THROW-FOG-ONESIZE',   12, 0, 3),
    ('HAR-WOOL-THROW-RUST-ONESIZE',   7, 1, 3),
    ('TER-POUR-01-SAND-1L',         30, 2, 8),
    ('TER-POUR-01-CLAY-1L',         22, 1, 8),
    ('SOL-TRAIL-BTL-GLACIER-500ML', 45, 3, 10),
    ('SOL-TRAIL-BTL-GLACIER-750ML', 28, 1, 10),
    ('SOL-TRAIL-BTL-EMBER-500ML',    14, 0, 10),
    ('SOL-TRAIL-BTL-EMBER-750ML',     1, 0, 10),
    ('LOOM-TOTE-01-INK-ONESIZE',    26, 2, 6),
    ('LOOM-TOTE-01-CLAY-ONESIZE',    9, 0, 6)
ON CONFLICT (variant_id) DO UPDATE
SET quantity_on_hand  = EXCLUDED.quantity_on_hand,
    quantity_reserved = EXCLUDED.quantity_reserved,
    reorder_point     = EXCLUDED.reorder_point,
    updated_at        = now();

-- ---------------------------------------------------------------------------
-- no-missing-image invariant
--
-- The image insert above is an inner join, so a (product, colour) pair with no
-- photo would silently produce fewer image rows than variants. This turns that
-- into a failed load instead of a quietly broken example database, and it runs
-- inside the seed transaction so nothing is committed unless the data is whole.
--
-- The mirror case (an image with no variant) is impossible: the image table's
-- primary key is also a foreign key to the variant, and a variant cannot have
-- two images.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    missing integer;
BEGIN
    SELECT count(*) INTO missing
    FROM ecom_example.product_variants v
    WHERE NOT EXISTS (
        SELECT 1
        FROM ecom_example.product_variant_images i
        WHERE i.variant_id = v.variant_id
    );

    IF missing > 0 THEN
        RAISE EXCEPTION
            'seed incomplete: % variant(s) have no image row, so the no-missing-image invariant is broken',
            missing;
    END IF;
END
$$;

COMMIT;
