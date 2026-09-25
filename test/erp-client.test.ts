import test from "node:test";
import assert from "node:assert/strict";
import { AtlasErpClient } from "../src/index.ts";

const manifestPayload = {
  app_id: "atlas-erp",
  connect_version: "1.0.0",
  capabilities: ["audit"],
  permissions: ["audit:read"],
};

const auditData = {
  items: [{ item_id: "item-1", sku: "SKU-1", name: "Widget", price_cents: 1250 }],
  stock: [{ item_id: "item-1", quantity: 4 }],
  sales: [
    {
      sale_id: "sale-1",
      customer_id: "customer-1",
      journal_id: "journal-sale-1",
      total_cents: 1250,
      lines: [{ item_id: "item-1", quantity: 1, unit_price_cents: 1250, total_cents: 1250 }],
    },
  ],
  journals: [
    {
      journal_id: "journal-sale-1",
      sale_id: "sale-1",
      total_debits_cents: 1250,
      total_credits_cents: 1250,
      lines: [
        { account_code: "cash", debit_cents: 1250, credit_cents: 0 },
        { account_code: "revenue", debit_cents: 0, credit_cents: 1250 },
      ],
    },
  ],
  stock_movements: [
    {
      movement_id: "sale:sale-1:0",
      item_id: "item-1",
      quantity_delta: -1,
      reason: "sale",
      reference_id: "sale-1",
    },
  ],
};

const auditPayload = {
  app_id: "atlas-erp",
  type: "snapshot",
  capability: "audit.snapshot",
  connect_version: "1.0.0",
  cursor: "cursor-1",
  data: auditData,
};

const salePayload = auditData.sales[0];

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("ERP client leaves health unauthenticated and bearer-authenticates connect reads", async () => {
  const calls: Array<{ path: string; authorization: string | null; bounded: boolean }> = [];
  const fakeFetch: typeof globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    calls.push({
      path,
      authorization: new Headers(init?.headers).get("authorization"),
      bounded: init?.signal instanceof AbortSignal,
    });

    if (path === "/health") return jsonResponse({ status: "ok" });
    if (path === "/connect/manifest") return jsonResponse(manifestPayload);
    if (path === "/connect/audit") return jsonResponse(auditPayload);
    return new Response(null, { status: 404 });
  };
  const client = new AtlasErpClient({
    baseUrl: "http://127.0.0.1:4310",
    token: "test-token",
    fetch: fakeFetch,
  });

  const [health, manifest, audit] = await Promise.all([
    client.health(),
    client.manifest(),
    client.auditSnapshot(),
  ]);

  assert.deepEqual(health, { status: "ok" });
  assert.deepEqual(manifest, manifestPayload);
  assert.deepEqual(audit, auditPayload);
  assert.equal(audit.data.items[0]?.price_cents, 1250);
  assert.equal(audit.data.stock[0]?.quantity, 4);
  assert.equal(audit.data.sales[0]?.lines[0]?.unit_price_cents, 1250);
  assert.equal(audit.data.journals[0]?.lines[1]?.credit_cents, 1250);
  assert.equal(audit.data.stock_movements[0]?.quantity_delta, -1);
  assert.deepEqual(
    calls.map(({ path }) => path),
    ["/health", "/connect/manifest", "/connect/audit"],
  );
  assert.equal(calls[0]?.authorization, null);
  assert.equal(calls[1]?.authorization, "Bearer test-token");
  assert.equal(calls[2]?.authorization, "Bearer test-token");
  assert.ok(calls.every(({ bounded }) => bounded));
});

test("ERP client reports HTTP errors without including the token", async () => {
  const token = "secret-http-error-token";
  const fakeFetch: typeof globalThis.fetch = async () =>
    jsonResponse({ error: "unauthorized" }, 401);
  const client = new AtlasErpClient({
    baseUrl: "http://127.0.0.1:4310",
    token,
    fetch: fakeFetch,
  });

  await assert.rejects(client.manifest(), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /GET \/connect\/manifest failed: HTTP 401/);
    assert.equal(error.message.includes(token), false);
    return true;
  });
});

test("ERP client validates manifest and audit transport shapes", async () => {
  const cases: Array<{
    name: string;
    call: (client: AtlasErpClient) => Promise<unknown>;
    payload: unknown;
    reason: RegExp;
  }> = [
    {
      name: "manifest app_id",
      call: (client) => client.manifest(),
      payload: { ...manifestPayload, app_id: " " },
      reason: /app_id/,
    },
    {
      name: "manifest connect_version",
      call: (client) => client.manifest(),
      payload: { ...manifestPayload, connect_version: "" },
      reason: /connect_version/,
    },
    {
      name: "manifest capabilities",
      call: (client) => client.manifest(),
      payload: { ...manifestPayload, capabilities: "audit" },
      reason: /capabilities.*array/,
    },
    {
      name: "manifest permissions",
      call: (client) => client.manifest(),
      payload: { ...manifestPayload, permissions: "audit:read" },
      reason: /permissions.*array/,
    },
    {
      name: "audit type",
      call: (client) => client.auditSnapshot(),
      payload: { ...auditPayload, type: "delta" },
      reason: /type.*snapshot/,
    },
    {
      name: "audit app_id",
      call: (client) => client.auditSnapshot(),
      payload: { ...auditPayload, app_id: "" },
      reason: /app_id/,
    },
    {
      name: "audit connect_version",
      call: (client) => client.auditSnapshot(),
      payload: { ...auditPayload, connect_version: "  " },
      reason: /connect_version/,
    },
    {
      name: "audit capability",
      call: (client) => client.auditSnapshot(),
      payload: { ...auditPayload, capability: "" },
      reason: /capability/,
    },
    {
      name: "audit cursor",
      call: (client) => client.auditSnapshot(),
      payload: { ...auditPayload, cursor: "" },
      reason: /cursor/,
    },
    {
      name: "audit stock",
      call: (client) => client.auditSnapshot(),
      payload: { ...auditPayload, data: { ...auditData, stock: {} } },
      reason: /data\.stock.*array/,
    },
    {
      name: "audit items",
      call: (client) => client.auditSnapshot(),
      payload: { ...auditPayload, data: { ...auditData, items: "none" } },
      reason: /data\.items.*array/,
    },
    {
      name: "audit sales",
      call: (client) => client.auditSnapshot(),
      payload: { ...auditPayload, data: { ...auditData, sales: null } },
      reason: /data\.sales.*array/,
    },
    {
      name: "audit journals",
      call: (client) => client.auditSnapshot(),
      payload: { ...auditPayload, data: { ...auditData, journals: 1 } },
      reason: /data\.journals.*array/,
    },
    {
      name: "audit stock_movements",
      call: (client) => client.auditSnapshot(),
      payload: { ...auditPayload, data: { ...auditData, stock_movements: {} } },
      reason: /data\.stock_movements.*array/,
    },
  ];

  for (const testCase of cases) {
    const client = new AtlasErpClient({
      baseUrl: "http://127.0.0.1:4310",
      token: "test-token",
      fetch: async () => jsonResponse(testCase.payload),
    });
    await assert.rejects(testCase.call(client), testCase.reason, testCase.name);
  }
});

test("ERP client rejects audit records that are not typed records", async () => {
  const cases: Array<{ name: string; data: unknown; reason: RegExp }> = [
    {
      name: "item record is not an object",
      data: { ...auditData, items: ["item-1"] },
      reason: /data\.items\[0\] must be an object/,
    },
    {
      name: "item price is not an integer",
      data: { ...auditData, items: [{ ...auditData.items[0], price_cents: 12.5 }] },
      reason: /items\[0\]\.price_cents must be an integer/,
    },
    {
      name: "item sku is blank",
      data: { ...auditData, items: [{ ...auditData.items[0], sku: " " }] },
      reason: /items\[0\]\.sku must be a non-empty string/,
    },
    {
      name: "stock quantity is not an integer",
      data: { ...auditData, stock: [{ item_id: "item-1", quantity: -1.5 }] },
      reason: /stock\[0\]\.quantity must be an integer of at least 0/,
    },
    {
      name: "sale line quantity is not positive",
      data: {
        ...auditData,
        sales: [{ ...auditData.sales[0], lines: [{ ...auditData.sales[0]?.lines[0], quantity: 0 }] }],
      },
      reason: /sales\[0\]\.lines\[0\]\.quantity must be an integer of at least 1/,
    },
    {
      name: "journal credit is negative",
      data: {
        ...auditData,
        journals: [
          {
            ...auditData.journals[0],
            lines: [{ account_code: "revenue", debit_cents: 0, credit_cents: -1250 }],
          },
        ],
      },
      reason: /journals\[0\]\.lines\[0\]\.credit_cents must be an integer of at least 0/,
    },
    {
      name: "stock movement delta is zero",
      data: {
        ...auditData,
        stock_movements: [{ ...auditData.stock_movements[0], quantity_delta: 0 }],
      },
      reason: /stock_movements\[0\]\.quantity_delta must be a non-zero integer/,
    },
  ];

  for (const testCase of cases) {
    const client = new AtlasErpClient({
      baseUrl: "http://127.0.0.1:4310",
      token: "test-token",
      fetch: async () =>
        jsonResponse({ ...auditPayload, data: testCase.data }),
    });
    await assert.rejects(client.auditSnapshot(), testCase.reason, testCase.name);
  }
});

test("ERP client reports malformed JSON with the failed endpoint", async () => {
  const client = new AtlasErpClient({
    baseUrl: "http://127.0.0.1:4310",
    token: "test-token",
    fetch: async () =>
      new Response("{", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });

  await assert.rejects(client.auditSnapshot(), /GET \/connect\/audit.*invalid JSON/i);
});

test("ERP client adds endpoint context to network failures", async () => {
  const client = new AtlasErpClient({
    baseUrl: "http://127.0.0.1:4310",
    token: "test-token",
    fetch: async () => {
      throw new TypeError("connect ECONNREFUSED 127.0.0.1:4310");
    },
  });

  await assert.rejects(
    client.health(),
    /GET \/health.*connect ECONNREFUSED 127\.0\.0\.1:4310/,
  );
});

test("createManualSale posts one authenticated JSON sale and returns the typed record", async () => {
  const calls: Array<{ method: string; path: string; init: RequestInit | undefined }> = [];
  const fakeFetch: typeof globalThis.fetch = async (input, init) => {
    calls.push({
      method: init?.method ?? "GET",
      path: new URL(String(input)).pathname,
      init,
    });
    return jsonResponse({ sale: salePayload }, 201);
  };
  const client = new AtlasErpClient({
    baseUrl: "http://127.0.0.1:4310",
    token: "test-token",
    fetch: fakeFetch,
  });

  const sale = await client.createManualSale({
    customerId: "customer-1",
    saleId: "sale-2",
    lines: [{ itemId: "item-1", quantity: 2, unitPriceCents: 1250 }],
  });

  assert.deepEqual(sale, salePayload);
  assert.equal(calls.length, 1, "a manual sale must be sent exactly once");
  const call = calls[0];
  assert.equal(call?.method, "POST");
  assert.equal(call?.path, "/connect/sales");
  const headers = new Headers(call?.init?.headers);
  assert.equal(headers.get("authorization"), "Bearer test-token");
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(headers.get("accept"), "application/json");
  assert.equal(call?.init?.signal instanceof AbortSignal, true);
  assert.deepEqual(JSON.parse(String(call?.init?.body)), {
    customer_id: "customer-1",
    sale_id: "sale-2",
    lines: [{ item_id: "item-1", quantity: 2, unit_price_cents: 1250 }],
  });
});

test("createManualSale reports HTTP errors without retrying or leaking the token", async () => {
  const token = "secret-sale-error-token";
  let calls = 0;
  const client = new AtlasErpClient({
    baseUrl: "http://127.0.0.1:4310",
    token,
    fetch: async () => {
      calls += 1;
      return jsonResponse({ error: "price does not match catalog" }, 409);
    },
  });

  await assert.rejects(
    client.createManualSale({
      customerId: "customer-1",
      saleId: "sale-2",
      lines: [{ itemId: "item-1", quantity: 1, unitPriceCents: 1 }],
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /POST \/connect\/sales failed: HTTP 409/);
      assert.equal(error.message.includes(token), false);
      return true;
    },
  );
  assert.equal(calls, 1, "a rejected write must not be retried");
});

test("createManualSale validates the request before any network call", async () => {
  let calls = 0;
  const client = new AtlasErpClient({
    baseUrl: "http://127.0.0.1:4310",
    token: "test-token",
    fetch: async () => {
      calls += 1;
      return jsonResponse({ sale: salePayload }, 201);
    },
  });

  const cases: Array<{ name: string; request: Parameters<AtlasErpClient["createManualSale"]>[0]; reason: RegExp }> = [
    {
      name: "blank customer id",
      request: { customerId: " ", saleId: "sale-2", lines: [{ itemId: "item-1", quantity: 1, unitPriceCents: 1250 }] },
      reason: /customerId must be a non-empty string/,
    },
    {
      name: "no lines",
      request: { customerId: "customer-1", saleId: "sale-2", lines: [] },
      reason: /at least one line/,
    },
    {
      name: "zero quantity",
      request: { customerId: "customer-1", saleId: "sale-2", lines: [{ itemId: "item-1", quantity: 0, unitPriceCents: 1250 }] },
      reason: /lines\[0\]\.quantity must be an integer of at least 1/,
    },
    {
      name: "zero price",
      request: { customerId: "customer-1", saleId: "sale-2", lines: [{ itemId: "item-1", quantity: 1, unitPriceCents: 0 }] },
      reason: /lines\[0\]\.unitPriceCents must be an integer of at least 1/,
    },
    {
      name: "oversized body",
      request: {
        customerId: "customer-1",
        saleId: "sale-2",
        lines: Array.from({ length: 400 }, () => ({
          itemId: "x".repeat(64),
          quantity: 1,
          unitPriceCents: 1250,
        })),
      },
      reason: /body exceeds 8192 bytes/,
    },
  ];

  for (const testCase of cases) {
    await assert.rejects(client.createManualSale(testCase.request), testCase.reason, testCase.name);
  }
  assert.equal(calls, 0, "an invalid sale must never reach the transport");
});

test("createManualSale validates the response it was given", async () => {
  const cases: Array<{ name: string; payload: unknown; reason: RegExp }> = [
    {
      name: "missing total",
      payload: { ...salePayload, total_cents: "1250" },
      reason: /manual sale\.total_cents must be an integer/,
    },
    {
      name: "missing line price",
      payload: { ...salePayload, lines: [{ ...salePayload.lines[0], unit_price_cents: 12.5 }] },
      reason: /manual sale\.lines\[0\]\.unit_price_cents must be an integer/,
    },
  ];

  for (const testCase of cases) {
    const client = new AtlasErpClient({
      baseUrl: "http://127.0.0.1:4310",
      token: "test-token",
      fetch: async () => jsonResponse({ sale: testCase.payload }, 201),
    });
    await assert.rejects(
      client.createManualSale({
        customerId: "customer-1",
        saleId: "sale-2",
        lines: [{ itemId: "item-1", quantity: 1, unitPriceCents: 1250 }],
      }),
      testCase.reason,
      testCase.name,
    );
  }
});
