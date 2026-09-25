import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useSearchParams } from "react-router-dom";
import { z } from "zod";
import { AppShell, Notice, SuccessNotice } from "@/components/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, type Cart, type Catalog, type Health, type Orders } from "@/lib/api";
import { formatCents } from "@/lib/money";
import { useRemote } from "@/lib/use-remote";

/**
 * The standalone branch of Add Product. The write is a JSON `POST /api/catalog`
 * and the server owns the catalogue; the mode needs no field now, because the
 * app does not reload to submit, so the persisted choice simply survives. zod and
 * react-hook-form refuse an obviously bad input before the post, and the server
 * revalidates it either way with the same reasons.
 */
const addProductSchema = z.object({
  name: z.string().trim().min(1, "A name is required").max(80, "A name is at most 80 characters"),
  price_cents: z.coerce.number().int("Price must be whole cents").min(0, "Price cannot be negative"),
  quantity: z.coerce.number().int("Quantity must be a whole number").min(0, "Quantity cannot be negative"),
});

/** What the fields hold before the resolver runs, and what it hands the server. */
type AddProductFields = z.input<typeof addProductSchema>;
type AddProductValues = z.output<typeof addProductSchema>;

function AddProductForm({ onCreated }: { onCreated(id: string): void }) {
  const [error, setError] = React.useState<string | undefined>();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AddProductFields, unknown, AddProductValues>({
    resolver: zodResolver(addProductSchema),
    defaultValues: { name: "", price_cents: 1250, quantity: 10 },
  });

  return (
    <Card className="on-surface">
      <CardHeader>
        <CardTitle>Add product</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-sm">
          The standalone branch of Add Product: written straight into the in-memory catalogue, because no peer is
          paired. With a peer holding the capability this would become a proposal instead.
        </p>
        <form
          className="grid gap-3 sm:grid-cols-4"
          onSubmit={handleSubmit(async (values) => {
            setError(undefined);
            try {
              const created = await api.addProduct(values);
              reset({ name: "", price_cents: 0, quantity: 0 });
              onCreated(created.product.id);
            } catch (failure) {
              // The API's own reason, so a domain rejection reads the same here as
              // it does on the server-rendered manager.
              setError(failure instanceof Error ? failure.message : "The product could not be added");
            }
          })}
        >
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" maxLength={80} placeholder="Atlas Coffee" {...register("name")} />
            {errors.name === undefined ? null : (
              <p role="alert" className="text-sm text-danger-foreground">
                {errors.name.message}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="price_cents">Price (integer cents)</Label>
            <Input id="price_cents" type="number" min={0} step={1} {...register("price_cents")} />
            {errors.price_cents === undefined ? null : (
              <p role="alert" className="text-sm text-danger-foreground">
                {errors.price_cents.message}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="quantity">Quantity</Label>
            <Input id="quantity" type="number" min={0} step={1} {...register("quantity")} />
            {errors.quantity === undefined ? null : (
              <p role="alert" className="text-sm text-danger-foreground">
                {errors.quantity.message}
              </p>
            )}
          </div>
          <div className="sm:col-span-4">
            {error === undefined ? null : (
              <div className="mb-3">
                <Notice tone="danger" role="alert">
                  {error}
                </Notice>
              </div>
            )}
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Adding…" : "Add product"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-xs font-normal uppercase tracking-wide text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-lg tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

export function Manager() {
  const health = useRemote<Health>(React.useCallback(() => api.health(), []));
  const catalog = useRemote<Catalog>(React.useCallback(() => api.catalog(), []));
  const orders = useRemote<Orders>(React.useCallback(() => api.orders(), []));
  const cart = useRemote<Cart>(React.useCallback(() => api.cart(), []));
  const [params] = useSearchParams();
  // The id of the product this session created, or one a `?added=` link carries
  // from the server-rendered manager, which still posts to /manager itself.
  const [created, setCreated] = React.useState<string | null>(null);
  const added = created ?? params.get("added");

  /** The catalogue and the stats both moved, so both are re-read rather than patched. */
  function onCreated(id: string) {
    setCreated(id);
    catalog.reload();
    health.reload();
  }

  const rows =
    catalog.data?.products.flatMap((product) =>
      product.variants.map((variant) => ({ product, variant })),
    ) ?? [];

  return (
    <AppShell surface="ecom-manager">
      {catalog.data === undefined ? null : (
        <Notice>
          <strong>Demo slice, in memory.</strong> Every number below is read from the Ecom Node API on load, and the
          <code> OrderBook</code> it reports lives in that process: a restart leaves it empty. No authentication, no
          audit trail, no persistence, and no connection to Atlas ERP.
        </Notice>
      )}

      {added === null ? null : (
        <SuccessNotice>Added {added} to the in-memory catalogue. It is not written to a database.</SuccessNotice>
      )}

      {health.error ?? catalog.error ?? orders.error ?? cart.error === undefined ? null : (
        <Notice tone="danger" role="alert">
          {health.error ?? catalog.error ?? orders.error ?? cart.error}
        </Notice>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Products" value={String(catalog.data?.counts.products ?? "—")} />
        <Stat label="Variants" value={String(catalog.data?.counts.variants ?? "—")} />
        <Stat label="Sellable" value={String(catalog.data?.counts.sellable_variants ?? "—")} />
        <Stat label="Cart" value={cart.data === undefined ? "—" : formatCents(cart.data.total_cents)} />
        <Stat label="Orders" value={String(orders.data?.summary.order_count ?? "—")} />
        <Stat label="Order value" value={orders.data === undefined ? "—" : formatCents(orders.data.summary.total_cents)} />
      </div>

      {health.data === undefined ? null : (
        <p className="text-sm text-muted-foreground">
          API reports mode <code>{health.data.mode}</code>, database <code>{health.data.database}</code>, peer connected{" "}
          <code>{String(health.data.peer_connected)}</code>, source <code>{health.data.source}</code>.
        </p>
      )}

      <Tabs defaultValue="catalogue">
        <TabsList>
          <TabsTrigger value="catalogue">Catalogue and stock</TabsTrigger>
          <TabsTrigger value="orders">Orders</TabsTrigger>
          <TabsTrigger value="add">Add product</TabsTrigger>
        </TabsList>

        <TabsContent value="catalogue">
          <Card className="on-surface">
            <CardContent className="px-0">
              <p className="px-4 pb-3 text-sm">
                One row per colour/size variant, straight from the example seed. A variant at zero available is sold
                out; an inactive variant is catalogued but not sellable.
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Variant id</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Colour</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Available</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(({ product, variant }) => (
                    <TableRow key={variant.id}>
                      <TableCell>
                        <code>{variant.variant_id}</code>
                      </TableCell>
                      <TableCell>{product.name}</TableCell>
                      <TableCell>{variant.color}</TableCell>
                      <TableCell>{variant.size}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCents(variant.price_cents)}</TableCell>
                      <TableCell
                        className={
                          variant.active && variant.available === 0
                            ? "state-note bg-warning text-warning-foreground text-right tabular-nums"
                            : "text-right tabular-nums"
                        }
                      >
                        {variant.available}
                      </TableCell>
                      <TableCell>
                        {variant.active ? (
                          <Badge variant="secondary">active</Badge>
                        ) : (
                          <Badge>inactive</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="orders">
          <Card className="on-surface">
            <CardContent className="px-0">
              <p className="px-4 pb-3 text-sm">
                {orders.data === undefined
                  ? "Reading orders…"
                  : `${orders.data.summary.order_count} order(s), ${formatCents(orders.data.summary.total_cents)} in total. The OrderBook is in memory: a restart leaves it empty.`}
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order id</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right">Lines</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.data === undefined || orders.data.orders.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-muted-foreground">
                        No orders yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    orders.data.orders.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell>
                          <code>{order.id}</code>
                        </TableCell>
                        <TableCell>{order.status}</TableCell>
                        <TableCell>{order.source ?? "standalone"}</TableCell>
                        <TableCell className="text-right tabular-nums">{order.lines.length}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCents(order.total_cents)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="add">
          <AddProductForm onCreated={onCreated} />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
