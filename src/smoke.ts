import { Cart, StandaloneCatalog } from "./commerce.ts";
import { createEcomRegistry } from "./registry.ts";

const manifest = createEcomRegistry().manifest();
if (!manifest.capabilities.includes("catalog")) {
  throw new Error("Atlas Ecom registry did not boot with catalog capability");
}

// Standalone commerce path: an operator publishes the catalog, a customer checks out a cart.
const catalog = new StandaloneCatalog();
const coffee = catalog.addProduct({ name: "Atlas Coffee", price_cents: 1250, quantity: 10 });
const mug = catalog.addProduct({ name: "Atlas Mug", price_cents: 1800, quantity: 4 });

const cart = new Cart(catalog);
cart.addItem(coffee.id, 2);
cart.addItem(mug.id, 1);
if (cart.totalCents() !== 4300) {
  throw new Error(`Expected a 4300 cent cart, got ${cart.totalCents()}`);
}

const order = cart.checkout();
if (order.status !== "created" || order.total_cents !== 4300) {
  throw new Error(`Expected a created 4300 cent order, got ${order.status} ${order.total_cents}`);
}
if (cart.totalCents() !== 0) {
  throw new Error("Expected checkout to clear the cart");
}

const coffeeStock = catalog.getProduct(coffee.id)?.quantity;
const mugStock = catalog.getProduct(mug.id)?.quantity;
if (coffeeStock !== 8 || mugStock !== 3) {
  throw new Error(`Unexpected post-checkout stock: coffee=${coffeeStock}, mug=${mugStock}`);
}

catalog.deactivateProduct(mug.id);
const storefront = catalog.listProducts();

console.log("Atlas Ecom standalone registry booted");
console.log(JSON.stringify(manifest, null, 2));
console.log(
  `Atlas Ecom catalog -> cart -> order path: ${order.status} order ${order.id}, ${storefront.length} active product(s), post-checkout stock coffee=${coffeeStock}, mug=${mugStock}`,
);
