import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ThemeProvider } from "@/lib/theme";
import { Storefront } from "@/routes/storefront";
import { addToCartPayload, apiRoutes, catalogPayload, checkoutPayload, emptyCartPayload } from "@/test/fixtures";
import { stubApi } from "@/test/setup";

function renderStorefront() {
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <Storefront />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

const colorSelect = async (user: ReturnType<typeof userEvent.setup>) =>
  await user.click(screen.getByRole("combobox", { name: "Colour" }));
const sizeSelect = async (user: ReturnType<typeof userEvent.setup>) =>
  await user.click(screen.getByRole("combobox", { name: "Size" }));

describe("storefront", () => {
  it("renders a card per product with its price and the API's counts", async () => {
    stubApi({ routes: apiRoutes });
    renderStorefront();

    expect(await screen.findByText("Sol Trail Bottle")).toBeInTheDocument();
    expect(screen.getByText("$45.00")).toBeInTheDocument();
    expect(screen.getByText(`${catalogPayload.counts.sellable_variants} of ${catalogPayload.counts.variants} variants are sellable.`)).toBeInTheDocument();
  });

  it("filters sizes by the chosen colour", async () => {
    const user = userEvent.setup();
    stubApi({ routes: apiRoutes });
    renderStorefront();
    await screen.findByText("Sol Trail Bottle");

    expect(screen.getByText("Sand / 750ml — 4 available")).toBeInTheDocument();
    await colorSelect(user);
    await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Slate" }));
    await sizeSelect(user);

    // Slate has a 750ml and a 500ml, and the 500ml is sold out.
    expect(within(screen.getByRole("listbox")).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "750ml",
      "500ml",
    ]);
  });

  it("shows the warning state and blocks add-to-cart for a sold-out variant", async () => {
    const user = userEvent.setup();
    stubApi({ routes: apiRoutes });
    renderStorefront();
    await screen.findByText("Sol Trail Bottle");

    await colorSelect(user);
    await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Slate" }));
    await sizeSelect(user);
    await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: "500ml" }));

    expect(await screen.findByText("Out of stock in Slate")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to cart" })).toBeDisabled();
  });

  it("posts the selected variant and quantity to /api/cart and shows it in the cart", async () => {
    const user = userEvent.setup();
    const stub = stubApi({ routes: apiRoutes, overrides: { "/api/cart": addToCartPayload } });
    renderStorefront();
    await screen.findByText("Sol Trail Bottle");

    const quantity = screen.getByLabelText("Quantity");
    await user.clear(quantity);
    await user.type(quantity, "2");
    await user.click(screen.getByRole("button", { name: "Add to cart" }));

    await waitFor(() => {
      const post = stub.callsTo("/api/cart").find((call) => call.method === "POST");
      expect(JSON.parse(post?.body ?? "null")).toEqual({
        variant_id: "SOL-TRAIL-BTL-SAND-750ML",
        quantity: 2,
      });
    });
    // The cart is re-read rather than patched locally, so the count is the API's.
    await waitFor(() => expect(screen.getByRole("button", { name: /Cart \(1\)/ })).toBeInTheDocument());
  });

  it("shows the domain's rejection when the API refuses the add", async () => {
    const user = userEvent.setup();
    stubApi({
      routes: apiRoutes,
      overrides: { "/api/cart": { error: 'Only 1 of "SOL-TRAIL-BTL-SAND-750ML" available' } },
      statuses: { "/api/cart": 400 },
    });
    renderStorefront();
    await screen.findByText("Sol Trail Bottle");

    await user.click(screen.getByRole("button", { name: "Add to cart" }));

    expect(await screen.findByRole("alert")).toHaveTextContent('Only 1 of "SOL-TRAIL-BTL-SAND-750ML" available');
  });

  it("checks out through the cart panel and reports the order", async () => {
    const user = userEvent.setup();
    const stub = stubApi({ routes: apiRoutes });
    renderStorefront();
    await screen.findByText("Sol Trail Bottle");

    await user.click(await screen.findByRole("button", { name: /Cart \(1\)/ }));
    expect(await screen.findByText("Sol Trail Bottle (Sand / 750ml)")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Check out" }));

    const post = await waitFor(() => {
      const call = stub.callsTo("/api/checkout").find((entry) => entry.method === "POST");
      expect(call).toBeDefined();
      return call;
    });
    expect(post?.url).toBe("/api/checkout");
    expect(await screen.findByText(/Order/)).toHaveTextContent(`Order ${checkoutPayload.order.id} placed for $45.00`);
  });

  it("disables checkout on an empty cart and never posts", async () => {
    const user = userEvent.setup();
    const stub = stubApi({ routes: apiRoutes, overrides: { "/api/cart": emptyCartPayload } });
    renderStorefront();
    await screen.findByText("Sol Trail Bottle");

    await user.click(await screen.findByRole("button", { name: /Cart \(0\)/ }));
    expect(await screen.findByRole("button", { name: "Check out" })).toBeDisabled();
    expect(stub.callsTo("/api/checkout")).toHaveLength(0);
  });
});
