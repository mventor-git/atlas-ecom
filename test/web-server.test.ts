import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import {
  DEFAULT_THEME,
  DEFAULT_WEB_PORT,
  readTheme,
  readWebPort,
  startWebServer,
  type WebServerHandle,
} from "../src/index.ts";

/**
 * The shared Atlas UI token table from `contract.md` v1.1.1, written out here
 * rather than imported, so a change to the stylesheet that is not a change to
 * the approved contract fails the suite.
 */
const LIGHT_TOKENS: Readonly<Record<string, string>> = {
  "--atlas-bg-canvas": "#F7F2EB",
  "--atlas-bg-surface": "#EAE2D6",
  "--atlas-fg-default": "#2D0000",
  "--atlas-fg-muted": "#6A2F2F",
  "--atlas-accent": "#8B9A6E",
  "--atlas-link": "#2D0000",
  "--atlas-border-divider": "#EEEEEE",
  "--atlas-border-control": "#757D6F",
  "--atlas-on-accent": "#2D0000",
  "--atlas-focus-ring": "#2D0000",
  "--atlas-success-fg": "#2A7C13",
  "--atlas-success-bg": "#C7D3C0",
  "--atlas-warning-fg": "#2D0000",
  "--atlas-warning-bg": "#C8A96B",
  "--atlas-danger-fg": "#6D0808",
  "--atlas-danger-bg": "#FFDADA",
  "--atlas-info-fg": "#2D0000",
  "--atlas-info-bg": "#FBE6C2",
};

const DARK_TOKENS: Readonly<Record<string, string>> = {
  "--atlas-bg-canvas": "#41444B",
  "--atlas-bg-surface": "#52575D",
  "--atlas-fg-default": "#DFD8C8",
  "--atlas-fg-muted": "#B7B3A9",
  "--atlas-accent": "#CABFAB",
  "--atlas-link": "#DFD8C8",
  "--atlas-border-divider": "#52575D",
  "--atlas-border-control": "#9AA394",
  "--atlas-on-accent": "#41444B",
  "--atlas-focus-ring": "#DFD8C8",
  "--atlas-success-fg": "#2D0000",
  "--atlas-success-bg": "#C7D3C0",
  "--atlas-warning-fg": "#2D0000",
  "--atlas-warning-bg": "#C8A96B",
  "--atlas-danger-fg": "#2D0000",
  "--atlas-danger-bg": "#FFDADA",
  "--atlas-info-fg": "#2D0000",
  "--atlas-info-bg": "#FBE6C2",
};

const LIGHT_SELECTOR = ':root, [data-theme="light"]';
const DARK_SELECTOR = '[data-theme="dark"]';

function styleSheet(html: string): string {
  const match = /<style>([\s\S]*?)<\/style>/.exec(html);
  assert.ok(match !== null, "the page rendered no stylesheet");
  return match[1];
}

/** One CSS rule body, matched on the selector alone so `a` cannot match `a:hover`-ish text. */
function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|[};])\\s*${escaped}\\s*\\{([^}]*)\\}`, "m").exec(css);
  assert.ok(match !== null, `the stylesheet has no "${selector}" rule`);
  return match[1];
}

function tokens(css: string, selector: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const [, name, value] of rule(css, selector).matchAll(/(--atlas-[a-z-]+)\s*:\s*(#[0-9a-fA-F]{3,8})/g)) {
    found[name] = value.toUpperCase();
  }
  return found;
}

/** Every test drives the real listener over a real socket on an ephemeral port
 * and closes the server before it returns, so a run never leaves a process
 * listening and never collides with a demo server on 4312. */

async function withServer<T>(
  run: (handle: WebServerHandle, request: (path: string, init?: RequestInit) => Promise<Response>) => Promise<T>,
): Promise<T> {
  const handle = await startWebServer({ port: 0 });
  const request = (path: string, init: RequestInit = {}) =>
    fetch(`${handle.url}${path}`, { ...init, signal: AbortSignal.timeout(5_000) });
  try {
    return await run(handle, request);
  } finally {
    await handle.close();
  }
}

async function readJson(response: Response): Promise<any> {
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  return (await response.json()) as any;
}

function addToCart(request: (path: string, init?: RequestInit) => Promise<Response>, body: unknown) {
  return request("/api/cart", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("the health route reports the demo catalogue without a database", async () => {
  await withServer(async (_handle, request) => {
    const response = await request("/api/health");
    assert.equal(response.status, 200);
    const health = await readJson(response);

    assert.equal(health.status, "ok");
    assert.equal(health.mode, "demo");
    assert.equal(health.in_memory, true);
    assert.equal(health.database, "none");
    assert.equal(health.peer_connected, false);
    assert.deepEqual(health.catalog, {
      products: 6,
      variants: 37,
      sellable_variants: 35,
      unavailable_variants: 2,
    });
    assert.deepEqual(health.orders, { order_count: 0, total_cents: 0 });
  });
});

test("the catalog route returns every variant with its colour, size, image and stock", async () => {
  await withServer(async (_handle, request) => {
    const response = await request("/api/catalog");
    assert.equal(response.status, 200);
    const catalog = await readJson(response);

    assert.equal(catalog.counts.products, 6);
    const variants = catalog.products.flatMap((product: { variants: unknown[] }) => product.variants);
    assert.equal(variants.length, 37);
    for (const variant of variants) {
      assert.equal(typeof variant.color, "string");
      assert.equal(typeof variant.size, "string");
      assert.equal(Number.isInteger(variant.price_cents), true);
      assert.equal(Number.isInteger(variant.available), true);
      assert.match(variant.image_url, /^https:\/\/images\.unsplash\.com\/photo-[0-9a-f-]+\?/);
      assert.match(variant.image_alt, / example catalogue$/);
    }

    // The two inactive Ember variants are catalogued but not sellable.
    const ember = variants.find((variant: { variant_id: string }) => variant.variant_id === "SOL-TRAIL-BTL-EMBER-750ML");
    assert.equal(ember.active, false);
    assert.equal(ember.sellable, false);
    assert.equal(ember.available, 1);
    assert.equal(variants.filter((variant: { active: boolean }) => variant.active === false).length, 2);
  });
});

test("the storefront renders cards, real colour and size selectors, prices and variant images", async () => {
  await withServer(async (_handle, request) => {
    const response = await request("/");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
    const html = await response.text();

    assert.match(html, /<html lang="en" data-theme="light">/);
    assert.match(html, /<h1>Atlas Ecom/);
    assert.match(html, /Aurora Everyday Linen Shirt/);
    // 6 product cards, each with a colour select, a size select and an add control.
    assert.equal(html.match(/data-role="card"/g)?.length, 6);
    assert.equal(html.match(/data-role="color"/g)?.length, 6);
    assert.equal(html.match(/data-role="size"/g)?.length, 6);
    assert.equal(html.match(/data-role="add"/g)?.length, 6);
    assert.match(html, /\$89\.00/);
    assert.match(html, /src="https:\/\/images\.unsplash\.com\/photo-[0-9a-f-]+\?/);
    assert.match(html, /Demo slice, in memory/);
    // The inactive Ember bottle variants are catalogued but never offered.
    assert.equal(html.includes("Ember"), false);
    assert.equal(html.includes("SOL-TRAIL-BTL-EMBER"), false);
  });
});

test("every inline script on the storefront is syntactically valid", async () => {
  await withServer(async (_handle, request) => {
    // No browser runs here, so compile the inline scripts instead of trusting them.
    const html = await (await request("/")).text();
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
    assert.equal(scripts.length, 2);
    for (const source of scripts) {
      assert.doesNotThrow(() => new Function(source), `inline script does not parse:\n${source.slice(0, 200)}`);
    }
    // And they only talk to the JSON routes the server actually serves.
    assert.match(html, /post\("\/api\/cart"/);
    assert.match(html, /fetch\("\/api\/checkout"/);
  });
});

test("the manager renders the full stock table, the orders panel and the add product form", async () => {
  await withServer(async (_handle, request) => {
    const response = await request("/manager");
    assert.equal(response.status, 200);
    const html = await response.text();

    assert.match(html, /<h1>ecom-manager<\/h1>/);
    // One row per variant, and only seeded products exist, so every code chip is a variant id.
    assert.equal(html.match(/<code>[A-Z0-9-]+<\/code>/g)?.length, 37);
    assert.match(html, /SOL-TRAIL-BTL-EMBER-750ML/);
    assert.equal(html.match(/<span class="out">inactive<\/span>/g)?.length, 2);
    assert.match(html, /<form class="add" method="post" action="\/manager">/);
    assert.match(html, /No orders yet\./);
    assert.match(html, /Demo slice, in memory/);
  });
});

test("the manager adds a product into the in-memory catalog and redirects", async () => {
  await withServer(async (handle, request) => {
    const response = await request("/manager", {
      method: "POST",
      body: new URLSearchParams({ name: "Atlas Coffee", price_cents: "1250", quantity: "10" }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      redirect: "manual",
    });

    assert.equal(response.status, 303);
    assert.match(response.headers.get("location") ?? "", /^\/manager\?added=/);

    const added = handle.store.catalog.listProducts().find((product) => product.name === "Atlas Coffee");
    assert.equal(added?.price_cents, 1250);
    assert.equal(added?.quantity, 10);

    // The new product reaches the storefront as a single-variant card.
    const html = await (await request("/")).text();
    assert.match(html, /Atlas Coffee/);
    assert.equal(html.match(/data-role="card"/g)?.length, 7);
  });
});

test("the manager re-renders with the reason instead of discarding bad input", async () => {
  await withServer(async (_handle, request) => {
    const response = await request("/manager", {
      method: "POST",
      body: new URLSearchParams({ name: "Bad", price_cents: "not-a-price", quantity: "1" }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });

    assert.equal(response.status, 400);
    const html = await response.text();
    assert.match(html, /Product price_cents must be an integer of at least 0/);
    assert.match(html, /<h1>ecom-manager<\/h1>/);
  });
});

test("every dynamic value in a rendered page is HTML-escaped", async () => {
  await withServer(async (handle, request) => {
    const name = `<script>alert("xss")</script>`;
    const description = `</p><script>alert(3)</script>`;
    handle.store.catalog.addProduct({
      name,
      price_cents: 100,
      quantity: 1,
      sku: `" onerror="alert(1)`,
      image_url: `https://example.com/a.png" onerror="alert(2)`,
      image_alt: `'><b>alt</b>`,
      description,
    });

    // Name, image url and image alt are rendered on both pages.
    for (const path of ["/", "/manager"]) {
      const html = await (await request(path)).text();
      assert.equal(html.includes(name), false, `${path} rendered raw markup`);
      assert.equal(html.includes("<script>alert("), false, `${path} rendered an injected script`);
      // An unescaped quote before an attribute is what would break the attribute out.
      assert.equal(html.includes('onerror="alert'), false, `${path} rendered an injected attribute`);
      assert.match(html, /&lt;script&gt;alert\(&quot;xss&quot;\)&lt;\/script&gt;/);
      assert.match(html, /a\.png&quot; onerror=&quot;alert\(2\)/);
      assert.match(html, /&#39;&gt;&lt;b&gt;alt&lt;\/b&gt;/);
    }

    // The sku and the description belong to the storefront card.
    const storefront = await (await request("/")).text();
    assert.match(storefront, /&quot; onerror=&quot;alert\(1\)/);
    assert.match(storefront, /&lt;\/p&gt;&lt;script&gt;alert\(3\)&lt;\/script&gt;/);
  });
});

test("adding to the cart, reading it back and checking out creates one recorded order", async () => {
  await withServer(async (handle, request) => {
    const empty = await readJson(await request("/api/cart"));
    assert.deepEqual(empty.lines, []);
    assert.equal(empty.total_cents, 0);

    const added = await addToCart(request, { variant_id: "AUR-LIN-SHIRT-NAVY-M", quantity: 2 });
    assert.equal(added.status, 200);
    const cart = await readJson(added);
    assert.equal(cart.item_count, 2);
    assert.equal(cart.total_cents, 17800);
    assert.equal(cart.added.name, "Aurora Everyday Linen Shirt — Navy / M");

    const stockBefore = handle.store.catalog.getProduct("AUR-LIN-SHIRT-NAVY-M")?.quantity;

    const checkout = await request("/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(checkout.status, 201);
    const placed = await readJson(checkout);
    assert.equal(placed.order.status, "created");
    assert.equal(placed.order.total_cents, 17800);
    assert.equal(placed.paid, false);
    assert.equal(placed.persisted, false);

    // The same order is readable through the order book and the orders route.
    const orders = await readJson(await request("/api/orders"));
    assert.equal(orders.summary.order_count, 1);
    assert.equal(orders.summary.total_cents, 17800);
    assert.equal(orders.orders[0].id, placed.order.id);
    assert.deepEqual(handle.store.orderBook.getOrder(placed.order.id), orders.orders[0]);

    // Checkout cleared the cart and decremented availability exactly once.
    const cleared = await readJson(await request("/api/cart"));
    assert.deepEqual(cleared.lines, []);
    assert.equal(cleared.total_cents, 0);
    assert.equal(handle.store.catalog.getProduct("AUR-LIN-SHIRT-NAVY-M")?.quantity, (stockBefore ?? 0) - 2);

    // The manager lists the order, and the storefront confirms it.
    assert.match(await (await request("/manager")).text(), new RegExp(placed.order.id));
    const html = await (await request(`/?order=${placed.order.id}`)).text();
    assert.match(html, new RegExp(`Order <code>${placed.order.id}</code> placed`));
  });
});

test("the cart refuses an inactive variant, an unknown id and a bad quantity", async () => {
  await withServer(async (_handle, request) => {
    const inactive = await addToCart(request, { variant_id: "SOL-TRAIL-BTL-EMBER-750ML", quantity: 1 });
    assert.equal(inactive.status, 400);
    assert.match((await readJson(inactive)).error, /not active/);

    const unknown = await addToCart(request, { variant_id: "AUR-LIN-SHIRT-SAND-XXL", quantity: 1 });
    assert.equal(unknown.status, 400);
    assert.match((await readJson(unknown)).error, /Unknown product/);

    const badQuantity = await addToCart(request, { variant_id: "AUR-LIN-SHIRT-SAND-M", quantity: 0 });
    assert.equal(badQuantity.status, 400);
    assert.match((await readJson(badQuantity)).error, /quantity must be an integer of at least 1/);

    const missing = await addToCart(request, { quantity: 1 });
    assert.equal(missing.status, 400);
    assert.match((await readJson(missing)).error, /variant_id is required/);

    const notJson = await request("/api/cart", { method: "POST", body: "nope" });
    assert.equal(notJson.status, 400);
    assert.match((await readJson(notJson)).error, /must be JSON/);

    // The 3-unit variant from the seed is a real oversell case.
    const oversell = await addToCart(request, { variant_id: "MER-COURT-SNEAK-INK-45", quantity: 99 });
    assert.equal(oversell.status, 400);
    assert.match((await readJson(oversell)).error, /Only 3 of .* available/);

    assert.deepEqual((await readJson(await request("/api/cart"))).lines, []);
  });
});

test("checking out an empty cart is refused and nothing is recorded", async () => {
  await withServer(async (handle, request) => {
    const response = await request("/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 400);
    assert.match((await readJson(response)).error, /empty cart/);
    assert.equal(handle.store.orderBook.summary().order_count, 0);
  });
});

test("unknown routes and wrong methods answer 404 and 405", async () => {
  await withServer(async (_handle, request) => {
    const unknownPage = await request("/nope");
    assert.equal(unknownPage.status, 404);
    assert.equal(unknownPage.headers.get("content-type"), "text/html; charset=utf-8");
    assert.match(await unknownPage.text(), /Unknown route GET \/nope/);

    const unknownApi = await request("/api/nope");
    assert.equal(unknownApi.status, 404);
    assert.match((await readJson(unknownApi)).error, /Unknown route GET \/api\/nope/);

    const wrongMethod = await request("/api/cart", { method: "DELETE" });
    assert.equal(wrongMethod.status, 405);
    assert.match((await readJson(wrongMethod)).error, /only answers GET, POST/);

    assert.equal((await request("/", { method: "POST", body: "" })).status, 405);
    assert.equal((await request("/manager", { method: "DELETE" })).status, 405);

    // A trailing slash is the same route, not a 404.
    assert.equal((await request("/manager/")).status, 200);
  });
});

test("the server binds loopback on an ephemeral port and stops on close", async () => {
  const handle = await startWebServer({ port: 0 });
  const address = handle.server.address() as AddressInfo;
  assert.equal(address.address, "127.0.0.1");
  assert.equal(address.port, handle.port);
  assert.notEqual(handle.port, 0);
  assert.equal(handle.url, `http://127.0.0.1:${handle.port}`);
  assert.equal(handle.store.products.length, 6);

  await handle.close();
  await assert.rejects(fetch(`${handle.url}/api/health`), /fetch failed|ECONNREFUSED/);
  assert.equal(handle.server.listening, false);
});

test("the web port comes from ATLAS_ECOM_WEB_PORT and defaults to 4312", () => {
  assert.equal(readWebPort({}), DEFAULT_WEB_PORT);
  assert.equal(readWebPort({ ATLAS_ECOM_WEB_PORT: "" }), DEFAULT_WEB_PORT);
  assert.equal(readWebPort({ ATLAS_ECOM_WEB_PORT: " 8080 " }), 8080);
  for (const bad of ["-1", "65536", "4.5", "http"]) {
    assert.throws(() => readWebPort({ ATLAS_ECOM_WEB_PORT: bad }), /ATLAS_ECOM_WEB_PORT must be an integer port/);
  }
});

test("an oversized request body is refused instead of buffered", async () => {
  await withServer(async (_handle, request) => {
    const response = await addToCart(request, {
      variant_id: "AUR-LIN-SHIRT-SAND-M",
      quantity: 1,
      padding: "x".repeat(20_000),
    });
    assert.equal(response.status, 413);
    assert.match((await readJson(response)).error, /too large/);
    assert.deepEqual((await readJson(await request("/api/cart"))).lines, []);
  });
});

// ---------------------------------------------------------------------------
// Design tokens and the light/dark mode (contract.md v1.1.1)
// ---------------------------------------------------------------------------

test("both pages carry the whole contract token table in light and dark", async () => {
  await withServer(async (_handle, request) => {
    for (const path of ["/", "/manager"]) {
      for (const [query, expected] of [
        ["", "light"],
        ["?theme=light", "light"],
        ["?theme=dark", "dark"],
      ] as const) {
        const html = await (await request(`${path}${query}`)).text();
        const where = `${path}${query}`;

        assert.match(html, new RegExp(`<html lang="en" data-theme="${expected}">`), where);
        const css = styleSheet(html);
        // Every named token, in both modes, at the value the contract states.
        assert.deepEqual(tokens(css, LIGHT_SELECTOR), { ...LIGHT_TOKENS }, `${where} light tokens`);
        assert.deepEqual(tokens(css, DARK_SELECTOR), { ...DARK_TOKENS }, `${where} dark tokens`);
      }
    }
  });
});

test("every colour on a page resolves to a token, outside the token table", async () => {
  await withServer(async (_handle, request) => {
    for (const path of ["/", "/manager"]) {
      const css = styleSheet(await (await request(path)).text());
      // With the two token rules removed, not one colour literal may survive.
      const rest = css
        .replace(/(?:^|[};])\s*:root,[^{]*\{[^}]*\}/m, "")
        .replace(/(?:^|[};])\s*\[data-theme="dark"\][^{]*\{[^}]*\}/m, "");
      assert.doesNotMatch(rest, /#[0-9a-fA-F]{3,8}\b/, `${path} kept a hard-coded colour:\n${rest}`);
      assert.doesNotMatch(rest, /\b(?:rgba?|hsla?)\(/, `${path} used a colour function instead of a token`);
      // And every declared token is actually applied, so none is decoration.
      for (const name of Object.keys(LIGHT_TOKENS)) {
        assert.match(css, new RegExp(`var\\(${name}\\)`), `${path} declares ${name} but never uses it`);
      }
    }
  });
});

test("links are underlined and the focus ring comes from the focus token", async () => {
  await withServer(async (_handle, request) => {
    for (const path of ["/", "/manager", "/nope"]) {
      const css = styleSheet(await (await request(path)).text());

      // link.default carries an underline, so it never relies on colour alone.
      const anchor = rule(css, "a");
      assert.match(anchor, /color:\s*var\(--atlas-link\)/, path);
      assert.match(anchor, /text-decoration:\s*underline/, path);
      // focus.ring is on every keyboard-focusable control.
      const focus = rule(css, ":focus-visible");
      assert.match(focus, /outline:[^;]*var\(--atlas-focus-ring\)/, path);
      // accent.default paints a control and is never the body text colour.
      assert.match(rule(css, "button"), /background:\s*var\(--atlas-accent\)/, path);
      assert.match(rule(css, "button"), /color:\s*var\(--atlas-on-accent\)/, path);
      assert.doesNotMatch(rule(css, "body"), /var\(--atlas-accent\)/, path);
    }
  });
});

test("an absent, empty or unrecognised theme falls back to light", async () => {
  for (const value of [null, "", "neon", "DARK", " dark", "light "]) {
    assert.equal(readTheme(value), "light");
  }
  assert.equal(readTheme("dark"), "dark");
  assert.equal(readTheme("light"), "light");
  assert.equal(DEFAULT_THEME, "light");

  await withServer(async (_handle, request) => {
    for (const path of ["/", "/manager"]) {
      for (const query of ["", "?theme=", "?theme=neon", "?theme=DARK"]) {
        const html = await (await request(`${path}${query}`)).text();
        assert.match(html, /<html lang="en" data-theme="light">/, `${path}${query}`);
        // Both palettes stay in the stylesheet; only the applied mode is light.
        assert.doesNotMatch(html, /<html[^>]*data-theme="dark"/, `${path}${query}`);
      }
    }
  });
});

test("the theme link and the cross-page link carry the mode and keep the page's parameters", async () => {
  await withServer(async (handle, request) => {
    // An empty storefront: the toggle offers dark, and the manager link carries light.
    let html = await (await request("/")).text();
    assert.match(html, /<a href="\/\?theme=dark" data-role="theme">Dark mode<\/a>/);
    assert.match(html, /<a href="\/manager\?theme=light">ecom-manager<\/a>/);

    html = await (await request("/?theme=dark")).text();
    assert.match(html, /<a href="\/\?theme=light" data-role="theme">Light mode<\/a>/);
    assert.match(html, /<a href="\/manager\?theme=dark">ecom-manager<\/a>/);
    // The checkout redirect is built in the page's own mode.
    assert.match(html, /const THEME = "dark";/);

    html = await (await request("/manager?theme=dark")).text();
    assert.match(html, /<a href="\/manager\?theme=light" data-role="theme">Light mode<\/a>/);
    assert.match(html, /<a href="\/\?theme=dark">Storefront<\/a>/);
    // The add form posts the mode back, so the redirect cannot reset it.
    assert.match(html, /<input type="hidden" name="theme" value="dark">/);

    // A real order: `order` still renders and still survives the theme toggle.
    await addToCart(request, { variant_id: "AUR-LIN-SHIRT-NAVY-M", quantity: 1 });
    const order = (await readJson(
      await request("/api/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
    )).order as { id: string };

    html = await (await request(`/?order=${order.id}&theme=dark`)).text();
    assert.match(html, new RegExp(`Order <code>${order.id}</code> placed`));
    assert.match(html, /<html lang="en" data-theme="dark">/);
    assert.match(
      html,
      new RegExp(`<a href="/\\?order=${order.id}&amp;theme=light" data-role="theme">Light mode</a>`),
    );

    // A real add: `added` still renders on the manager in the chosen mode.
    const added = handle.store.catalog.addProduct({ name: "Atlas Tea", price_cents: 900, quantity: 4 });
    html = await (await request(`/manager?added=${added.id}&theme=dark`)).text();
    assert.match(html, new RegExp(`Added <code>${added.id}</code>`));
    assert.match(html, /<html lang="en" data-theme="dark">/);
    assert.match(
      html,
      new RegExp(`<a href="/manager\\?added=${added.id}&amp;theme=light" data-role="theme">Light mode</a>`),
    );
  });
});

test("the manager keeps the chosen mode across the add-product redirect and the error re-render", async () => {
  await withServer(async (_handle, request) => {
    const form = { name: "Atlas Coffee", price_cents: "1250", quantity: "10" };
    const encoded = { "content-type": "application/x-www-form-urlencoded" };

    const added = await request("/manager", {
      method: "POST",
      body: new URLSearchParams({ ...form, theme: "dark" }),
      headers: encoded,
      redirect: "manual",
    });
    assert.equal(added.status, 303);
    const location = added.headers.get("location") ?? "";
    assert.match(location, /^\/manager\?added=.+&theme=dark$/);
    assert.match(await (await request(location)).text(), /<html lang="en" data-theme="dark">/);

    // Bad input re-renders the manager with the reason, still in the same mode.
    const bad = await request("/manager", {
      method: "POST",
      body: new URLSearchParams({ name: "Bad", price_cents: "not-a-price", quantity: "1", theme: "dark" }),
      headers: encoded,
    });
    assert.equal(bad.status, 400);
    const html = await bad.text();
    assert.match(html, /Product price_cents must be an integer of at least 0/);
    assert.match(html, /<html lang="en" data-theme="dark">/);

    // No mode posted means the default, and the page is still light.
    const plain = await request("/manager", {
      method: "POST",
      body: new URLSearchParams({ ...form, name: "Atlas Cocoa" }),
      headers: encoded,
      redirect: "manual",
    });
    assert.match(plain.headers.get("location") ?? "", /&theme=light$/);
  });
});

test("the theme parameter reaches the pages only and leaves the JSON API alone", async () => {
  await withServer(async (_handle, request) => {
    for (const path of ["/api/health", "/api/catalog", "/api/cart", "/api/orders"]) {
      const plain = await readJson(await request(path));
      const themed = await readJson(await request(`${path}?theme=dark`));
      assert.deepEqual(themed, plain, path);
      assert.equal("theme" in themed, false, path);
    }

    // An error page honours the mode too, and links back in it.
    const error = await request("/?theme=dark", { method: "POST", body: "" });
    assert.equal(error.status, 405);
    const html = await error.text();
    assert.match(html, /<html lang="en" data-theme="dark">/);
    assert.match(html, /<a href="\/manager\?theme=dark">ecom-manager<\/a>/);
  });
});

// ---------------------------------------------------------------------------
// WCAG AA for the pairs these pages paint (contract.md v1.1.1, "Contrast")
// ---------------------------------------------------------------------------

/** WCAG 2.1 relative luminance, from the sRGB definition and nothing else. */
function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (raw: number): number => {
    const part = raw / 255;
    return part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((value >> 16) & 0xff) +
    0.7152 * channel((value >> 8) & 0xff) +
    0.0722 * channel(value & 0xff)
  );
}

/** The WCAG ratio: the lighter of the two over the darker, each offset by 0.05. */
function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Every rule in the sheet keyed by each of its own selectors, so a grouped
 * selector is addressable one part at a time. Comments are dropped first,
 * because a comment sits between two rules and would otherwise be read as part
 * of the selector that follows it.
 */
function ruleMap(sheet: string): Map<string, string> {
  const found = new Map<string, string>();
  const css = sheet.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const one of selector.split(",")) found.set(one.trim().replace(/\s+/g, " "), body);
  }
  return found;
}

/**
 * Every text pair the stylesheet paints, as (token, background) role names
 * resolved through the token table the page actually served, so the check
 * follows the tokens instead of restating hex values. `border.divider` is
 * deliberately absent: it is decorative by contract and never a text colour.
 */
const PAINTED_TEXT: Readonly<Record<string, readonly [string, string]>> = {
  "body on canvas": ["--atlas-fg-default", "--atlas-bg-canvas"],
  "body on a card, table or stat tile": ["--atlas-fg-default", "--atlas-bg-surface"],
  "muted line on canvas": ["--atlas-fg-muted", "--atlas-bg-canvas"],
  "link on canvas": ["--atlas-link", "--atlas-bg-canvas"],
  "text on accent": ["--atlas-on-accent", "--atlas-accent"],
  "warning note": ["--atlas-warning-fg", "--atlas-warning-bg"],
  "danger note": ["--atlas-danger-fg", "--atlas-danger-bg"],
  "info note": ["--atlas-info-fg", "--atlas-info-bg"],
};

/** Borders and rings that carry meaning are non-text UI, so WCAG 1.4.11 asks 3:1. */
const PAINTED_NON_TEXT: Readonly<Record<string, readonly [string, string]>> = {
  "focus ring on canvas": ["--atlas-focus-ring", "--atlas-bg-canvas"],
  "focus ring on a card": ["--atlas-focus-ring", "--atlas-bg-surface"],
  "control border on canvas": ["--atlas-border-control", "--atlas-bg-canvas"],
};

/**
 * The two pairs this stylesheet does not close, recorded rather than hidden.
 * Both are a contract question, not a missing rule: the token table either
 * keeps the value explicitly or derives it against `bg.canvas` alone, so no
 * token resolves them to AA where the pages paint them. A fix has to change
 * the painted pair or the contract, and then the row has to go.
 */
const DOCUMENTED_SHORTFALLS: ReadonlyArray<readonly [string, string, string, string, number]> = [
  // The contract keeps the light success pair as supplied at 3.38:1 and calls it
  // non-text and large-text only, yet `.ok-note` paints it as a .9rem status
  // line after checkout and after an add, so light mode is short of AA text.
  ["light", "success note", "--atlas-success-fg", "--atlas-success-bg", 4.5],
  // border.control is derived against bg.canvas (3.73:1 in dark) while every
  // control is painted on bg.surface, where that same value is 2.79:1.
  ["dark", "control border on a card", "--atlas-border-control", "--atlas-bg-surface", 3],
];

/** Both token tables as the page served them, keyed by mode. */
function modesOf(css: string): ReadonlyArray<readonly [string, Record<string, string>]> {
  return [
    ["light", tokens(css, LIGHT_SELECTOR)],
    ["dark", tokens(css, DARK_SELECTOR)],
  ];
}

test("every text pair these pages paint meets WCAG AA in both modes", async () => {
  await withServer(async (_handle, request) => {
    for (const path of ["/", "/manager"]) {
      const css = styleSheet(await (await request(path)).text());
      for (const [mode, values] of modesOf(css)) {
        for (const [role, [foreground, background]] of Object.entries(PAINTED_TEXT)) {
          const ratio = contrast(values[foreground], values[background]);
          assert.ok(ratio >= 4.5, `${path} ${mode}: ${role} is ${ratio.toFixed(2)}:1`);
        }
        // The success pair is the contract's own caveat rather than a rule the
        // stylesheet gets to choose: it is dark in light mode only, where it
        // measures 3.38:1 and is recorded as a shortfall instead.
        if (mode === "dark") {
          const ratio = contrast(values["--atlas-success-fg"], values["--atlas-success-bg"]);
          assert.ok(ratio >= 4.5, `${path} dark: success note is ${ratio.toFixed(2)}:1`);
        }
      }
    }
  });
});

test("every control border and focus ring meets 3:1 in both modes", async () => {
  await withServer(async (_handle, request) => {
    for (const path of ["/", "/manager"]) {
      const css = styleSheet(await (await request(path)).text());
      for (const [mode, values] of modesOf(css)) {
        for (const [role, [foreground, background]] of Object.entries(PAINTED_NON_TEXT)) {
          const ratio = contrast(values[foreground], values[background]);
          assert.ok(ratio >= 3, `${path} ${mode}: ${role} is ${ratio.toFixed(2)}:1`);
        }
      }
    }
  });
});

test("the dark muted token is only AA-safe on the canvas, and that is where it is painted", async () => {
  await withServer(async (_handle, request) => {
    for (const path of ["/", "/manager"]) {
      const css = styleSheet(await (await request(path)).text());
      const dark = tokens(css, DARK_SELECTOR);

      // The contract derived dark fg.muted against bg.canvas, so it clears AA
      // there and misses it on bg.surface. That is the whole reason the
      // stylesheet keeps it off cards, tables and stat tiles.
      assert.ok(contrast(dark["--atlas-fg-muted"], dark["--atlas-bg-canvas"]) >= 4.5, path);
      assert.ok(contrast(dark["--atlas-fg-muted"], dark["--atlas-bg-surface"]) < 4.5, path);

      // And the stylesheet agrees: only these rules paint it, and all of them
      // are lines the canvas itself paints.
      const paintedBy = [...ruleMap(css)]
        .filter(([, body]) => body.includes("var(--atlas-fg-muted)"))
        .map(([selector]) => selector)
        .sort();
      assert.deepEqual(paintedBy, [".meta", "footer", "label"], path);
    }
  });
});

test("every line a surface paints uses fg.default, and a state note still wins", async () => {
  await withServer(async (_handle, request) => {
    for (const path of ["/", "/manager"]) {
      const rules = ruleMap(styleSheet(await (await request(path)).text()));

      // These are the rules that put a card, a table, a stat tile, a disabled
      // button and a form control on bg.surface. An enabled button is not one of
      // them: it is painted with accent.default, and only [disabled] falls back.
      for (const selector of [".card", "table", "dl.stats div", "button[disabled]", "select", "input"]) {
        assert.match(rules.get(selector) ?? "", /background:\s*var\(--atlas-bg-surface\)/, `${path} ${selector}`);
      }
      // So the secondary lines inside them carry the body token, not the muted one.
      for (const selector of [".card .meta", ".card label", "table .meta", "dl.stats dt", "button[disabled]"]) {
        assert.match(rules.get(selector) ?? "", /color:\s*var\(--atlas-fg-default\)/, `${path} ${selector}`);
      }
      // The out-of-stock line is a muted line inside a card as well, so the
      // state pair has to out-specify the repaint instead of losing to it.
      assert.match(rules.get(".meta.warn") ?? "", /color:\s*var\(--atlas-warning-fg\)/, path);
      assert.match(rules.get(".warn") ?? "", /background:\s*var\(--atlas-warning-bg\)/, path);
    }
  });
});

test("the pairs the token table cannot reach are recorded as shortfalls", async () => {
  await withServer(async (_handle, request) => {
    const css = styleSheet(await (await request("/")).text());
    for (const [mode, role, foreground, background, threshold] of DOCUMENTED_SHORTFALLS) {
      const values = tokens(css, mode === "light" ? LIGHT_SELECTOR : DARK_SELECTOR);
      const ratio = contrast(values[foreground], values[background]);
      assert.ok(
        ratio < threshold,
        `${mode}: ${role} now measures ${ratio.toFixed(2)}:1 against a ${threshold}:1 threshold, so it is no longer a shortfall. ` +
          "Close the painted pair or amend the contract, then delete this row.",
      );
    }
  });
});
