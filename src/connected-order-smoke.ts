import { randomUUID } from "node:crypto";
import { AtlasErpClient } from "./erp-client.ts";
import { ConnectedCatalog, ErpAuditConsumer } from "./erp-consumer.ts";
import { CONNECT_VERSION, handshake } from "./protocol.ts";

/**
 * Read the connected ERP catalog, submit exactly one manual sale at the catalog
 * price, then re-read the peer to confirm the write moved stock. This is the
 * first Ecom write over the transport, so it is refused unless
 * ATLAS_ERP_ALLOW_WRITE=1 is set explicitly: an accidental run must not post a
 * sale into a peer.
 */
const WRITE_FLAG = "ATLAS_ERP_ALLOW_WRITE";
const CUSTOMER_ID = "ecom-order-smoke";

function requireEnvironment(name: "ATLAS_ERP_URL" | "ATLAS_ERP_CONNECT_TOKEN"): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

function requireWritePermission(): void {
  if (process.env[WRITE_FLAG] !== "1") {
    throw new Error(`refusing to write: set ${WRITE_FLAG}=1 to submit a manual sale`);
  }
}

async function main(): Promise<void> {
  requireWritePermission();

  const client = new AtlasErpClient({
    baseUrl: requireEnvironment("ATLAS_ERP_URL"),
    token: requireEnvironment("ATLAS_ERP_CONNECT_TOKEN"),
  });

  const [manifest, audit] = await Promise.all([client.manifest(), client.auditSnapshot()]);
  if (manifest.app_id !== "atlas-erp") {
    throw new Error(`Expected ERP app_id "atlas-erp", got "${manifest.app_id}"`);
  }
  const versionCheck = handshake({ connect_version: CONNECT_VERSION }, manifest);
  if (!versionCheck.accepted) {
    throw new Error(`ERP connect version check failed: ${versionCheck.reason ?? "unknown reason"}`);
  }

  const consumer = new ErpAuditConsumer();
  consumer.apply(audit);
  const catalog = new ConnectedCatalog(consumer);

  // One unit of the first item the peer published as stocked and priced.
  const item = catalog.list().find((entry) => entry.quantity > 0 && entry.price_cents > 0);
  if (item === undefined) {
    throw new Error("ERP published no available catalog item to sell");
  }

  const quantity = 1;
  const sale = await client.createManualSale({
    customerId: CUSTOMER_ID,
    saleId: `ecom-smoke-${randomUUID()}`,
    lines: [{ itemId: item.item_id, quantity, unitPriceCents: item.price_cents }],
  });

  // Read the peer's projection again and prove the write landed: a new
  // synchronization position, and exactly the submitted quantity less stock.
  const cursorBeforeSale = consumer.cursor;
  const cursorAdvanced = consumer.apply(await client.auditSnapshot());
  if (!cursorAdvanced) {
    throw new Error(
      `ERP audit cursor did not advance after the sale: still ${String(cursorBeforeSale)}`,
    );
  }
  const postOrderQuantity = catalog.getById(item.item_id)?.quantity;
  const expectedQuantity = item.quantity - quantity;
  if (postOrderQuantity !== expectedQuantity) {
    throw new Error(
      `Stock for "${item.item_id}" is ${String(postOrderQuantity)} after selling ${quantity}, expected ${expectedQuantity}`,
    );
  }

  console.log(
    JSON.stringify({
      ok: true,
      transport: "loopback-http",
      write: true,
      erp_app_id: manifest.app_id,
      connect_version: manifest.connect_version,
      audit_capability: audit.capability,
      audit_cursor: consumer.cursor,
      cursor_advanced: true,
      item_count: catalog.list().length,
      sold_item_id: item.item_id,
      post_order_quantity: postOrderQuantity,
      sale_id: sale.sale_id,
      journal_id: sale.journal_id,
      total_cents: sale.total_cents,
    }),
  );
}

try {
  await main();
} catch (error) {
  const detail = error instanceof Error ? error.message : "unknown error";
  console.error(`atlas-ecom connected order smoke failed: ${detail}`);
  process.exitCode = 1;
}
