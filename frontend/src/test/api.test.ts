import { describe, expect, it } from "vitest";
import { api, ApiError } from "@/lib/api";
import { addToCartPayload, apiRoutes, catalogPayload, createProductPayload, emptyCartPayload } from "@/test/fixtures";
import { stubApi } from "@/test/setup";

describe("api client", () => {
  it("parses the catalog payload and keeps prices as integer cents", async () => {
    const stub = stubApi({ routes: apiRoutes });

    const catalog = await api.catalog();

    expect(stub.callsTo("/api/catalog")).toHaveLength(1);
    expect(catalog.counts).toEqual(catalogPayload.counts);
    const product = catalog.products[0];
    expect(product.name).toBe("Sol Trail Bottle");
    // No float ever appears: a price is the integer the API sent.
    expect(product.variants[0].price_cents).toBe(4500);
    expect(product.variants.every((entry) => Number.isInteger(entry.price_cents))).toBe(true);
  });

  it("rejects a payload the frontend does not understand instead of rendering it", async () => {
    stubApi({ routes: apiRoutes, overrides: { "/api/catalog": { mode: "demo", products: "not-an-array" } } });

    await expect(api.catalog()).rejects.toBeInstanceOf(ApiError);
    await expect(api.catalog()).rejects.toThrow(/does not understand/);
  });

  it("rejects a float price, because money is integer cents end to end", async () => {
    const withFloat = structuredClone(catalogPayload) as unknown as {
      products: { variants: { price_cents: number }[] }[];
    };
    withFloat.products[0].variants[0].price_cents = 45.5;
    stubApi({ routes: apiRoutes, overrides: { "/api/catalog": withFloat } });

    await expect(api.catalog()).rejects.toThrow(/does not understand/);
  });

  it("surfaces the domain's own message on a 400 rather than a generic failure", async () => {
    stubApi({
      routes: apiRoutes,
      overrides: { "/api/cart": { error: 'Only 1 of "SOL-TRAIL-BTL-SLATE-500ML" available' } },
      statuses: { "/api/cart": 400 },
    });

    await expect(api.addToCart("SOL-TRAIL-BTL-SLATE-500ML", 5)).rejects.toThrow(/Only 1 of/);
  });

  it("posts a variant id and quantity to /api/cart", async () => {
    const stub = stubApi({ routes: apiRoutes, overrides: { "/api/cart": addToCartPayload } });

    await api.addToCart("SOL-TRAIL-BTL-SAND-750ML", 2);

    const [post] = stub.callsTo("/api/cart").filter((call) => call.method === "POST");
    expect(JSON.parse(post?.body ?? "null")).toEqual({
      variant_id: "SOL-TRAIL-BTL-SAND-750ML",
      quantity: 2,
    });
  });

  it("parses an empty cart rather than treating it as a failure", async () => {
    stubApi({ routes: apiRoutes, overrides: { "/api/cart": emptyCartPayload } });

    await expect(api.cart()).resolves.toMatchObject({ item_count: 0, total_cents: 0, lines: [] });
  });

  it("posts a new product to /api/catalog and parses the create envelope", async () => {
    const stub = stubApi({ routes: apiRoutes, overrides: { "/api/catalog": createProductPayload } });

    const created = await api.addProduct({ name: "Atlas Coffee", price_cents: 1250, quantity: 10 });

    const post = stub.callsTo("/api/catalog").find((call) => call.method === "POST");
    expect(post?.url).toBe("/api/catalog");
    // The body the server validates, restated here so the two sides stay pinned.
    expect(JSON.parse(post?.body ?? "null")).toEqual({ name: "Atlas Coffee", price_cents: 1250, quantity: 10 });
    expect(created.product.name).toBe("Atlas Coffee");
    expect(created.counts).toEqual(createProductPayload.counts);
    expect(created.in_memory).toBe(true);
  });

  it("surfaces the domain's reason when the catalogue write is refused", async () => {
    stubApi({
      routes: apiRoutes,
      overrides: { "/api/catalog": { error: "Product price_cents must be an integer of at least 0" } },
      statuses: { "/api/catalog": 400 },
    });

    await expect(api.addProduct({ name: "Bad", price_cents: 12.5, quantity: 1 })).rejects.toThrow(
      /Product price_cents must be an integer of at least 0/,
    );
  });

  it("rejects a create envelope with no product in it", async () => {
    const { product: _product, ...withoutProduct } = createProductPayload;
    stubApi({ routes: apiRoutes, overrides: { "/api/catalog": withoutProduct } });

    await expect(api.addProduct({ name: "Atlas Coffee", price_cents: 1250, quantity: 10 })).rejects.toThrow(
      /does not understand/,
    );
  });
});
