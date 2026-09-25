import { startWebServer } from "./web-server.ts";

/**
 * A one-shot check of the demo web surface: it starts the server on an ephemeral
 * port, drives the storefront, the manager and every JSON route over real HTTP,
 * then closes the server. Nothing is left listening and no database is needed.
 */
async function main(): Promise<void> {
  const handle = await startWebServer({ port: 0 });
  const get = async (path: string) => {
    const response = await fetch(`${handle.url}${path}`);
    return { status: response.status, body: (await response.json()) as any };
  };
  const post = async (path: string, body: unknown) => {
    const response = await fetch(`${handle.url}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as any };
  };

  try {
    const health = await get("/api/health");
    if (health.status !== 200) throw new Error(`/api/health answered ${health.status}`);
    if (health.body.status !== "ok" || health.body.catalog.products !== 6 || health.body.catalog.variants !== 37) {
      throw new Error(`Unexpected health payload: ${JSON.stringify(health.body)}`);
    }

    const storefront = await fetch(`${handle.url}/`);
    const storefrontHtml = await storefront.text();
    if (!storefrontHtml.includes("images.unsplash.com") || !storefrontHtml.includes('data-role="color"')) {
      throw new Error("The storefront did not render variant selectors and variant images");
    }

    const manager = await fetch(`${handle.url}/manager`);
    const managerHtml = await manager.text();
    if (!managerHtml.includes("SOL-TRAIL-BTL-EMBER-750ML")) {
      throw new Error("The manager did not render the full variant stock table");
    }

    const added = await post("/api/cart", { variant_id: "AUR-LIN-SHIRT-NAVY-M", quantity: 2 });
    if (added.status !== 200) throw new Error(`Adding to the cart failed: ${JSON.stringify(added.body)}`);

    const cart = await get("/api/cart");
    if (cart.body.item_count !== 2 || cart.body.total_cents !== 17800) {
      throw new Error(`Unexpected cart: ${JSON.stringify(cart.body)}`);
    }

    const checkout = await post("/api/checkout", {});
    if (checkout.status !== 201 || checkout.body.order.total_cents !== 17800) {
      throw new Error(`Checkout did not create the expected order: ${JSON.stringify(checkout.body)}`);
    }

    const orders = await get("/api/orders");
    if (orders.body.summary.order_count !== 1) {
      throw new Error(`The order book holds ${orders.body.summary.order_count} orders, expected 1`);
    }

    const missing = await fetch(`${handle.url}/api/nope`);
    if (missing.status !== 404) throw new Error(`An unknown route answered ${missing.status}, expected 404`);

    console.log(
      JSON.stringify({
        ok: true,
        mode: "demo",
        in_memory: true,
        port: handle.port,
        products: health.body.catalog.products,
        variants: health.body.catalog.variants,
        sellable_variants: health.body.catalog.sellable_variants,
        order_id: checkout.body.order.id,
        order_total_cents: checkout.body.order.total_cents,
        orders: orders.body.summary.order_count,
        storefront_status: storefront.status,
        manager_status: manager.status,
        unknown_route_status: missing.status,
      }),
    );
  } finally {
    await handle.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(`atlas-ecom web smoke failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
}
