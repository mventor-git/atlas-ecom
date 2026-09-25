import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import type { CartLine, Order, Product } from "./commerce.ts";
import { createDemoStore, type DemoStore } from "./demo-catalog.ts";

/**
 * The first browser surface for Atlas Ecom: a customer storefront at `/` and the
 * operator `ecom-manager` at `/manager`, over `node:http` only.
 *
 * DEMO SLICE. Every byte of state is process-local: the catalogue is rebuilt
 * from the committed `db/seed.sql` example data on every start, there is one
 * shared cart, there are no accounts, and nothing is written to a database. No
 * peer is connected, so this is the standalone branch of the contract. Stopping
 * the process loses the cart, the orders and anything the operator added.
 *
 * The server is deliberately unauthenticated and bound to loopback. It is a
 * demo, not a deployable surface.
 */

export const DEFAULT_WEB_PORT = 4312;
const WEB_HOST = "127.0.0.1";
/** A form or a JSON blob for one interaction; anything larger is not this slice. */
const MAX_BODY_BYTES = 8_192;

/**
 * The shared Atlas UI token set, exactly as `contract.md` v1.1.1 defines it, and
 * nothing else: every colour below resolves to one of these custom properties,
 * so a mode change is one attribute on `<html>` and no second palette to keep in
 * step. `accent.default` is a control surface here, never body text, and each
 * `state.*` token is used as the supplied foreground-on-background pair.
 */
const STYLE = `
:root, [data-theme="light"] {
  color-scheme: light;
  --atlas-bg-canvas: #F7F2EB; --atlas-bg-surface: #EAE2D6;
  --atlas-fg-default: #2D0000; --atlas-fg-muted: #6A2F2F;
  --atlas-accent: #8B9A6E; --atlas-link: #2D0000;
  --atlas-border-divider: #EEEEEE; --atlas-border-control: #757D6F;
  --atlas-on-accent: #2D0000; --atlas-focus-ring: #2D0000;
  --atlas-success-fg: #2A7C13; --atlas-success-bg: #C7D3C0;
  --atlas-warning-fg: #2D0000; --atlas-warning-bg: #C8A96B;
  --atlas-danger-fg: #6D0808; --atlas-danger-bg: #FFDADA;
  --atlas-info-fg: #2D0000; --atlas-info-bg: #FBE6C2;
}
[data-theme="dark"] {
  color-scheme: dark;
  --atlas-bg-canvas: #41444B; --atlas-bg-surface: #52575D;
  --atlas-fg-default: #DFD8C8; --atlas-fg-muted: #B7B3A9;
  --atlas-accent: #CABFAB; --atlas-link: #DFD8C8;
  --atlas-border-divider: #52575D; --atlas-border-control: #9AA394;
  --atlas-on-accent: #41444B; --atlas-focus-ring: #DFD8C8;
  --atlas-success-fg: #2D0000; --atlas-success-bg: #C7D3C0;
  --atlas-warning-fg: #2D0000; --atlas-warning-bg: #C8A96B;
  --atlas-danger-fg: #2D0000; --atlas-danger-bg: #FFDADA;
  --atlas-info-fg: #2D0000; --atlas-info-bg: #FBE6C2;
}
* { box-sizing: border-box; }
body { margin:0; padding:0 1rem 3rem; background:var(--atlas-bg-canvas); color:var(--atlas-fg-default);
  font:16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
header, main, footer { max-width:64rem; margin:0 auto; }
h1 { font-size:1.5rem; margin:1.25rem 0 .25rem; }
h2 { font-size:1.15rem; margin:2rem 0 .5rem; }
h3 { font-size:1rem; margin:0 0 .25rem; }
/* link.default keeps its underline, so it never relies on colour alone. */
a { color:var(--atlas-link); text-decoration:underline; }
/* focus.ring reaches every keyboard-focusable control. */
:focus-visible { outline:2px solid var(--atlas-focus-ring); outline-offset:2px; }
.demo { color:var(--atlas-info-fg); background:var(--atlas-info-bg);
  border:1px solid var(--atlas-border-control); padding:.6rem .8rem; border-radius:.4rem; font-size:.9rem; }
.grid { display:grid; gap:1rem; grid-template-columns:repeat(auto-fill, minmax(19rem, 1fr)); }
.card { border:1px solid var(--atlas-border-divider); background:var(--atlas-bg-surface);
  border-radius:.5rem; padding:.9rem; }
.card img { width:100%; height:11rem; object-fit:cover; border-radius:.35rem;
  background:var(--atlas-border-divider); }
.meta { color:var(--atlas-fg-muted); font-size:.85rem; margin:.15rem 0 .5rem; }
.buy { display:flex; flex-wrap:wrap; gap:.5rem; align-items:end; margin-top:.6rem; }
label { display:flex; flex-direction:column; font-size:.8rem; color:var(--atlas-fg-muted); gap:.15rem; }
select, input, button { font:inherit; padding:.35rem .5rem; border:1px solid var(--atlas-border-control);
  border-radius:.3rem; background:var(--atlas-bg-surface); color:var(--atlas-fg-default); }
/* accent.default paints controls; onAccent.default is its only text. */
button { background:var(--atlas-accent); color:var(--atlas-on-accent);
  border-color:var(--atlas-accent); cursor:pointer; }
button[disabled] { background:var(--atlas-bg-surface); color:var(--atlas-fg-muted);
  border-color:var(--atlas-border-divider); cursor:not-allowed; }
table { border-collapse:collapse; width:100%; font-size:.9rem; background:var(--atlas-bg-surface); }
th, td { border:1px solid var(--atlas-border-divider); padding:.35rem .5rem; text-align:left; }
th { background:var(--atlas-bg-canvas); }
td.num, th.num { text-align:right; font-variant-numeric:tabular-nums; }
img.thumb { width:2.5rem; height:2.5rem; object-fit:cover; border-radius:.2rem; }
.status { margin:1rem auto; max-width:64rem; font-size:.9rem; }
.out { color:var(--atlas-danger-fg); background:var(--atlas-danger-bg); }
.warn { color:var(--atlas-warning-fg); background:var(--atlas-warning-bg); }
.ok-note { color:var(--atlas-success-fg); background:var(--atlas-success-bg); }
.status[data-state="error"] { color:var(--atlas-danger-fg); background:var(--atlas-danger-bg); }
dl.stats { display:flex; flex-wrap:wrap; gap:1.25rem; margin:1rem 0; }
dl.stats div { border:1px solid var(--atlas-border-divider); background:var(--atlas-bg-surface);
  border-radius:.4rem; padding:.5rem .8rem; }
dl.stats dt { font-size:.75rem; color:var(--atlas-fg-muted); text-transform:uppercase; letter-spacing:.04em; }
dl.stats dd { margin:0; font-size:1.15rem; font-variant-numeric:tabular-nums; }
form.add { display:flex; flex-wrap:wrap; gap:.5rem; align-items:end; }
footer { margin-top:2.5rem; padding-top:1rem; border-top:1px solid var(--atlas-border-divider);
  font-size:.85rem; color:var(--atlas-fg-muted); }
`;

export type Theme = "light" | "dark";

/** The contract states one light/dark pair, and the light pair is the default. */
export const DEFAULT_THEME: Theme = "light";

/**
 * Only an explicit `dark` selects dark. Absent, empty and unrecognised values
 * fall back to light rather than erroring, so a bad link still renders a page.
 */
export function readTheme(value: string | null | undefined): Theme {
  return value === "dark" ? "dark" : "light";
}

/** JSON-escapes and HTML-escapes in one pass; every dynamic value goes through it. */
function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Integer minor units only: no float money reaches a rendered page. */
function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const value = Math.abs(cents);
  return `${sign}$${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** A domain rejection is the caller's fault, so it answers 400 and keeps its message. */
function clientError<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Bad request");
  }
}

interface VariantView {
  readonly id: string;
  readonly variant_id: string;
  readonly color: string;
  readonly size: string;
  readonly product: Product;
}

interface ProductView {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly brand: string;
  readonly category: string;
  readonly description: string;
  readonly variants: readonly VariantView[];
}

/**
 * Groups the seeded variants under their parent product, and gives anything the
 * operator added at runtime a single-variant group of its own, so a product
 * added in the manager appears in the storefront without a second code path.
 */
function catalogViews(store: DemoStore): ProductView[] {
  const seeded = new Set(store.products.flatMap((product) => product.variants.map((variant) => variant.id)));
  const views: ProductView[] = store.products.map((product) => {
    const variants: VariantView[] = [];
    for (const variant of product.variants) {
      const live = store.catalog.getProduct(variant.id);
      if (live !== undefined) {
        variants.push({ id: live.id, variant_id: variant.variant_id, color: variant.color, size: variant.size, product: live });
      }
    }
    const first = variants[0];
    return {
      id: product.id,
      sku: product.sku,
      name: product.name,
      brand: first?.product.brand ?? "",
      category: first?.product.category ?? "",
      description: first?.product.description ?? "",
      variants,
    };
  });

  for (const product of store.catalog.listProducts()) {
    if (seeded.has(product.id)) continue;
    views.push({
      id: product.id,
      sku: product.sku ?? product.id.slice(0, 8),
      name: product.name,
      brand: product.brand ?? "Operator added",
      category: product.category ?? "Uncategorised",
      description: product.description ?? "",
      variants: [
        {
          id: product.id,
          variant_id: product.id,
          color: product.color ?? "Unspecified",
          size: product.size ?? "One Size",
          product,
        },
      ],
    });
  }
  return views;
}

function isSellable(variant: VariantView): boolean {
  return variant.product.active && variant.product.quantity > 0;
}

function cartCount(lines: readonly CartLine[]): number {
  return lines.reduce((total, line) => total + line.quantity, 0);
}

function productJson(view: ProductView) {
  const variants = view.variants.map((variant) => ({
    id: variant.id,
    variant_id: variant.variant_id,
    color: variant.color,
    size: variant.size,
    price_cents: variant.product.price_cents,
    image_url: variant.product.image_url ?? null,
    image_alt: variant.product.image_alt ?? null,
    available: variant.product.quantity,
    active: variant.product.active,
    sellable: isSellable(variant),
  }));
  return {
    id: view.id,
    sku: view.sku,
    name: view.name,
    brand: view.brand,
    category: view.category,
    description: view.description,
    active: variants.some((variant) => variant.active),
    available: variants.reduce((total, variant) => total + (variant.active ? variant.available : 0), 0),
    variants,
  };
}

interface CatalogCounts {
  readonly products: number;
  readonly variants: number;
  readonly sellable_variants: number;
  readonly unavailable_variants: number;
}

function catalogCounts(views: readonly ProductView[]): CatalogCounts {
  const variants = views.flatMap((view) => view.variants);
  return {
    products: views.length,
    variants: variants.length,
    sellable_variants: variants.filter(isSellable).length,
    unavailable_variants: variants.filter((variant) => !variant.product.active).length,
  };
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/**
 * A page link that keeps its own query parameters and sets the theme, so the
 * `order` and `added` parameters a page already understands survive the walk
 * through the theme toggle and the link to the other page.
 */
function themedPath(
  path: string,
  theme: Theme,
  extra: Readonly<Record<string, string | undefined>> = {},
): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(extra)) {
    if (value !== undefined && value !== "") search.set(name, value);
  }
  search.set("theme", theme);
  return `${path}?${search.toString()}`;
}

/** The one control that changes the mode: a link to the same page in the other one. */
function themeLink(path: string, theme: Theme, extra: Readonly<Record<string, string | undefined>> = {}): string {
  const next: Theme = theme === "light" ? "dark" : "light";
  const label = next === "dark" ? "Dark mode" : "Light mode";
  return `<a href="${escapeHtml(themedPath(path, next, extra))}" data-role="theme">${label}</a>`;
}

function demoBanner(counts: CatalogCounts): string {
  return `<p class="demo" role="note"><strong>Demo slice, in memory.</strong> The catalogue is the example data from
    <code>db/seed.sql</code> (${escapeHtml(String(counts.products))} products,
    ${escapeHtml(String(counts.variants))} variants), rebuilt on every start. There is one shared cart, no accounts,
    no payment, and no database: restarting the server loses the cart, the orders and anything an operator added.</p>`;
}

function cartTable(store: DemoStore): string {
  const lines = store.cart.listLines();
  if (lines.length === 0) return "<p>Cart is empty.</p>";
  const rows = lines
    .map(
      (line) => `<tr><td>${escapeHtml(line.name)}</td>
        <td class="num">${escapeHtml(formatCents(line.unit_price_cents))}</td>
        <td class="num">${escapeHtml(line.quantity)}</td>
        <td class="num">${escapeHtml(formatCents(line.line_total_cents))}</td></tr>`,
    )
    .join("");
  return `<table><caption class="meta">Shared demo cart</caption>
    <thead><tr><th>Product</th><th class="num">Unit</th><th class="num">Qty</th><th class="num">Line</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><th>Total</th><td></td><td></td><td class="num">${escapeHtml(formatCents(store.cart.totalCents()))}</td></tr></tfoot>
  </table>`;
}

/** The per-card behaviour: colour filters the sizes, add posts the chosen variant. */
const STOREFRONT_SCRIPT = `<script>
(() => {
  const say = (text, bad) => {
    const node = document.querySelector("[data-role=status]");
    if (!node) return;
    node.textContent = text;
    node.dataset.state = bad ? "error" : "ok";
  };
  const post = async (path, body) => {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed");
    return data;
  };

  for (const card of document.querySelectorAll("[data-role=card]")) {
    const color = card.querySelector("[data-role=color]");
    const size = card.querySelector("[data-role=size]");
    const stock = card.querySelector("[data-role=availability]");
    const add = card.querySelector("[data-role=add]");
    const options = [...size.options].map((option) => ({
      value: option.value,
      label: option.textContent,
      color: option.dataset.color,
      stock: Number(option.dataset.stock),
    }));

    const select = () => {
      const matching = options.filter((option) => option.color === color.value);
      size.replaceChildren(
        ...matching.map((option) => {
          const next = new Option(option.label, option.value);
          next.dataset.color = option.color;
          next.dataset.stock = String(option.stock);
          return next;
        }),
      );
      const chosen = matching[0];
      const available = chosen === undefined ? 0 : chosen.stock;
      stock.textContent = available > 0
        ? color.value + " / " + chosen.label + " — " + available + " available"
        : "Out of stock in " + color.value;
      stock.className = available > 0 ? "meta" : "meta warn";
      add.disabled = available < 1;
    };

    color.addEventListener("change", select);
    add.addEventListener("click", async () => {
      try {
        await post("/api/cart", {
          variant_id: size.value,
          quantity: Number(card.querySelector("[data-role=quantity]").value),
        });
        location.reload();
      } catch (error) {
        say(error.message, true);
      }
    });
    select();
  }
})();
</script>`;

function storefrontPage(store: DemoStore, orderId: string | undefined, theme: Theme = DEFAULT_THEME): string {
  const views = catalogViews(store).filter((view) => view.variants.some((variant) => variant.product.active));
  const lines = store.cart.listLines();
  const placed = orderId === undefined ? undefined : store.orderBook.getOrder(orderId);
  const banner =
    placed === undefined
      ? ""
      : `<p class="demo ok-note" role="status">Order <code>${escapeHtml(placed.id)}</code> placed for
          ${escapeHtml(formatCents(placed.total_cents))}. It is in memory only, and this is not a paid sale.</p>`;

  const cards = views
    .map((view) => {
      // Active variants are offered, including any that are sold out at zero.
      const offered = view.variants.filter((variant) => variant.product.active);
      const colors = [...new Set(offered.map((variant) => variant.color))];
      const first = offered[0];
      const image = first?.product.image_url;
      const imageAlt = first?.product.image_alt ?? `${view.name} in ${first?.color ?? ""}`;
      const maxStock = Math.max(0, ...offered.map((variant) => variant.product.quantity));
      const sizeOptions = offered
        .map(
          (variant) =>
            `<option value="${escapeHtml(variant.id)}" data-color="${escapeHtml(variant.color)}" data-stock="${escapeHtml(variant.product.quantity)}">${escapeHtml(variant.size)}</option>`,
        )
        .join("");
      const colorOptions = colors
        .map((color) => `<option value="${escapeHtml(color)}">${escapeHtml(color)}</option>`)
        .join("");

      return `<article class="card" data-role="card">
        ${image === undefined ? "" : `<img src="${escapeHtml(image)}" alt="${escapeHtml(imageAlt)}" loading="lazy" referrerpolicy="no-referrer">`}
        <h3>${escapeHtml(view.name)}</h3>
        <p class="meta">${escapeHtml(view.brand)} &middot; ${escapeHtml(view.category)} &middot; <code>${escapeHtml(view.sku)}</code></p>
        <p>${escapeHtml(view.description)}</p>
        <p class="meta"><strong>${escapeHtml(formatCents(first?.product.price_cents ?? 0))}</strong> &middot; ${escapeHtml(String(offered.length))} colour/size variant(s)</p>
        <div class="buy">
          <label>Colour
            <select data-role="color">${colorOptions}</select>
          </label>
          <label>Size
            <select data-role="size">${sizeOptions}</select>
          </label>
          <label>Quantity
            <input type="number" data-role="quantity" min="1" max="${escapeHtml(String(Math.max(1, maxStock)))}" value="1">
          </label>
          <button type="button" data-role="add"${maxStock < 1 ? " disabled" : ""}>Add to cart</button>
        </div>
        <p class="meta" data-role="availability" aria-live="polite"></p>
      </article>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en" data-theme="${escapeHtml(theme)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Atlas Ecom &middot; storefront (demo)</title>
<style>${STYLE}</style>
</head>
<body>
<header>
  <h1>Atlas Ecom <span class="meta">storefront</span></h1>
  <p class="meta"><a href="${escapeHtml(themedPath("/manager", theme))}">ecom-manager</a> &middot; <a href="/api/health">/api/health</a> &middot;
    <a href="/api/catalog">/api/catalog</a> &middot; <a href="/api/orders">/api/orders</a> &middot;
    ${themeLink("/", theme, { order: orderId })}</p>
  ${demoBanner(catalogCounts(views))}
  ${banner}
  <h2>Cart</h2>
  <p class="meta">${escapeHtml(String(cartCount(lines)))} item(s), ${escapeHtml(formatCents(store.cart.totalCents()))}.
    Checking out posts to <code>/api/checkout</code> and creates an in-memory order; it is not a paid sale.</p>
  <button type="button" data-role="checkout"${lines.length === 0 ? " disabled" : ""}>Check out</button>
  ${cartTable(store)}
</header>
<p class="status" data-role="status" role="status" aria-live="polite"></p>
<main>
  <h2>Catalogue</h2>
  <div class="grid">${cards}</div>
</main>
<footer>
  Demo storefront for a standalone commerce slice. Images are Unsplash placeholder links from the example
  database and are not licensed production imagery; see <code>db/README.md</code>.
</footer>
<script>
(() => {
  const THEME = ${JSON.stringify(theme)};
  const button = document.querySelector("[data-role=checkout]");
  if (!button) return;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Checkout failed");
      // The theme is carried through the redirect, so the confirmation is in the
      // mode the shopper is already in.
      location.href = "/?order=" + encodeURIComponent(data.order.id) + "&theme=" + encodeURIComponent(THEME);
    } catch (error) {
      button.disabled = false;
      const node = document.querySelector("[data-role=status]");
      node.textContent = error.message;
      node.dataset.state = "error";
    }
  });
})();
</script>
${STOREFRONT_SCRIPT}
</body>
</html>`;
}

function managerPage(
  store: DemoStore,
  notices: { error?: string; added?: string } = {},
  theme: Theme = DEFAULT_THEME,
): string {
  const views = catalogViews(store);
  const counts = catalogCounts(views);
  const summary = store.orderBook.summary();

  const rows = views
    .flatMap((view) => view.variants)
    .map(
      (variant) => `<tr>
        ${variant.product.image_url === undefined ? "<td></td>" : `<td><img class="thumb" src="${escapeHtml(variant.product.image_url)}" alt="${escapeHtml(variant.product.image_alt ?? view.name)}" loading="lazy" referrerpolicy="no-referrer"></td>`}
        <td><code>${escapeHtml(variant.variant_id)}</code></td>
        <td>${escapeHtml(variant.product.name)}</td>
        <td>${escapeHtml(variant.color)}</td>
        <td>${escapeHtml(variant.size)}</td>
        <td class="num">${escapeHtml(formatCents(variant.product.price_cents))}</td>
        <td class="num${variant.product.active && variant.product.quantity === 0 ? " warn" : ""}">${escapeHtml(String(variant.product.quantity))}</td>
        <td>${variant.product.active ? "active" : '<span class="out">inactive</span>'}</td>
      </tr>`,
    )
    .join("");

  const orders = store.orderBook.listOrders();
  const orderRows =
    orders.length === 0
      ? "<tr><td colspan=\"5\">No orders yet.</td></tr>"
      : orders
          .map(
            (order) => `<tr>
              <td><code>${escapeHtml(order.id)}</code></td>
              <td>${escapeHtml(order.status)}</td>
              <td>${escapeHtml(order.source ?? "standalone")}</td>
              <td class="num">${escapeHtml(String(order.lines.length))}</td>
              <td class="num">${escapeHtml(formatCents(order.total_cents))}</td>
            </tr>`,
          )
          .join("");

  return `<!doctype html>
<html lang="en" data-theme="${escapeHtml(theme)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Atlas Ecom &middot; ecom-manager (demo)</title>
<style>${STYLE}</style>
</head>
<body>
<header>
  <h1>ecom-manager</h1>
  <p class="meta"><a href="${escapeHtml(themedPath("/", theme))}">Storefront</a> &middot; <a href="/api/health">/api/health</a> &middot;
    <a href="/api/orders">/api/orders</a> &middot; <a href="/api/cart">/api/cart</a> &middot;
    ${themeLink("/manager", theme, { added: notices.added })}</p>
  ${demoBanner(counts)}
  ${notices.error === undefined ? "" : `<p class="demo out" role="alert">${escapeHtml(notices.error)}</p>`}
  ${notices.added === undefined ? "" : `<p class="demo ok-note" role="status">Added <code>${escapeHtml(notices.added)}</code> to the in-memory catalogue. It is not written to a database.</p>`}
  <dl class="stats">
    <div><dt>Products</dt><dd>${escapeHtml(String(counts.products))}</dd></div>
    <div><dt>Variants</dt><dd>${escapeHtml(String(counts.variants))}</dd></div>
    <div><dt>Sellable</dt><dd>${escapeHtml(String(counts.sellable_variants))}</dd></div>
    <div><dt>Cart</dt><dd>${escapeHtml(formatCents(store.cart.totalCents()))}</dd></div>
    <div><dt>Orders</dt><dd>${escapeHtml(String(summary.order_count))}</dd></div>
    <div><dt>Order value</dt><dd>${escapeHtml(formatCents(summary.total_cents))}</dd></div>
  </dl>
</header>
<main>
  <h2>Add product</h2>
  <p class="meta">The standalone branch of Add Product: written straight into the in-memory catalogue, because no
    peer is paired. With a peer holding the capability this would become a proposal instead.</p>
  <form class="add" method="post" action="/manager">
    <input type="hidden" name="theme" value="${escapeHtml(theme)}">
    <label>Name <input name="name" required maxlength="80" placeholder="Atlas Coffee"></label>
    <label>Price (integer cents) <input name="price_cents" type="number" min="0" step="1" value="1250" required></label>
    <label>Quantity <input name="quantity" type="number" min="0" step="1" value="10" required></label>
    <button type="submit">Add product</button>
  </form>

  <h2>Catalogue and stock</h2>
  <p class="meta">One row per colour/size variant, straight from the example seed. A variant at zero available is
    sold out; an inactive variant is catalogued but not sellable.</p>
  <table>
    <thead><tr><th>Image</th><th>Variant id</th><th>Product</th><th>Colour</th><th>Size</th>
      <th class="num">Price</th><th class="num">Available</th><th>Status</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <h2>Cart</h2>
  ${cartTable(store)}

  <h2>Orders</h2>
  <p class="meta">${escapeHtml(String(summary.order_count))} order(s), ${escapeHtml(formatCents(summary.total_cents))} in
    total. The <code>OrderBook</code> is in memory: a restart leaves it empty.</p>
  <table>
    <thead><tr><th>Order id</th><th>Status</th><th>Source</th><th class="num">Lines</th><th class="num">Total</th></tr></thead>
    <tbody>${orderRows}</tbody>
  </table>
</main>
<footer>
  Operator surface for a demo slice. No authentication, no audit trail, no persistence, and no connection to Atlas
  ERP. Images are Unsplash placeholder links; see <code>db/README.md</code> before reusing any of them.
</footer>
</body>
</html>`;
}

function errorPage(status: number, message: string, theme: Theme = DEFAULT_THEME): string {
  return `<!doctype html>
<html lang="en" data-theme="${escapeHtml(theme)}">
<head><meta charset="utf-8"><title>Atlas Ecom &middot; ${escapeHtml(status)}</title><style>${STYLE}</style></head>
<body>
<header><h1>${escapeHtml(status)}</h1><p class="demo" role="alert">${escapeHtml(message)}</p>
<p class="meta"><a href="${escapeHtml(themedPath("/", theme))}">Storefront</a> &middot; <a href="${escapeHtml(themedPath("/manager", theme))}">ecom-manager</a></p></header>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function send(res: ServerResponse, status: number, contentType: string, body: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(body, "utf8"),
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
    ...headers,
  });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  send(res, status, "application/json; charset=utf-8", `${JSON.stringify(body, null, 2)}\n`);
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  send(res, status, "text/html; charset=utf-8", html);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      // Keep draining the request so the refusal is answered on a clean socket,
      // but stop retaining anything past the cap.
      tooLarge = true;
      chunks.length = 0;
      continue;
    }
    chunks.push(buffer);
  }
  if (tooLarge) throw new HttpError(413, "Request body is too large");
  return Buffer.concat(chunks).toString("utf8");
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = (await readBody(req)).trim();
  if (raw === "") return {};
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new HttpError(400, "Request body must be JSON");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

async function readFormBody(req: IncomingMessage): Promise<Map<string, string>> {
  return new URLSearchParams(await readBody(req));
}

function requireField(fields: Map<string, string>, name: string): string {
  const value = fields.get(name);
  if (value === undefined || value.trim() === "") {
    throw new HttpError(400, `Missing form field "${name}"`);
  }
  return value;
}

function requireCount(value: unknown, label: string, minimum: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) {
    throw new HttpError(400, `${label} must be an integer of at least ${minimum}`);
  }
  return value;
}

function cartJson(store: DemoStore): Record<string, unknown> {
  const lines = store.cart.listLines();
  return {
    mode: "demo",
    in_memory: true,
    item_count: cartCount(lines),
    total_cents: store.cart.totalCents(),
    lines,
  };
}

function ordersJson(store: DemoStore): Record<string, unknown> {
  return { mode: "demo", in_memory: true, summary: store.orderBook.summary(), orders: store.orderBook.listOrders() };
}

function checkoutJson(store: DemoStore, order: Order): Record<string, unknown> {
  return {
    mode: "demo",
    in_memory: true,
    paid: false,
    persisted: false,
    order,
    summary: store.orderBook.summary(),
  };
}

/** Every API path, with the methods it answers, so an unknown route is a 404. */
const API_ROUTES: Readonly<Record<string, readonly string[]>> = {
  "/api/health": ["GET"],
  "/api/catalog": ["GET"],
  "/api/cart": ["GET", "POST"],
  "/api/orders": ["GET"],
  "/api/checkout": ["POST"],
};

async function handleApi(
  store: DemoStore,
  method: string,
  path: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const allowed = API_ROUTES[path];
  if (allowed === undefined) throw new HttpError(404, `Unknown route ${method} ${path}`);
  if (!allowed.includes(method)) {
    throw new HttpError(405, `${path} only answers ${allowed.join(", ")}`);
  }

  switch (`${method} ${path}`) {
    case "GET /api/health": {
      const views = catalogViews(store);
      sendJson(res, 200, {
        status: "ok",
        product: "atlas-ecom",
        mode: "demo",
        in_memory: true,
        database: "none",
        peer_connected: false,
        source: "db/seed.sql example data",
        catalog: catalogCounts(views),
        cart: { item_count: cartCount(store.cart.listLines()), total_cents: store.cart.totalCents() },
        orders: store.orderBook.summary(),
      });
      return;
    }
    case "GET /api/catalog": {
      const views = catalogViews(store);
      sendJson(res, 200, {
        mode: "demo",
        in_memory: true,
        source: "db/seed.sql example data",
        counts: catalogCounts(views),
        products: views.map(productJson),
      });
      return;
    }
    case "GET /api/cart": {
      sendJson(res, 200, cartJson(store));
      return;
    }
    case "POST /api/cart": {
      const body = await readJsonBody(req);
      const variantId = typeof body.variant_id === "string" ? body.variant_id.trim() : "";
      if (variantId === "") throw new HttpError(400, "variant_id is required");
      const quantity = body.quantity === undefined ? 1 : requireCount(body.quantity, "quantity", 1);
      const line = clientError(() => store.cart.addItem(variantId, quantity));
      sendJson(res, 200, { ...cartJson(store), added: line });
      return;
    }
    case "GET /api/orders": {
      sendJson(res, 200, ordersJson(store));
      return;
    }
    case "POST /api/checkout": {
      await readJsonBody(req);
      const order = clientError(() => store.cart.checkout());
      sendJson(res, 201, checkoutJson(store, order));
      return;
    }
    default:
      throw new HttpError(405, `${method} ${path} is routed but not handled`);
  }
}

/**
 * The whole request surface as a plain listener, so a test can drive it without
 * a socket. The store is process-local, so one store per server is the whole
 * state model.
 */
export function createWebRequestListener(store: DemoStore = createDemoStore()) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", `http://${WEB_HOST}`);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = req.method ?? "GET";
    const theme = readTheme(url.searchParams.get("theme"));

    try {
      if (path === "/") {
        if (method !== "GET") throw new HttpError(405, "The storefront only answers GET");
        const orderId = url.searchParams.get("order");
        sendHtml(res, 200, storefrontPage(store, orderId === null || orderId === "" ? undefined : orderId, theme));
        return;
      }
      if (path === "/manager") {
        if (method === "GET") {
          const added = url.searchParams.get("added");
          sendHtml(res, 200, managerPage(store, { added: added === null || added === "" ? undefined : added }, theme));
          return;
        }
        if (method === "POST") {
          // Add Product, standalone branch. Invalid input re-renders the page
          // with the message rather than throwing the operator to an error page.
          let fields: Map<string, string> = new Map();
          // The mode rides in a hidden field, so neither the 303 nor the 400 resets it.
          let posted = theme;
          try {
            fields = await readFormBody(req);
            posted = readTheme(fields.get("theme") ?? theme);
            const product = clientError(() =>
              store.catalog.addProduct({
                name: requireField(fields, "name"),
                price_cents: Number(requireField(fields, "price_cents")),
                quantity: Number(requireField(fields, "quantity")),
              }),
            );
            res.writeHead(303, { location: `/manager?added=${encodeURIComponent(product.id)}&theme=${posted}` });
            res.end();
          } catch (error) {
            sendHtml(res, 400, managerPage(store, { error: error instanceof Error ? error.message : "Bad request" }, posted));
          }
          return;
        }
        throw new HttpError(405, "The manager answers GET and POST");
      }
      await handleApi(store, method, path, req, res);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof Error ? error.message : "Unexpected error";
      if (path.startsWith("/api/")) {
        sendJson(res, status, { error: message });
      } else {
        sendHtml(res, status, errorPage(status, message, theme));
      }
    }
  };
}

export interface WebServerOptions {
  /** Defaults to 0, an ephemeral port, so a test never collides with a running one. */
  readonly port?: number;
  readonly host?: string;
  readonly store?: DemoStore;
}

export interface WebServerHandle {
  readonly server: Server;
  readonly store: DemoStore;
  readonly host: string;
  readonly port: number;
  readonly url: string;
  close(): Promise<void>;
}

export function readWebPort(env: Record<string, string | undefined> = process.env): number {
  const raw = env.ATLAS_ECOM_WEB_PORT;
  if (raw === undefined || raw.trim() === "") return DEFAULT_WEB_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("ATLAS_ECOM_WEB_PORT must be an integer port between 0 and 65535");
  }
  return port;
}

/** Starts the demo server. `close()` is the only way out, so nothing lingers. */
export async function startWebServer(options: WebServerOptions = {}): Promise<WebServerHandle> {
  const store = options.store ?? createDemoStore();
  const host = options.host ?? WEB_HOST;
  const server = createServer(createWebRequestListener(store));

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Web server started without a TCP address");
  }
  const port = address.port;
  const url = `http://${host}:${port}`;

  return {
    server,
    store,
    host,
    port,
    url,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined || error === null ? resolve() : reject(error)));
        // A keep-alive socket from fetch would otherwise hold the close open.
        server.closeAllConnections();
      }),
  };
}

async function main(): Promise<void> {
  const handle = await startWebServer({ port: readWebPort() });
  console.log(`Atlas Ecom demo storefront: ${handle.url}/`);
  console.log(`Atlas Ecom ecom-manager:     ${handle.url}/manager`);
  console.log(`Demo API:                    ${handle.url}/api/health`);
  console.log("In memory only. Ctrl+C to stop.");

  const stop = (): void => {
    handle.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(`atlas-ecom web server failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  }
}
