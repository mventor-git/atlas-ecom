import test from "node:test";
import assert from "node:assert/strict";
import {
  ECOM_CAPABILITIES,
  ECOM_CAPABILITY_PERMISSIONS,
  ProtocolKernel,
  createEcomRegistry,
  handshake,
} from "../src/index.ts";

function manifest() {
  return createEcomRegistry().manifest();
}

function peer(appId = "atlas-erp") {
  return { ...manifest(), app_id: appId };
}

function omit(source: object, field: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(source).filter(([key]) => key !== field));
}

function pairedKernel() {
  const kernel = new ProtocolKernel(manifest());
  const other = peer();
  assert.equal(kernel.pair(other).accepted, true);
  return { kernel, other };
}

test("standalone registry boots with the Ecom commerce hierarchy", () => {
  const result = manifest();

  assert.equal(result.app_id, "atlas-ecom");
  assert.equal(result.connect_version, "1.0.0");
  assert.deepEqual(
    [...result.capabilities].sort(),
    [...ECOM_CAPABILITIES].sort(),
  );
  for (const capability of ECOM_CAPABILITIES) {
    assert.ok(result.permissions.includes(`${capability}:read`));
    assert.ok(result.permissions.includes(`${capability}:write`));
  }
});

test("version handshake accepts the same major and rejects an incompatible major", () => {
  const local = manifest();
  const sameMajor = { ...local, app_id: "atlas-erp", connect_version: "1.8.0" };
  const incompatible = { ...local, app_id: "atlas-erp", connect_version: "2.0.0" };

  assert.deepEqual(handshake(local, sameMajor), { accepted: true });
  const result = handshake(local, incompatible);
  assert.equal(result.accepted, false);
  assert.match(result.reason ?? "", /Incompatible connect version/);
});

test("pair rejects malformed untrusted manifests without throwing", () => {
  const { kernel } = pairedKernel();
  const valid = manifest();
  const cases: Array<{ name: string; value: unknown; reason: RegExp }> = [
    { name: "missing app_id", value: omit(valid, "app_id"), reason: /app_id/ },
    { name: "blank app_id", value: { ...valid, app_id: "   " }, reason: /app_id/ },
    {
      name: "missing connect_version",
      value: omit(valid, "connect_version"),
      reason: /connect_version/,
    },
    {
      name: "blank connect_version",
      value: { ...valid, connect_version: "   " },
      reason: /connect_version/,
    },
    {
      name: "non-array capabilities",
      value: { ...valid, capabilities: "catalog" },
      reason: /capabilities.*array/,
    },
    {
      name: "non-array permissions",
      value: { ...valid, permissions: "catalog:read" },
      reason: /permissions.*array/,
    },
    {
      name: "blank capability",
      value: { ...valid, capabilities: ["catalog", "  "] },
      reason: /capabilities.*non-empty/,
    },
    {
      name: "blank permission",
      value: { ...valid, permissions: ["catalog:read", " "] },
      reason: /permissions.*non-empty/,
    },
    {
      name: "duplicate capabilities",
      value: { ...valid, capabilities: ["catalog", "catalog"] },
      reason: /capabilities.*duplicate/,
    },
    {
      name: "duplicate permissions",
      value: { ...valid, permissions: ["catalog:read", "catalog:read"] },
      reason: /permissions.*duplicate/,
    },
    {
      name: "non-string capability",
      value: { ...valid, capabilities: [42] },
      reason: /capabilities.*non-empty strings/,
    },
    { name: "null manifest", value: null, reason: /object/ },
  ];

  for (const testCase of cases) {
    const result = kernel.pair(testCase.value);
    assert.equal(result.accepted, false, testCase.name);
    assert.equal(result.mode, "share-only", testCase.name);
    assert.deepEqual(result.adopted_capabilities, [], testCase.name);
    assert.equal(result.moved_data, false, testCase.name);
    assert.match(result.reason ?? "", testCase.reason, testCase.name);
  }
});

test("authority allows one explicit master and rejects a second master", () => {
  const { kernel, other } = pairedKernel();
  const secondPeer = peer("another-peer");
  assert.equal(kernel.pair(secondPeer).accepted, true);

  kernel.setAuthority("catalog", other.app_id, "master");
  assert.equal(kernel.getAuthority("catalog", other.app_id), "master");
  assert.throws(
    () => kernel.setAuthority("catalog", secondPeer.app_id, "master"),
    /already has master/,
  );
  assert.equal(kernel.getAuthority("catalog", secondPeer.app_id), undefined);
});

test("pairing is share-only and does not adopt or move data", () => {
  const { kernel, other } = pairedKernel();
  const result = kernel.pair(other);

  assert.equal(result.accepted, true);
  assert.equal(result.mode, "share-only");
  assert.deepEqual(result.adopted_capabilities, []);
  assert.equal(result.moved_data, false);
  assert.equal(kernel.getAuthority("catalog", other.app_id), undefined);
});

test("snapshot and deltas retain order behind an opaque cursor", () => {
  const { kernel } = pairedKernel();
  const snapshot = kernel.snapshot("catalog", { products: [] });
  const first = kernel.appendDelta("catalog", { type: "upsert", id: "p1" }, "event-1");
  const second = kernel.appendDelta("catalog", { type: "upsert", id: "p2" }, "event-2");
  const deltas = kernel.deltasSince("catalog", snapshot.cursor);

  assert.equal(snapshot.type, "snapshot");
  assert.equal(typeof snapshot.cursor, "string");
  assert.notEqual(snapshot.cursor, first.cursor);
  assert.notEqual(first.cursor, second.cursor);
  assert.equal(first.previous_cursor, snapshot.cursor);
  assert.equal(second.previous_cursor, first.cursor);
  assert.deepEqual(deltas.map((delta) => delta.event_id), ["event-1", "event-2"]);
  assert.throws(() => kernel.deltasSince("catalog", "not-a-cursor"), /cursor/i);
});

test("inbox and event id make duplicate delivery idempotent", () => {
  const { kernel } = pairedKernel();
  const snapshot = kernel.snapshot("catalog", { products: [] });
  const event = kernel.appendDelta("catalog", { type: "upsert", id: "p1" }, "event-1");

  assert.equal(kernel.receiveDelta(event), true);
  assert.equal(kernel.receiveDelta(event), false);
  assert.equal(kernel.receiveDelta({ ...event, change: { id: "different" } }), false);
  assert.deepEqual(kernel.appendDelta("catalog", { id: "different" }, "event-1"), event);
  assert.equal(kernel.deltasSince("catalog", snapshot.cursor).length, 1);
});

test("proposals transition from pending to accepted or rejected with a reason", () => {
  const { kernel, other } = pairedKernel();
  const proposer = "commerce-operator";
  assert.equal(kernel.pair(peer(proposer)).accepted, true);
  kernel.setAuthority("orders", other.app_id, "master");
  kernel.setAuthority("orders", proposer, "proposer");

  const acceptedProposal = kernel.propose("orders", proposer, { total: 42 });
  assert.equal(acceptedProposal.status, "pending");
  const accepted = kernel.resolveProposal(
    acceptedProposal.id,
    "accepted",
    "validated",
    other.app_id,
  );
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.reason, "validated");
  assert.throws(
    () => kernel.resolveProposal(accepted.id, "rejected", "late", other.app_id),
    /Only pending proposals/,
  );

  const rejectedProposal = kernel.propose("orders", proposer, { total: 7 });
  const rejected = kernel.resolveProposal(
    rejectedProposal.id,
    "rejected",
    "not authorized",
    other.app_id,
  );
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.reason, "not authorized");
});

test("commerce permission seed contains all named capabilities", () => {
  assert.deepEqual(
    [...ECOM_CAPABILITY_PERMISSIONS.catalog],
    ["catalog:read", "catalog:write"],
  );
  assert.deepEqual(
    [...ECOM_CAPABILITY_PERMISSIONS.payment],
    ["payment:read", "payment:write"],
  );
});
