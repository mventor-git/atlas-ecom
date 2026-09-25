import { Cart, OrderBook, StandaloneCatalog } from "./commerce.ts";

/**
 * The example catalogue from `db/seed.sql`, as in-process data.
 *
 * The demo UI needs the seed's identity, price, stock, status and imagery, so
 * those are copied verbatim: 6 products, 37 colour/size variants, one Unsplash
 * image per variant, the two `Ember` bottle variants `inactive`, and
 * `SOL-TRAIL-BTL-EMBER-750ML` left on a single unit so an oversell is a real
 * case. Descriptions are abridged. Nothing here reads a database: the UI is
 * in-memory and is rebuilt from this fixture on every start.
 *
 * `test/demo-catalog.test.ts` diffs this fixture against the committed
 * `db/seed.sql`, so a seed change that is not mirrored here fails the suite.
 */

/** `[color, size, available units]`, plus `"inactive"` for a non-sellable variant. */
export type DemoVariantSeed =
  | readonly [color: string, size: string, available: number]
  | readonly [color: string, size: string, available: number, status: "inactive"];

export interface DemoProductSeed {
  /** The ERP `item_id` for the same product, as in the seed. */
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly brand: string;
  readonly category: string;
  readonly description: string;
  readonly price_cents: number;
  /** One photo per colour; every size in a colour reuses it, as in the seed. */
  readonly photos: Readonly<Record<string, string>>;
  readonly variants: readonly DemoVariantSeed[];
}

export const DEMO_PRODUCT_SEEDS: readonly DemoProductSeed[] = [
  {
    id: "item-aurora-linen-shirt",
    sku: "AUR-LIN-SHIRT",
    name: "Aurora Everyday Linen Shirt",
    brand: "Northline",
    category: "Apparel",
    description:
      "Washed-down linen-cotton, cut boxy with a straight hem and one high patch pocket. The cloth softens with every wash rather than going limp.",
    price_cents: 8900,
    photos: {
      Sand: "photo-1521572163474-6864f9cf17ab",
      Navy: "photo-1596755094514-f87e34085b2c",
      Olive: "photo-1602810318383-e386cc2a3ccf",
    },
    // 3 colours x 5 sizes
    variants: [
      ["Sand", "XS", 23], ["Sand", "S", 29], ["Sand", "M", 35], ["Sand", "L", 26], ["Sand", "XL", 12],
      ["Navy", "XS", 19], ["Navy", "S", 25], ["Navy", "M", 31], ["Navy", "L", 20], ["Navy", "XL", 8],
      ["Olive", "XS", 14], ["Olive", "S", 16], ["Olive", "M", 21], ["Olive", "L", 15], ["Olive", "XL", 5],
    ],
  },
  {
    id: "item-meridian-court-sneaker",
    sku: "MER-COURT-SNEAK",
    name: "Meridian Court Sneaker",
    brand: "Meridian",
    category: "Footwear",
    description:
      "A low-profile court sneaker on a stitched leather upper and a cupsole that takes a resole. Rigid heel counter, deliberately roomy toe box.",
    price_cents: 12900,
    photos: {
      Chalk: "photo-1595950653106-6c9ebd614d3a",
      Ink: "photo-1542291026-7eec264c27ff",
    },
    // 2 colours x 6 sizes
    variants: [
      ["Chalk", "40", 15], ["Chalk", "41", 20], ["Chalk", "42", 22], ["Chalk", "43", 17], ["Chalk", "44", 11], ["Chalk", "45", 6],
      ["Ink", "40", 14], ["Ink", "41", 18], ["Ink", "42", 19], ["Ink", "43", 14], ["Ink", "44", 9], ["Ink", "45", 3],
    ],
  },
  {
    id: "item-harbor-wool-throw",
    sku: "HAR-WOOL-THROW",
    name: "Harbor Wool Throw",
    brand: "Hearthline",
    category: "Home",
    description:
      "A dense lambswool and alpaca throw, heavy enough to hold its own over a chair back. Herringbone woven, hand-knotted fringe.",
    price_cents: 11900,
    photos: {
      Fog: "photo-1519710164239-da123dc03ef4",
      Rust: "photo-1616486338812-3dadae4b4ace",
    },
    // 2 colours x 1 size
    variants: [
      ["Fog", "One Size", 12],
      ["Rust", "One Size", 6],
    ],
  },
  {
    id: "item-terra-pour-over-set",
    sku: "TER-POUR-01",
    name: "Terra Pour-Over Set",
    brand: "Kiln & Coast",
    category: "Kitchen",
    description:
      "A one-litre dripper and carafe in unglazed stoneware, sized so the brew sits in the carafe and nowhere else. Dishwasher safe.",
    price_cents: 6400,
    photos: {
      Sand: "photo-1514432324607-a09d9b4aefdd",
      Clay: "photo-1447933601403-0c6688de566e",
    },
    // 2 colours x 1 size
    variants: [
      ["Sand", "1L", 28],
      ["Clay", "1L", 21],
    ],
  },
  {
    id: "item-solstice-trail-bottle",
    sku: "SOL-TRAIL-BTL",
    name: "Solstice Trail Bottle",
    brand: "Fieldcraft",
    category: "Outdoors",
    description:
      "Single-wall stainless with a wide mouth that fits a brush and a collapsible filter. The lid seal is replaceable.",
    price_cents: 3200,
    photos: {
      Glacier: "photo-1602143407151-7111542de6e8",
      Ember: "photo-1523362628745-0c100150b504",
    },
    // 2 colours x 2 sizes; both Ember variants are catalogued but not sellable
    variants: [
      ["Glacier", "500ml", 42],
      ["Glacier", "750ml", 27],
      ["Ember", "500ml", 14, "inactive"],
      ["Ember", "750ml", 1, "inactive"],
    ],
  },
  {
    id: "item-loom-everyday-tote",
    sku: "LOOM-TOTE-01",
    name: "Loom Everyday Tote",
    brand: "Loom",
    category: "Bags",
    description:
      "Flat-bottomed 18oz cotton canvas with a bridle-leather base, sized to stand up on its own when you set it down.",
    price_cents: 7400,
    photos: {
      Ink: "photo-1594223274512-ad4803739b7c",
      Clay: "photo-1590874103328-eac38a683ce7",
    },
    // 2 colours x 1 size
    variants: [
      ["Ink", "One Size", 24],
      ["Clay", "One Size", 9],
    ],
  },
];

/** The deterministic `<PRODUCT SKU>-<COLOR>-<SIZE>` id the seed documents. */
export function demoVariantId(sku: string, color: string, size: string): string {
  const token = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9]+/g, "");
  return `${sku}-${token(color)}-${token(size)}`;
}

export function demoImageUrl(photoId: string): string {
  return `https://images.unsplash.com/${photoId}?auto=format&fit=crop&w=1200&q=80`;
}

/** Identity only: live price, availability and status stay in the catalog. */
export interface DemoVariantRef {
  readonly id: string;
  readonly variant_id: string;
  readonly color: string;
  readonly size: string;
}

export interface DemoProductRef {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly variants: readonly DemoVariantRef[];
}

export interface DemoStore {
  readonly catalog: StandaloneCatalog;
  readonly cart: Cart;
  readonly orderBook: OrderBook;
  /** The six seeded products, so a page can group variants under a parent. */
  readonly products: readonly DemoProductRef[];
}

/**
 * One fresh in-memory commerce store seeded with the example catalogue.
 * Catalog, cart and orders are process-local and are lost when the server stops.
 */
export function createDemoStore(): DemoStore {
  const catalog = new StandaloneCatalog();
  const orderBook = new OrderBook();

  const products = DEMO_PRODUCT_SEEDS.map((seed): DemoProductRef => {
    const variants = seed.variants.map(([color, size, available, status]) => {
      const variant_id = demoVariantId(seed.sku, color, size);
      const photoId = seed.photos[color];
      if (photoId === undefined) {
        throw new Error(`Demo product "${seed.sku}" has no photo for colour "${color}"`);
      }
      const product = catalog.addProduct({
        id: variant_id,
        sku: seed.sku,
        brand: seed.brand,
        category: seed.category,
        color,
        size,
        description: seed.description,
        name: `${seed.name} — ${color} / ${size}`,
        price_cents: seed.price_cents,
        quantity: available,
        image_url: demoImageUrl(photoId),
        image_alt: `${seed.name} in ${color}, size ${size}, from the ${seed.brand} example catalogue`,
      });
      if (status === "inactive") {
        catalog.deactivateProduct(product.id);
      }
      return { id: product.id, variant_id, color, size };
    });
    return { id: seed.id, sku: seed.sku, name: seed.name, variants };
  });

  return { catalog, cart: new Cart(catalog, orderBook), orderBook, products };
}
