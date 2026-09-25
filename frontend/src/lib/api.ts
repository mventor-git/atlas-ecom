import { z } from "zod";

/**
 * The Ecom Node API is this frontend's only data source, so every shape below is
 * parsed from a live route rather than restated from the domain types. If a
 * route drifts, the parse fails here instead of rendering `undefined` into a
 * price. Nothing in this file reads a database, duplicates commerce rules, or
 * computes money: `price_cents` and `total_cents` are integer cents end to end.
 */

export const API_BASE = "/api";

/** A domain rejection answers 400 with its own message, so it is shown as-is. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const money = z.number().int();

const countsSchema = z.object({
  products: z.number().int(),
  variants: z.number().int(),
  sellable_variants: z.number().int(),
  unavailable_variants: z.number().int(),
});

const catalogVariantSchema = z.object({
  id: z.string(),
  variant_id: z.string(),
  color: z.string(),
  size: z.string(),
  price_cents: money,
  image_url: z.string().nullable(),
  image_alt: z.string().nullable(),
  available: z.number().int(),
  active: z.boolean(),
  sellable: z.boolean(),
});

const catalogProductSchema = z.object({
  id: z.string(),
  sku: z.string(),
  name: z.string(),
  brand: z.string(),
  category: z.string(),
  description: z.string(),
  active: z.boolean(),
  available: z.number().int(),
  variants: z.array(catalogVariantSchema),
});

const cartLineSchema = z.object({
  product_id: z.string(),
  name: z.string(),
  unit_price_cents: money,
  quantity: z.number().int(),
  line_total_cents: money,
});

const cartSchema = z.object({
  mode: z.string(),
  in_memory: z.boolean(),
  item_count: z.number().int(),
  total_cents: money,
  lines: z.array(cartLineSchema),
});

const orderSchema = z.object({
  id: z.string(),
  status: z.enum(["created", "submitted"]),
  lines: z.array(cartLineSchema),
  total_cents: money,
  source: z.enum(["standalone", "connected"]).optional(),
  remote_sale_id: z.string().optional(),
});

const summarySchema = z.object({
  order_count: z.number().int(),
  total_cents: money,
});

const ordersSchema = z.object({
  mode: z.string(),
  in_memory: z.boolean(),
  summary: summarySchema,
  orders: z.array(orderSchema),
});

const checkoutSchema = z.object({
  mode: z.string(),
  in_memory: z.boolean(),
  /** The API is explicit that a checkout is neither paid nor persisted. */
  paid: z.literal(false),
  persisted: z.literal(false),
  order: orderSchema,
  summary: summarySchema,
});

const healthSchema = z.object({
  status: z.string(),
  product: z.string(),
  mode: z.string(),
  in_memory: z.boolean(),
  database: z.string(),
  peer_connected: z.boolean(),
  source: z.string(),
  catalog: countsSchema,
  cart: z.object({ item_count: z.number().int(), total_cents: money }),
  orders: summarySchema,
});

export type CatalogCounts = z.infer<typeof countsSchema>;
export type CatalogVariant = z.infer<typeof catalogVariantSchema>;
export type CatalogProduct = z.infer<typeof catalogProductSchema>;
export type CartLine = z.infer<typeof cartLineSchema>;
export type Cart = z.infer<typeof cartSchema>;
export type Order = z.infer<typeof orderSchema>;
export type OrderSummary = z.infer<typeof summarySchema>;
export type Orders = z.infer<typeof ordersSchema>;
export type Checkout = z.infer<typeof checkoutSchema>;
export type Health = z.infer<typeof healthSchema>;

const catalogSchema = z.object({
  mode: z.string(),
  in_memory: z.boolean(),
  source: z.string(),
  counts: countsSchema,
  products: z.array(catalogProductSchema),
});

/**
 * The create envelope is the read envelope plus the created product, so one
 * parser covers both and the counts on a write are the catalogue as it now is.
 */
const createProductSchema = z.object({
  mode: z.string(),
  in_memory: z.boolean(),
  source: z.string(),
  counts: countsSchema,
  product: catalogProductSchema,
});

export type Catalog = z.infer<typeof catalogSchema>;
export type CreatedProduct = z.infer<typeof createProductSchema>;

export type NewProduct = {
  readonly name: string;
  readonly price_cents: number;
  readonly quantity: number;
};

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: init?.body === undefined ? undefined : { "Content-Type": "application/json" },
  });

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload !== null && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
        ? (payload as { error: string }).error
        : `Request to ${path} failed with ${response.status}`;
    throw new ApiError(response.status, message);
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(response.status, `${path} returned a shape this frontend does not understand`);
  }
  return parsed.data;
}

export const api = {
  health: () => request("/health", healthSchema),

  catalog: () => request("/catalog", catalogSchema),

  /**
   * Add Product, the standalone branch. No peer is paired, so the write goes
   * straight into the in-memory catalogue; with a peer holding the capability
   * this same call becomes a proposal instead, which is a server-side change and
   * not something the browser decides.
   */
  addProduct: (input: NewProduct) =>
    request("/catalog", createProductSchema, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  cart: () => request("/cart", cartSchema),

  addToCart: (variantId: string, quantity: number) =>
    request("/cart", cartSchema.extend({ added: cartLineSchema }), {
      method: "POST",
      body: JSON.stringify({ variant_id: variantId, quantity }),
    }),

  orders: () => request("/orders", ordersSchema),

  checkout: () => request("/checkout", checkoutSchema, { method: "POST", body: "{}" }),
};
