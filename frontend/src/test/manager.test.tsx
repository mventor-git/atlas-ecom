import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ThemeProvider } from "@/lib/theme";
import { Manager } from "@/routes/manager";
import {
  apiRoutes,
  catalogAfterCreate,
  catalogPayload,
  createProductPayload,
  createdProduct,
  healthAfterCreate,
  healthPayload,
  ordersPayload,
} from "@/test/fixtures";
import { stubApi } from "@/test/setup";

function renderManager(path = "/manager") {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <Manager />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

/** The Add product tab's own form, once the tab has rendered it. */
async function addProductForm(): Promise<HTMLFormElement> {
  const button = await screen.findByRole("button", { name: /Add product|Adding/ });
  return button.closest("form") as HTMLFormElement;
}

/** Fills the one field that has no usable default, so the resolver passes. */
async function fillName(name: string) {
  const field = screen.getByLabelText("Name");
  await userEvent.clear(field);
  await userEvent.type(field, name);
}

describe("ecom-manager", () => {
  it("renders the stats the API reports and states the demo limits", async () => {
    stubApi({ routes: apiRoutes });
    renderManager();

    // /api/health has answered, so the stats below are the API's numbers.
    expect(await screen.findByText(/API reports mode/)).toBeInTheDocument();
    // The tab trigger and the stat tile share a label, so pick the tile.
    const stat = (label: string) => {
      const tiles = screen.getAllByText(label).map((node) => node.closest('[data-slot="card"]'));
      return tiles.find((tile) => tile !== null) as HTMLElement;
    };
    expect(within(stat("Products")).getByText(String(healthPayload.catalog.products))).toBeInTheDocument();
    expect(within(stat("Variants")).getByText(String(healthPayload.catalog.variants))).toBeInTheDocument();
    expect(within(stat("Sellable")).getByText(String(healthPayload.catalog.sellable_variants))).toBeInTheDocument();
    expect(within(stat("Orders")).getByText(String(healthPayload.orders.order_count))).toBeInTheDocument();
    expect(within(stat("Order value")).getByText("$45.00")).toBeInTheDocument();
    expect(within(stat("Cart")).getByText("$45.00")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Demo slice, in memory.");
  });

  it("lists every variant with its stock, price and status", async () => {
    stubApi({ routes: apiRoutes });
    renderManager();

    const table = await screen.findByRole("table");
    for (const id of [
      "SOL-TRAIL-BTL-SAND-750ML",
      "SOL-TRAIL-BTL-SAND-500ML",
      "SOL-TRAIL-BTL-SLATE-750ML",
      "SOL-TRAIL-BTL-SLATE-500ML",
    ]) {
      expect(within(table).getByText(id)).toBeInTheDocument();
    }
    expect(within(table).getAllByText("active")).toHaveLength(4);
  });

  it("marks a sold-out active variant with the warning state rather than only a zero", async () => {
    stubApi({ routes: apiRoutes });
    renderManager();

    const table = await screen.findByRole("table");
    const row = within(table).getByText("SOL-TRAIL-BTL-SLATE-500ML").closest("tr");
    const cell = within(row as HTMLElement).getByText("0");
    expect(cell).toHaveClass("state-note", "bg-warning", "text-warning-foreground");
  });

  it("lists orders from /api/orders and says the book is in memory", async () => {
    const user = userEvent.setup();
    stubApi({ routes: apiRoutes });
    renderManager();
    await screen.findByText(/API reports mode/);

    await user.click(screen.getByRole("tab", { name: "Orders" }));

    expect(await screen.findByText(ordersPayload.orders[0].id)).toBeInTheDocument();
    expect(screen.getByText("created")).toBeInTheDocument();
    expect(screen.getByText(/The OrderBook is in memory/)).toBeInTheDocument();
  });

  it("shows the success notice when the server redirects back after an add", async () => {
    stubApi({ routes: apiRoutes });
    renderManager("/manager?added=abc-123&theme=dark");

    expect(await screen.findByText(/Added abc-123/)).toBeInTheDocument();
  });

  it("posts the add-product form to /api/catalog as JSON and shows the created product", async () => {
    const user = userEvent.setup();
    const stub = stubApi({
      routes: apiRoutes,
      overrides: { "/api/catalog": createProductPayload },
    });
    renderManager();
    await screen.findByText(/API reports mode/);
    await user.click(screen.getByRole("tab", { name: "Add product" }));

    const form = await addProductForm();
    // No native action and no hidden theme field: the write is a fetch, so the
    // page does not reload and the persisted mode needs no round trip.
    expect(form).not.toHaveAttribute("action");
    expect(form).not.toHaveAttribute("method");
    expect(form.querySelector('input[name="theme"]')).toBeNull();

    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Atlas Coffee");
    // user-event does not perform the implicit submission a browser would.
    fireEvent.submit(form);

    const post = await waitFor(() => {
      const call = stub.callsTo("/api/catalog").find((entry) => entry.method === "POST");
      expect(call).toBeDefined();
      return call;
    });
    expect(post?.url).toBe("/api/catalog");
    expect(JSON.parse(post?.body ?? "null")).toEqual({
      name: "Atlas Coffee",
      price_cents: 1250,
      quantity: 10,
    });
    expect(await screen.findByText(new RegExp(`Added ${createdProduct.id}`))).toBeInTheDocument();
  });

  it("re-reads the catalogue and the stats after a create instead of patching them", async () => {
    const user = userEvent.setup();
    const stub = stubApi({
      routes: apiRoutes,
      overrides: {
        "/api/catalog": [catalogPayload, createProductPayload, catalogAfterCreate],
        "/api/health": [healthPayload, healthAfterCreate],
      },
    });
    renderManager();
    await screen.findByText(/API reports mode/);
    await user.click(screen.getByRole("tab", { name: "Add product" }));

    const before = {
      catalog: stub.callsTo("/api/catalog").filter((entry) => entry.method === "GET").length,
      health: stub.callsTo("/api/health").length,
    };
    await fillName("Atlas Coffee");
    fireEvent.submit(await addProductForm());
    await screen.findByText(new RegExp(`Added ${createdProduct.id}`));

    await waitFor(() => {
      expect(stub.callsTo("/api/catalog").filter((entry) => entry.method === "GET").length).toBe(before.catalog + 1);
      expect(stub.callsTo("/api/health").length).toBe(before.health + 1);
    });
    // The new row reaches the stock table from the re-read catalogue.
    await user.click(screen.getByRole("tab", { name: "Catalogue and stock" }));
    const table = await screen.findByRole("table");
    expect(within(table).getByText(createdProduct.variants[0].variant_id)).toBeInTheDocument();
  });

  it("shows the API's own reason when the catalogue write is refused", async () => {
    const user = userEvent.setup();
    stubApi({
      routes: apiRoutes,
      overrides: { "/api/catalog": { error: "Product price_cents must be an integer of at least 0" } },
      statuses: { "/api/catalog": 400 },
    });
    renderManager();
    await screen.findByText(/API reports mode/);
    await user.click(screen.getByRole("tab", { name: "Add product" }));

    await fillName("Atlas Coffee");
    fireEvent.submit(await addProductForm());

    expect(await screen.findByRole("alert")).toHaveTextContent("Product price_cents must be an integer of at least 0");
    // A refused add claims nothing, so no success notice appears.
    expect(screen.queryByText(/Added /)).not.toBeInTheDocument();
  });

  it("refuses an invalid add in the browser before any post", async () => {
    const user = userEvent.setup();
    const stub = stubApi({ routes: apiRoutes });
    renderManager();
    await screen.findByText(/API reports mode/);
    await user.click(screen.getByRole("tab", { name: "Add product" }));

    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Atlas Coffee");
    const price = screen.getByLabelText("Price (integer cents)");
    await user.clear(price);
    await user.type(price, "-5");
    fireEvent.submit(await addProductForm());

    expect(await screen.findByRole("alert")).toHaveTextContent("Price cannot be negative");
    expect(stub.callsTo("/api/catalog").some((entry) => entry.method === "POST")).toBe(false);
  });

  it("keeps the chosen mode across a create, with no theme field to carry it", async () => {
    const user = userEvent.setup();
    stubApi({ routes: apiRoutes, overrides: { "/api/catalog": createProductPayload } });
    renderManager();
    await screen.findByText(/API reports mode/);
    await user.click(screen.getByRole("button", { name: "Dark mode" }));
    await user.click(screen.getByRole("tab", { name: "Add product" }));

    await fillName("Atlas Coffee");
    fireEvent.submit(await addProductForm());
    await screen.findByText(new RegExp(`Added ${createdProduct.id}`));

    // The app never reloads to submit, so the class and the stored choice both hold.
    expect(document.documentElement).toHaveClass("dark");
    expect(window.localStorage.getItem("atlas-ecom-theme")).toBe("dark");
  });
});
