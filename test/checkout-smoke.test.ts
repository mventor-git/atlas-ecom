import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SMOKE = fileURLToPath(new URL("../src/connected-checkout-smoke.ts", import.meta.url));
const ECOM_ENV = ["ATLAS_ERP_URL", "ATLAS_ERP_CONNECT_TOKEN", "ATLAS_ECOM_DATABASE_URL"];
const WRITE_FLAG = "ATLAS_ERP_ALLOW_WRITE";

/** Runs the checkout smoke with a clean environment and reports the outcome. */
async function runCheckoutSmoke(env: Record<string, string> = {}): Promise<{
  code: number;
  output: string;
}> {
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  for (const name of [...ECOM_ENV, WRITE_FLAG]) {
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

test("checkout smoke refuses to write unless ATLAS_ERP_ALLOW_WRITE=1", async () => {
  const refused = await runCheckoutSmoke();

  assert.equal(refused.code, 1);
  assert.match(refused.output, /refusing to write: set ATLAS_ERP_ALLOW_WRITE=1/);
  assert.doesNotMatch(refused.output, /is required/, "the write gate comes before any configuration");
});

test("checkout smoke requires the peer configuration and Ecom's own database", async () => {
  const opened = await runCheckoutSmoke({ [WRITE_FLAG]: "1" });

  assert.equal(opened.code, 1);
  assert.doesNotMatch(opened.output, /refusing to write/);
  assert.match(opened.output, /ATLAS_ERP_URL is required/);

  const noDatabase = await runCheckoutSmoke({
    [WRITE_FLAG]: "1",
    ATLAS_ERP_URL: "http://127.0.0.1:1",
    ATLAS_ERP_CONNECT_TOKEN: "checkout-smoke-test-token",
  });

  assert.equal(noDatabase.code, 1);
  assert.match(noDatabase.output, /ATLAS_ECOM_DATABASE_URL is required/);
  assert.doesNotMatch(
    noDatabase.output,
    /ECONNREFUSED/,
    "the configuration is read before a peer connection is opened",
  );
});
