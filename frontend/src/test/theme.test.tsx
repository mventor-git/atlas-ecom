import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DARK_CLASS, resolveTheme, readStoredTheme, systemTheme, THEME_STORAGE_KEY, ThemeProvider, useTheme } from "@/lib/theme";

/** A `prefers-color-scheme` the test controls, since jsdom has none. */
function stubSystem(dark: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: dark,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    addListener: (listener: () => void) => listeners.add(listener),
    removeListener: (listener: () => void) => listeners.delete(listener),
    dispatchEvent: () => false,
  };
  vi.stubGlobal("matchMedia", vi.fn(() => query));
  return {
    change(next: boolean) {
      query.matches = next;
      for (const listener of listeners) listener();
    },
  };
}

function Probe() {
  const { theme, toggle } = useTheme();
  return (
    <button type="button" onClick={toggle}>
      mode:{theme}
    </button>
  );
}

function renderProbe() {
  return render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
}

describe("light and dark mode", () => {
  it("puts the dark class on <html> in dark and not in light", async () => {
    const user = userEvent.setup();
    stubSystem(false);
    renderProbe();

    expect(await screen.findByRole("button", { name: "mode:light" })).toBeInTheDocument();
    expect(document.documentElement).not.toHaveClass(DARK_CLASS);

    await user.click(screen.getByRole("button"));
    expect(document.documentElement).toHaveClass(DARK_CLASS);
    expect(document.documentElement.style.colorScheme).toBe("dark");

    await user.click(screen.getByRole("button"));
    expect(document.documentElement).not.toHaveClass(DARK_CLASS);
  });

  it("persists an explicit choice, so a reload keeps the mode", async () => {
    const user = userEvent.setup();
    stubSystem(false);
    renderProbe();

    await user.click(await screen.findByRole("button"));

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(readStoredTheme()).toBe("dark");
  });

  it("falls back to the system preference when nothing is stored", () => {
    stubSystem(true);
    expect(readStoredTheme()).toBeNull();
    expect(systemTheme()).toBe("dark");
    expect(resolveTheme(null)).toBe("dark");
  });

  it("follows a system change while no choice has been made", async () => {
    const system = stubSystem(false);
    renderProbe();
    expect(await screen.findByRole("button", { name: "mode:light" })).toBeInTheDocument();

    system.change(true);

    expect(await screen.findByRole("button", { name: "mode:dark" })).toBeInTheDocument();
    // Following the system is not a choice, so nothing is persisted.
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("treats an unrecognised stored value as no choice, not as an error", () => {
    stubSystem(true);
    window.localStorage.setItem(THEME_STORAGE_KEY, "chartreuse");

    expect(readStoredTheme()).toBeNull();
    expect(resolveTheme(readStoredTheme())).toBe("dark");
  });

  it("keeps a stored choice against the system preference", () => {
    const system = stubSystem(true);
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    renderProbe();

    // The stored light choice is the visitor's and does not move.
    system.change(false);
    expect(readStoredTheme()).toBe("light");
  });
});
