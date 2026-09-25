/**
 * Payloads shaped exactly as `src/web-server.ts` answers them, with one product
 * that has two colours and two sizes each. The storefront needs a second colour
 * to prove colour filters size, and one sold-out variant to prove the
 * availability state, so this is not a one-product stub.
 */

export const variant = (over: Record<string, unknown> = {}) => ({
  id: "SOL-TRAIL-BTL-SAND-750ML",
  variant_id: "SOL-TRAIL-BTL-SAND-750ML",
  color: "Sand",
  size: "750ml",
  price_cents: 4500,
  image_url: "https://images.unsplash.com/photo-1?w=600",
  image_alt: "Sand trail bottle",
  available: 4,
  active: true,
  sellable: true,
  ...over,
});

export const catalogPayload = {
  mode: "demo",
  in_memory: true,
  source: "db/seed.sql example data",
  counts: { products: 1, variants: 4, sellable_variants: 3, unavailable_variants: 1 },
  products: [
    {
      id: "SOL-TRAIL-BTL",
      sku: "SOL-TRAIL-BTL",
      name: "Sol Trail Bottle",
      brand: "Atlas",
      category: "Drinkware",
      description: "A narrow trail bottle with a cork collar.",
      active: true,
      available: 7,
      variants: [
        variant(),
        variant({ id: "SOL-TRAIL-BTL-SAND-500ML", variant_id: "SOL-TRAIL-BTL-SAND-500ML", size: "500ml", available: 2 }),
        variant({
          id: "SOL-TRAIL-BTL-SLATE-750ML",
          variant_id: "SOL-TRAIL-BTL-SLATE-750ML",
          color: "Slate",
          image_url: "https://images.unsplash.com/photo-2?w=600",
          image_alt: "Slate trail bottle",
          available: 1,
        }),
        variant({
          id: "SOL-TRAIL-BTL-SLATE-500ML",
          variant_id: "SOL-TRAIL-BTL-SLATE-500ML",
          color: "Slate",
          size: "500ml",
          available: 0,
          sellable: false,
        }),
      ],
    },
  ],
};

export const emptyCartPayload = {
  mode: "demo",
  in_memory: true,
  item_count: 0,
  total_cents: 0,
  lines: [],
};

export const cartLine = {
  product_id: "SOL-TRAIL-BTL-SAND-750ML",
  name: "Sol Trail Bottle (Sand / 750ml)",
  unit_price_cents: 4500,
  quantity: 1,
  line_total_cents: 4500,
};

export const cartPayload = { mode: "demo", in_memory: true, item_count: 1, total_cents: 4500, lines: [cartLine] };

export const addToCartPayload = { ...cartPayload, added: cartLine };

export const summaryPayload = { order_count: 1, total_cents: 4500 };

export const orderPayload = {
  id: "order-1",
  status: "created",
  lines: [cartLine],
  total_cents: 4500,
};

export const ordersPayload = {
  mode: "demo",
  in_memory: true,
  summary: summaryPayload,
  orders: [orderPayload],
};

export const checkoutPayload = {
  mode: "demo",
  in_memory: true,
  paid: false,
  persisted: false,
  order: orderPayload,
  summary: { order_count: 1, total_cents: 4500 },
};

export const healthPayload = {
  status: "ok",
  product: "atlas-ecom",
  mode: "demo",
  in_memory: true,
  database: "none",
  peer_connected: false,
  source: "db/seed.sql example data",
  catalog: catalogPayload.counts,
  cart: { item_count: 1, total_cents: 4500 },
  orders: summaryPayload,
};

export const apiRoutes = {
  "/api/health": healthPayload,
  "/api/catalog": catalogPayload,
  "/api/cart": cartPayload,
  "/api/orders": ordersPayload,
  "/api/checkout": checkoutPayload,
};

/** What `POST /api/catalog` answers: the read envelope plus the created product. */
export const createdProduct = {
  id: "8f14e45f-ea5c-4b1a-9f3d-new-coffee",
  sku: "8f14e45",
  name: "Atlas Coffee",
  brand: "Operator added",
  category: "Uncategorised",
  description: "",
  active: true,
  available: 10,
  variants: [
    {
      id: "8f14e45f-ea5c-4b1a-9f3d-new-coffee",
      variant_id: "8f14e45f-ea5c-4b1a-9f3d-new-coffee",
      color: "Unspecified",
      size: "One Size",
      price_cents: 1250,
      image_url: null,
      image_alt: null,
      available: 10,
      active: true,
      sellable: true,
    },
  ],
};

export const createProductPayload = {
  mode: "demo",
  in_memory: true,
  source: catalogPayload.source,
  counts: { products: 2, variants: 5, sellable_variants: 4, unavailable_variants: 1 },
  product: createdProduct,
};

/** The catalogue after the create, as the reload reads it back. */
export const catalogAfterCreate = {
  ...catalogPayload,
  counts: createProductPayload.counts,
  products: [...catalogPayload.products, createdProduct],
};

export const healthAfterCreate = {
  ...healthPayload,
  catalog: createProductPayload.counts,
};
