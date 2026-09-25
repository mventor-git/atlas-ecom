import { randomUUID } from "node:crypto";

export interface Product {
  id: string;
  name: string;
  /** Integer minor units. No floating point money in this slice. */
  price_cents: number;
  /** Units a cart may hold. Availability is decremented at checkout. */
  quantity: number;
  active: boolean;
}

export interface NewProduct {
  name: string;
  price_cents: number;
  quantity: number;
}

export interface ProductPatch {
  name?: string;
  price_cents?: number;
  quantity?: number;
}

export interface CartLine {
  product_id: string;
  name: string;
  unit_price_cents: number;
  quantity: number;
  line_total_cents: number;
}

export interface OrderLine {
  readonly product_id: string;
  readonly name: string;
  readonly unit_price_cents: number;
  readonly quantity: number;
  readonly line_total_cents: number;
}

export interface Order {
  readonly id: string;
  /** `submitted` means the order was accepted by a connected peer. */
  readonly status: "created" | "submitted";
  readonly lines: readonly OrderLine[];
  readonly total_cents: number;
  /** Absent on a local order; `connected` marks a peer-backed order. */
  readonly source?: "standalone" | "connected";
  /** The peer's own sale id, kept so the two records can be reconciled. */
  readonly remote_sale_id?: string;
}

export interface OrderSummary {
  readonly order_count: number;
  readonly total_cents: number;
}

// Keep checkout's write hook module-local; callers only receive the read surface.
const recordOrder = Symbol("recordOrder");

function freezeOrder(order: Order): Order {
  return Object.freeze({
    id: order.id,
    status: order.status,
    lines: Object.freeze(order.lines.map((line) => Object.freeze({ ...line }))),
    total_cents: order.total_cents,
    ...(order.source === undefined ? {} : { source: order.source }),
    ...(order.remote_sale_id === undefined ? {} : { remote_sale_id: order.remote_sale_id }),
  });
}

/** In-memory local order readback. Orders remain available until process exit. */
export class OrderBook {
  private readonly orders = new Map<string, Order>();

  [recordOrder](order: Order): void {
    this.orders.set(order.id, order);
  }

  /**
   * The one controlled write path for a connected checkout. The local cart
   * keeps its module-local symbol, so a peer-backed order may only enter here,
   * and only once: an id that is already recorded is never replaced.
   */
  recordConnectedOrder(order: Order): Order {
    if (order.source !== "connected" || order.status !== "submitted") {
      throw new Error("OrderBook records only a submitted connected order");
    }
    if (typeof order.remote_sale_id !== "string" || order.remote_sale_id.trim() === "") {
      throw new Error("A connected order requires the peer's remote_sale_id");
    }
    if (this.orders.has(order.id)) {
      throw new Error(`Order "${order.id}" is already recorded`);
    }
    const frozen = freezeOrder(order);
    this[recordOrder](frozen);
    return frozen;
  }

  getOrder(id: string): Order | undefined {
    const order = this.orders.get(id);
    return order === undefined ? undefined : freezeOrder(order);
  }

  listOrders(): readonly Order[] {
    return Object.freeze([...this.orders.values()].map((order) => freezeOrder(order)));
  }

  summary(): OrderSummary {
    let total_cents = 0;
    for (const order of this.orders.values()) {
      total_cents += order.total_cents;
    }
    return Object.freeze({ order_count: this.orders.size, total_cents });
  }
}

function assertText(value: string, label: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertWholeNumber(value: number, label: string, minimum: number): void {
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${label} must be an integer of at least ${minimum}`);
  }
}

/**
 * Ecom's own catalog while no peer is paired. The operator writes products
 * directly, which is acceptance gate 3's standalone branch. The connected
 * branch (submit a proposal to a peer master) is not implemented here; that
 * belongs to ProtocolKernel. State is in-memory only and is lost on restart.
 */
export class StandaloneCatalog {
  private readonly products = new Map<string, Product>();

  addProduct(input: NewProduct): Product {
    assertText(input.name, "Product name");
    assertWholeNumber(input.price_cents, "Product price_cents", 0);
    assertWholeNumber(input.quantity, "Product quantity", 0);

    const product: Product = {
      id: randomUUID(),
      name: input.name,
      price_cents: input.price_cents,
      quantity: input.quantity,
      active: true,
    };
    this.products.set(product.id, product);
    return { ...product };
  }

  updateProduct(id: string, patch: ProductPatch): Product {
    const current = this.require(id);
    if (patch.name !== undefined) {
      assertText(patch.name, "Product name");
    }
    if (patch.price_cents !== undefined) {
      assertWholeNumber(patch.price_cents, "Product price_cents", 0);
    }
    if (patch.quantity !== undefined) {
      assertWholeNumber(patch.quantity, "Product quantity", 0);
    }

    const updated: Product = { ...current, ...patch, id: current.id, active: current.active };
    this.products.set(updated.id, updated);
    return { ...updated };
  }

  deactivateProduct(id: string): Product {
    const current = this.require(id);
    const updated: Product = { ...current, active: false };
    this.products.set(updated.id, updated);
    return { ...updated };
  }

  /** Applies all checkout stock changes only after every line has passed validation. */
  commitCheckout(lines: readonly CartLine[]): void {
    if (lines.length === 0) {
      throw new Error("Cannot check out an empty cart");
    }

    const updates = new Map<string, number>();
    for (const line of lines) {
      if (updates.has(line.product_id)) {
        throw new Error(`Duplicate product "${line.product_id}" in checkout lines`);
      }
      assertWholeNumber(line.quantity, "Cart quantity", 1);
      const product = this.require(line.product_id);
      if (!product.active) {
        throw new Error(`Product "${line.product_id}" is not active`);
      }
      if (product.price_cents !== line.unit_price_cents) {
        throw new Error(
          `Stale price for product "${line.product_id}": price changed since it was added to the cart`,
        );
      }
      if (line.quantity > product.quantity) {
        throw new Error(`Only ${product.quantity} of "${line.product_id}" available`);
      }
      updates.set(product.id, product.quantity - line.quantity);
    }

    for (const [productId, quantity] of updates) {
      const product = this.require(productId);
      this.products.set(productId, { ...product, quantity });
    }
  }

  /** Returns an inactive product too; the cart is what refuses to sell one. */
  getProduct(id: string): Product | undefined {
    const product = this.products.get(id);
    return product === undefined ? undefined : { ...product };
  }

  /** The storefront view: active products only, in insertion order. */
  listProducts(): Product[] {
    return [...this.products.values()]
      .filter((product) => product.active)
      .map((product) => ({ ...product }));
  }

  private require(id: string): Product {
    const product = this.products.get(id);
    if (product === undefined) {
      throw new Error(`Unknown product "${id}"`);
    }
    return product;
  }
}

/**
 * A customer cart over the local catalog. Lines are keyed by product so
 * repeated adds aggregate into one line in first-added order, and every value
 * is derived from the local catalog, never from a peer.
 */
export class Cart {
  private readonly catalog: StandaloneCatalog;
  private readonly orderBook: OrderBook;
  private readonly lines = new Map<string, CartLine>();

  constructor(catalog: StandaloneCatalog, orderBook = new OrderBook()) {
    this.catalog = catalog;
    this.orderBook = orderBook;
  }

  get orders(): OrderBook {
    return this.orderBook;
  }

  /** The line price is the catalog price at the last add, so later price edits apply on the next add. */
  addItem(productId: string, quantity: number): CartLine {
    assertWholeNumber(quantity, "Cart quantity", 1);

    const product = this.catalog.getProduct(productId);
    if (product === undefined) {
      throw new Error(`Unknown product "${productId}"`);
    }
    if (!product.active) {
      throw new Error(`Product "${productId}" is not active`);
    }

    const next = (this.lines.get(productId)?.quantity ?? 0) + quantity;
    if (next > product.quantity) {
      throw new Error(`Only ${product.quantity} of "${productId}" available`);
    }

    const line: CartLine = {
      product_id: product.id,
      name: product.name,
      unit_price_cents: product.price_cents,
      quantity: next,
      line_total_cents: product.price_cents * next,
    };
    this.lines.set(productId, line);
    return { ...line };
  }

  listLines(): CartLine[] {
    return [...this.lines.values()].map((line) => ({ ...line }));
  }

  totalCents(): number {
    let total = 0;
    for (const line of this.lines.values()) {
      total += line.line_total_cents;
    }
    return total;
  }

  /** Revalidates the current cart and atomically creates one order. */
  checkout(): Order {
    const lines = this.listLines();
    if (lines.length === 0) {
      throw new Error("Cannot check out an empty cart");
    }

    const order = freezeOrder({
      id: randomUUID(),
      status: "created",
      lines,
      total_cents: this.totalCents(),
    });

    this.catalog.commitCheckout(lines);
    this.orderBook[recordOrder](order);
    this.lines.clear();
    return order;
  }
}
