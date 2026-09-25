import * as React from "react";
import { ShoppingCartIcon } from "lucide-react";
import { AppShell, Notice, SuccessNotice } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, type Cart, type Catalog, type CatalogProduct, type CatalogVariant, type Checkout } from "@/lib/api";
import { formatCents } from "@/lib/money";
import { useRemote } from "@/lib/use-remote";

/**
 * One product card: colour filters size, the image and price follow the chosen
 * variant, and availability is the API's own `available` count for that variant.
 * Nothing is derived here that the API did not already state.
 */
function ProductCard({
  product,
  onAdd,
  busy,
}: {
  product: CatalogProduct;
  onAdd(variant: CatalogVariant, quantity: number): void;
  busy: boolean;
}) {
  const active = product.variants.filter((variant) => variant.active);
  const colors = [...new Set(active.map((variant) => variant.color))];
  const [color, setColor] = React.useState(colors[0] ?? "");
  const [quantity, setQuantity] = React.useState(1);

  // Changing colour re-points the size select at the first size that colour has,
  // which is the only reason a size is ever out of step with the colour.
  const sizes = active.filter((variant) => variant.color === color);
  const [size, setSize] = React.useState(sizes[0]?.id ?? "");
  const selected = active.find((variant) => variant.id === (sizes.some((v) => v.id === size) ? size : sizes[0]?.id));
  const available = selected?.available ?? 0;
  const maxQuantity = Math.max(1, available);

  return (
    <Card className="on-surface">
      {selected?.image_url ? (
        <img
          src={selected.image_url}
          alt={selected.image_alt ?? `${product.name} in ${selected.color}`}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="aspect-[16/9] w-full bg-border object-cover"
        />
      ) : null}
      <CardHeader>
        <CardTitle>{product.name}</CardTitle>
        <CardDescription>
          {product.brand} · {product.category} · {product.sku}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm">{product.description}</p>
        <p className="text-base font-medium tabular-nums">
          {selected === undefined ? "—" : formatCents(selected.price_cents)}{" "}
          <span className="text-sm font-normal text-muted-foreground">
            · {active.length} colour/size variant{active.length === 1 ? "" : "s"}
          </span>
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${product.id}-color`}>Colour</Label>
            <Select
              value={color}
              onValueChange={(next) => {
                setColor(next);
                setSize("");
              }}
            >
              <SelectTrigger id={`${product.id}-color`} className="w-full">
                <SelectValue placeholder="Colour" />
              </SelectTrigger>
              <SelectContent>
                {colors.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${product.id}-size`}>Size</Label>
            <Select value={selected?.id ?? ""} onValueChange={setSize}>
              <SelectTrigger id={`${product.id}-size`} className="w-full">
                <SelectValue placeholder="Size" />
              </SelectTrigger>
              <SelectContent>
                {sizes.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${product.id}-quantity`}>Quantity</Label>
            <Input
              id={`${product.id}-quantity`}
              type="number"
              inputMode="numeric"
              min={1}
              max={maxQuantity}
              value={quantity}
              onChange={(event) => setQuantity(Number(event.target.value))}
            />
          </div>

          <div className="flex items-end">
            <Button
              className="w-full"
              disabled={busy || selected === undefined || available < 1}
              onClick={() => selected && onAdd(selected, quantity)}
            >
              Add to cart
            </Button>
          </div>
        </div>

        <p aria-live="polite" className="text-sm">
          {selected === undefined ? (
            "Not available"
          ) : available > 0 ? (
            <span className="text-muted-foreground">
              {selected.color} / {selected.size} — {available} available
            </span>
          ) : (
            <span className="state-note bg-warning text-warning-foreground rounded px-1.5 py-0.5">
              Out of stock in {selected.color}
            </span>
          )}
        </p>
      </CardContent>
    </Card>
  );
}

function CartSheet({ cart, onCheckout, checkingOut }: { cart: Cart; onCheckout(): void; checkingOut: boolean }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="secondary">
          <ShoppingCartIcon aria-hidden />
          Cart ({cart.item_count})
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Cart</SheetTitle>
          <SheetDescription>
            One shared demo cart. Checking out posts to /api/checkout and creates an in-memory order; it is not a paid
            sale.
          </SheetDescription>
        </SheetHeader>
        {cart.lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">Cart is empty.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Unit</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Line</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cart.lines.map((line) => (
                <TableRow key={line.product_id}>
                  <TableCell>{line.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(line.unit_price_cents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{line.quantity}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(line.line_total_cents)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <SheetFooter>
          <p className="text-sm tabular-nums">Total {formatCents(cart.total_cents)}</p>
          <Button onClick={onCheckout} disabled={cart.lines.length === 0 || checkingOut}>
            {checkingOut ? "Checking out…" : "Check out"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function Storefront() {
  const catalog = useRemote<Catalog>(React.useCallback(() => api.catalog(), []));
  const cart = useRemote<Cart>(React.useCallback(() => api.cart(), []));
  const [error, setError] = React.useState<string | undefined>();
  const [order, setOrder] = React.useState<Checkout | undefined>();
  const [busy, setBusy] = React.useState(false);

  async function addToCart(variant: CatalogVariant, quantity: number) {
    setBusy(true);
    setError(undefined);
    try {
      await api.addToCart(variant.id, quantity);
      cart.reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The item could not be added");
    } finally {
      setBusy(false);
    }
  }

  async function checkout() {
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.checkout();
      setOrder(result);
      // Stock moved server-side, so the catalogue is re-read rather than assumed.
      cart.reload();
      catalog.reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Checkout failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      surface="storefront"
      aside={cart.data === undefined ? undefined : <CartSheet cart={cart.data} onCheckout={checkout} checkingOut={busy} />}
    >
      {catalog.data === undefined ? null : (
        <Notice>
          <strong>Demo slice, in memory.</strong> The catalogue is the example data from <code>db/seed.sql</code> (
          {catalog.data.counts.products} products, {catalog.data.counts.variants} variants), rebuilt on every start of
          the API. There is one shared cart, no accounts, no payment, and no database.
        </Notice>
      )}

      {order === undefined ? null : (
        <SuccessNotice>
          Order <code>{order.order.id}</code> placed for {formatCents(order.order.total_cents)}. It is in memory
          only, and this is not a paid sale.
        </SuccessNotice>
      )}

      {error === undefined && catalog.error === undefined && cart.error === undefined ? null : (
        <Notice tone="danger" role="alert">
          {error ?? catalog.error ?? cart.error}
        </Notice>
      )}

      <h2 className="font-heading text-lg font-medium">Catalogue</h2>
      {catalog.loading ? <p className="text-sm text-muted-foreground">Loading the catalogue…</p> : null}
      {catalog.data === undefined ? null : catalog.data.products.length === 0 ? (
        <p className="text-sm text-muted-foreground">No products are published.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {catalog.data.products.map((product) => (
            <ProductCard key={product.id} product={product} onAdd={addToCart} busy={busy} />
          ))}
        </div>
      )}

      {catalog.data === undefined ? null : (
        <p className="text-sm text-muted-foreground">
          {catalog.data.counts.sellable_variants} of {catalog.data.counts.variants} variants are sellable.
        </p>
      )}
    </AppShell>
  );
}
