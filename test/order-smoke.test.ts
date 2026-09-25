import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SMOKE = fileURLToPath(new URL("../src/connected-order-smoke.ts", import.meta.url));
const ERP_ENV = ["ATLAS_ERP_URL", "ATLAS_ERP_CONNECT_TOKEN", "ATLAS_ERP_ALLOW_WRITE"];
const TOKEN = "order-smoke-test-token";
const ITEM = { item_id: "item-1", sku: "SKU-1", name: "Widget", price_cents: 1250 };
const STARTING_STOCK = 2;

/** Runs the order smoke with a clean ERP environment and reports the outcome. */
async function runOrderSmoke(env: Record<string, string> = {}): Promise<{
  code: number;
  output: string;
}> {
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  for (const name of ERP_ENV) {
    delete childEnv[name];
  }
  Object.assign(childEnv, env);

  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["--experimental-strip-types", SMOKE],
      { env: childEnv },
    );
    return { code: 0, output: `${stdout}${stderr}` };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? -1, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

interface FakeErpOptions {
  /** Keep the pre-sale cursor, as a peer that did not move would. */
  staleCursor?: boolean;
  /** Accept the sale but leave stock alone, as a lost write would. */
  keepStock?: boolean;
}

/** An in-process stand-in for the ERP loopback profile, on an ephemeral port. */
async function startFakeErp(options: FakeErpOptions = {}): Promise<{ url: string; close: () => void }> {
  let stock = STARTING_STOCK;
  let position = 0;

  const server = createServer((request, response) => {
    const send = (status: number, payload: unknown): void => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
    };
    if (request.method === "GET" && request.url === "/health") {
      return send(200, { app_id: "atlas-erp", status: "ok", connect_version: "1.0.0" });
    }
    if (request.headers.authorization !== `Bearer ${TOKEN}`) {
      return send(401, { error: "unauthorized" });
    }
    if (request.method === "GET" && request.url === "/connect/manifest") {
      return send(200, {
        app_id: "atlas-erp",
        connect_version: "1.0.0",
        capabilities: ["audit.snapshot", "sales.manual_sales"],
        permissions: ["audit.snapshot:read", "sales.manual_sales:write"],
      });
    }
    if (request.method === "GET" && request.url === "/connect/audit") {
      return send(200, {
        app_id: "atlas-erp",
        type: "snapshot",
        capability: "audit.snapshot",
        connect_version: "1.0.0",
        cursor: `cursor-${position}`,
        data: {
          items: [ITEM],
          stock: [{ item_id: ITEM.item_id, quantity: stock }],
          sales: [],
          journals: [],
          stock_movements: [],
        },
      });
    }
    if (request.method === "POST" && request.url === "/connect/sales") {
      let raw = "";
      request.on("data", (chunk: Buffer) => (raw += chunk));
      return request.on("end", () => {
        const body = JSON.parse(raw) as {
          sale_id: string;
          customer_id: string;
          lines: { item_id: string; quantity: number; unit_price_cents: number }[];
        };
        const line = body.lines[0];
        if (line.item_id !== ITEM.item_id || line.unit_price_cents !== ITEM.price_cents) {
          return send(409, { error: "sale does not match the catalog" });
        }
        if (stock < line.quantity) {
          return send(409, { error: "insufficient stock" });
        }
        if (!options.keepStock) {
          stock -= line.quantity;
        }
        if (!options.staleCursor) {
          position += 1;
        }
        const total = line.unit_price_cents * line.quantity;
        return send(201, {
          sale: {
            sale_id: body.sale_id,
            customer_id: body.customer_id,
            journal_id: `journal-${body.sale_id}`,
            total_cents: total,
            lines: [
              {
                item_id: line.item_id,
                quantity: line.quantity,
                unit_price_cents: line.unit_price_cents,
                total_cents: total,
              },
            ],
          },
        });
      });
    }
    return send(404, { error: "not found" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return { url: `http://127.0.0.1:${port}`, close: () => server.close() };
}

async function runAgainstFakeErp(options: FakeErpOptions): Promise<{ code: number; output: string }> {
  const erp = await startFakeErp(options);
  try {
    return await runOrderSmoke({
      ATLAS_ERP_URL: erp.url,
      ATLAS_ERP_CONNECT_TOKEN: TOKEN,
      ATLAS_ERP_ALLOW_WRITE: "1",
    });
  } finally {
    erp.close();
  }
}

function summary(output: string): Record<string, unknown> {
  const line = output.split("\n").find((entry) => entry.startsWith("{"));
  assert.ok(line !== undefined, `expected a JSON summary, got: ${output}`);
  return JSON.parse(line) as Record<string, unknown>;
}

test("order smoke refuses to write unless ATLAS_ERP_ALLOW_WRITE=1", async () => {
  const refused = await runOrderSmoke();

  assert.equal(refused.code, 1);
  assert.match(refused.output, /refusing to write: set ATLAS_ERP_ALLOW_WRITE=1/);
  assert.doesNotMatch(refused.output, /ATLAS_ERP_URL is required/, "the write gate comes first");
});

test("order smoke only proceeds past the gate with the explicit flag", async () => {
  const opened = await runOrderSmoke({ ATLAS_ERP_ALLOW_WRITE: "1" });

  assert.equal(opened.code, 1);
  assert.doesNotMatch(opened.output, /refusing to write/);
  assert.match(opened.output, /ATLAS_ERP_URL is required/);
});

test("order smoke confirms the cursor advanced and stock fell by the sold quantity", async () => {
  const result = await runAgainstFakeErp({});

  assert.equal(result.code, 0, result.output);
  const report = summary(result.output);
  assert.equal(report.ok, true);
  assert.equal(report.sold_item_id, ITEM.item_id);
  assert.equal(report.cursor_advanced, true);
  assert.equal(report.audit_cursor, "cursor-1", "the post-write snapshot must be a new position");
  assert.equal(report.post_order_quantity, STARTING_STOCK - 1);
  assert.equal(report.total_cents, ITEM.price_cents);
  assert.equal(result.output.includes(TOKEN), false, "the summary must not contain the token");
});

test("order smoke fails when the peer's cursor does not advance", async () => {
  const result = await runAgainstFakeErp({ staleCursor: true });

  assert.equal(result.code, 1);
  assert.match(result.output, /audit cursor did not advance after the sale: still cursor-0/);
});

test("order smoke fails when stock did not fall by the sold quantity", async () => {
  const result = await runAgainstFakeErp({ keepStock: true });

  assert.equal(result.code, 1);
  assert.match(
    result.output,
    /Stock for "item-1" is 2 after selling 1, expected 1/,
  );
});
