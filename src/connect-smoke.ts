import { AtlasErpClient } from "./erp-client.ts";
import { ConnectedCatalog, ErpAuditConsumer } from "./erp-consumer.ts";
import { CONNECT_VERSION, handshake } from "./protocol.ts";

function requireEnvironment(name: "ATLAS_ERP_URL" | "ATLAS_ERP_CONNECT_TOKEN"): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

const client = new AtlasErpClient({
  baseUrl: requireEnvironment("ATLAS_ERP_URL"),
  token: requireEnvironment("ATLAS_ERP_CONNECT_TOKEN"),
});

const [health, manifest, audit] = await Promise.all([
  client.health(),
  client.manifest(),
  client.auditSnapshot(),
]);

if (manifest.app_id !== "atlas-erp") {
  throw new Error(`Expected ERP app_id "atlas-erp", got "${manifest.app_id}"`);
}
const versionCheck = handshake({ connect_version: CONNECT_VERSION }, manifest);
if (!versionCheck.accepted) {
  throw new Error(`ERP connect version check failed: ${versionCheck.reason ?? "unknown reason"}`);
}

// Read-only: the snapshot becomes local process state and is never written back.
const consumer = new ErpAuditConsumer();
consumer.apply(audit);
const catalog = new ConnectedCatalog(consumer);

console.log(
  JSON.stringify({
    ok: true,
    transport: "loopback-http",
    read_only: true,
    health: typeof health.status === "string" ? health.status : "reachable",
    erp_app_id: manifest.app_id,
    connect_version: manifest.connect_version,
    capability_count: manifest.capabilities.length,
    audit_capability: audit.capability,
    audit_cursor: consumer.cursor,
    item_count: catalog.list().length,
    stock_count: consumer.listStock().length,
  }),
);
