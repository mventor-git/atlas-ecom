import { describe, expect, it } from "vitest";
import config from "../../vite.config";

/**
 * The two assumptions the whole frontend rests on are in the Vite config, and
 * nothing else in the suite can see them: the `@` alias every import resolves
 * through, and the `/api` proxy that makes the Node API the only data source.
 * A dev server is deliberately not started to check them.
 */
describe("vite config", () => {
  it("resolves the @ alias to src, which is what every import in the app uses", () => {
    const alias = config.resolve?.alias as Record<string, string>;
    expect(alias["@"].replace(/\\/g, "/")).toMatch(/\/src$/);
  });

  it("proxies /api to the loopback Node API on 4312 by default", () => {
    const server = config.server?.proxy as Record<string, { target: string }>;
    expect(server["/api"]?.target).toBe("http://127.0.0.1:4312");
  });

  it("proxies the preview server the same way, so a built bundle still reads the API", () => {
    const preview = config.preview?.proxy as Record<string, { target: string }>;
    expect(preview["/api"]?.target).toBe("http://127.0.0.1:4312");
  });
});
