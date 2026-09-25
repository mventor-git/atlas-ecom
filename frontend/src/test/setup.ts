import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

/**
 * Everything a test opens is closed here. jsdom keeps a `document.body` between
 * tests and a mock `fetch` between suites, so both are reset rather than left
 * for the next test to inherit.
 */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("style");
});

beforeEach(() => {
  // Radix's Select calls the pointer-capture API on open; jsdom implements the
  // events but not the methods, so the three calls it makes are stood in for.
  // Without this a selection throws inside a listener and the test still passes.
  for (const method of ["hasPointerCapture", "setPointerCapture", "releasePointerCapture"] as const) {
    if (typeof Element.prototype[method] !== "function") {
      Object.defineProperty(Element.prototype, method, { value: () => false, configurable: true });
    }
  }
  if (typeof Element.prototype.scrollIntoView !== "function") {
    Object.defineProperty(Element.prototype, "scrollIntoView", { value: () => {}, configurable: true });
  }

  // jsdom has no matchMedia; the theme falls back to light when it is missing,
  // so the default stub is a system that prefers light and can be changed.
  if (typeof window.matchMedia !== "function") {
    vi.stubGlobal(
      "matchMedia",
      (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    );
  }
});

/**
 * A fetch that answers the Ecom API routes from fixed payloads, so a component
 * test exercises the real client, the real zod parse, and the real render
 * without a listening server. `overrides` replaces one route's body; `statuses`
 * replaces one route's HTTP status. An override may be an array, in which case
 * each call takes the next entry and the last one repeats, which is how a test
 * says "the reload sees the catalogue after the write".
 */
export interface StubOptions {
  readonly routes: Readonly<Record<string, unknown>>;
  readonly overrides?: Readonly<Record<string, unknown | readonly unknown[]>>;
  readonly statuses?: Readonly<Record<string, number>>;
}

export interface FetchStub {
  readonly calls: { url: string; method: string; body: string | null }[];
  callsTo(path: string): { url: string; method: string; body: string | null }[];
}

export function stubApi({ routes, overrides = {}, statuses = {} }: StubOptions): FetchStub {
  const calls: { url: string; method: string; body: string | null }[] = [];
  const seen = new Map<string, number>();

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
      calls.push({ url, method, body: typeof init?.body === "string" ? init.body : null });

      const status = statuses[path] ?? 200;
      const override = overrides[path];
      const attempt = seen.get(path) ?? 0;
      seen.set(path, attempt + 1);
      const payload = Array.isArray(override)
        ? override[Math.min(attempt, override.length - 1)]
        : (override ?? routes[path]);

      if (payload === undefined) {
        return jsonResponse(404, { error: `Unknown route ${method} ${path}` });
      }
      return jsonResponse(status, payload);
    }),
  );

  return {
    calls,
    callsTo: (path) => calls.filter((call) => call.url.endsWith(path)),
  };
}

function jsonResponse(status: number, payload: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response;
}
