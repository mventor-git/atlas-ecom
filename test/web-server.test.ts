import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { DEFAULT_WEB_PORT, readWebPort, startWebServer, type WebServerHandle } from "../src/index.ts";

/**
 * Every test drives the real listener over a real socket on an ephemeral port
 * and closes the server before it returns, so a run never leaves a process
 * listening and never collides with a demo server on 4312.
 */

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

    assert.match(html, /<html lang="en">/);
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
