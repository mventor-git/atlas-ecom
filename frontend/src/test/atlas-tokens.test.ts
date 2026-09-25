import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The contract's acceptance gates are about colours resolving to named tokens,
 * and the only way that stays true is if the table is read back and the
 * components are searched for literals. Everything here works on the file the
 * build actually compiles, not on a restated copy of the stylesheet.
 */

const SRC = join(import.meta.dirname, "..");
const TOKEN_FILE = join(SRC, "styles", "atlas-tokens.css");
const css = readFileSync(TOKEN_FILE, "utf8");

/** contract.md v1.1.1, restated so a drift in either direction fails here. */
const CONTRACT: Record<"light" | "dark", Record<string, string>> = {
  light: {
    "--atlas-bg-canvas": "#f7f2eb",
    "--atlas-bg-surface": "#eae2d6",
    "--atlas-fg-default": "#2d0000",
    "--atlas-fg-muted": "#6a2f2f",
    "--atlas-accent": "#8b9a6e",
    "--atlas-on-accent": "#2d0000",
    "--atlas-link": "#2d0000",
    "--atlas-border-divider": "#eeeeee",
    "--atlas-border-control": "#757d6f",
    "--atlas-focus-ring": "#2d0000",
    "--atlas-warning-fg": "#2d0000",
    "--atlas-warning-bg": "#c8a96b",
    "--atlas-danger-fg": "#6d0808",
    "--atlas-danger-bg": "#ffdada",
    "--atlas-info-fg": "#2d0000",
    "--atlas-info-bg": "#fbe6c2",
    "--atlas-success-bg": "#c7d3c0",
    "--atlas-success-text": "#2d0000",
    "--atlas-success-indicator": "#2a7c13",
  },
  dark: {
    "--atlas-bg-canvas": "#41444b",
    "--atlas-bg-surface": "#52575d",
    "--atlas-fg-default": "#dfd8c8",
    "--atlas-fg-muted": "#b7b3a9",
    "--atlas-accent": "#cabfab",
    "--atlas-on-accent": "#41444b",
    "--atlas-link": "#dfd8c8",
    "--atlas-border-divider": "#52575d",
    "--atlas-border-control": "#9aa394",
    "--atlas-focus-ring": "#dfd8c8",
    "--atlas-warning-fg": "#2d0000",
    "--atlas-warning-bg": "#c8a96b",
    "--atlas-danger-fg": "#2d0000",
    "--atlas-danger-bg": "#ffdada",
    "--atlas-info-fg": "#2d0000",
    "--atlas-info-bg": "#fbe6c2",
    "--atlas-success-bg": "#c7d3c0",
    "--atlas-success-text": "#2d0000",
    "--atlas-success-indicator": "#2d0000",
  },
};

/** contract.md v1.2.0, the required shadcn-to-Atlas mapping, verbatim. */
const REQUIRED_MAPPING: Record<string, string> = {
  "--background": "var(--atlas-bg-canvas)",
  "--foreground": "var(--atlas-fg-default)",
  "--card": "var(--atlas-bg-surface)",
  "--primary": "var(--atlas-accent)",
  "--primary-foreground": "var(--atlas-on-accent)",
  "--muted-foreground": "var(--atlas-fg-muted)",
  "--border": "var(--atlas-border-divider)",
  "--input": "var(--atlas-border-control)",
  "--ring": "var(--atlas-focus-ring)",
  "--success": "var(--atlas-success-bg)",
  "--success-foreground": "var(--atlas-success-text)",
  "--warning": "var(--atlas-warning-bg)",
  "--warning-foreground": "var(--atlas-warning-fg)",
  "--danger": "var(--atlas-danger-bg)",
  "--danger-foreground": "var(--atlas-danger-fg)",
  "--info": "var(--atlas-info-bg)",
  "--info-foreground": "var(--atlas-info-fg)",
};

/** Every leaf custom-property block, keyed by its last selector. */
function leafBlocks(source: string): { selector: string; body: string }[] {
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: (match[1] ?? "").trim().split("\n").at(-1)?.trim() ?? "",
    body: match[2] ?? "",
  }));
}

function declarations(blocks: { selector: string; body: string }[], selector: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const block of blocks) {
    if (block.selector !== selector) continue;
    for (const [, name, value] of block.body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      if (name !== undefined && value !== undefined) found[name] = value.trim();
    }
  }
  return found;
}

const blocks = leafBlocks(css);
const light = declarations(blocks, ":root");
const dark = declarations(blocks, ".dark");

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const [red, green, blue] = channels.map((value) =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0);
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(full);
    return /\.(ts|tsx|css|html)$/.test(entry.name) ? [full] : [];
  });
}

/**
 * A comment is prose, not a declaration: the token file names `#2D0000` while
 * explaining why, and a component may cite a token in a comment too. Stripping
 * comments is what makes "no literal outside the table" mean a painted colour.
 */
function withoutComments(source: string): string {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/^\s*\/\/.*$/gm, "");
}

/** Six hex digits after a hash, or nothing. `#root` is an id, not a colour. */
const HEX_LITERAL = /#[0-9a-fA-F]{3,8}\b/g;
const COLOUR_FUNCTIONS = /\b(?:rgb|rgba|hsl|hsla|oklch|oklab)\(/g;
/** Tailwind's own palette, which is a colour the shared token table does not name. */
const TALWIND_PALETTE_UTILITY = /\b(?:bg|text|border|ring|fill|stroke|shadow|outline|decoration|accent|caret|divide)-(?:black|white|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-|\/|\b)/g;

describe("atlas token bridge", () => {
  it("declares the whole contract token table in both modes", () => {
    for (const mode of ["light", "dark"] as const) {
      for (const [name, value] of Object.entries(CONTRACT[mode])) {
        expect({ [name]: (mode === "light" ? light : dark)[name] }, `${mode} ${name}`).toEqual({ [name]: value });
      }
    }
  });

  it("maps each required shadcn variable to its shared token", () => {
    for (const [name, value] of Object.entries(REQUIRED_MAPPING)) {
      expect(light[name], name).toBe(value);
    }
  });

  it("writes only six-digit lowercase hex, so a lookalike character cannot slip in", () => {
    const literals = [...withoutComments(css).matchAll(HEX_LITERAL)].map((match) => match[0]);
    expect(literals.length).toBeGreaterThan(0);
    for (const literal of literals) {
      expect(literal, `"${literal}" is not a six-digit lowercase hex colour`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("contains no colour literal anywhere else in the frontend", () => {
    // index.html sets a mode, not a colour; a value there would be a second palette.
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      if (file === TOKEN_FILE) continue;
      if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
      const text = withoutComments(readFileSync(file, "utf8"));
      for (const match of text.matchAll(HEX_LITERAL)) {
        offenders.push(`${file.slice(SRC.length + 1)}: ${match[0]}`);
      }
      for (const match of text.matchAll(COLOUR_FUNCTIONS)) {
        offenders.push(`${file.slice(SRC.length + 1)}: ${match[0]}`);
      }
      // A Tailwind palette utility is a colour just as much as a hex literal, and
      // the generated Sheet scrim shipped as one. A hex-only check would have
      // passed that. The class is deliberately not named here either: Tailwind
      // scans every source file, so writing it down would put it back in the build.
      for (const match of text.matchAll(TALWIND_PALETTE_UTILITY)) {
        offenders.push(`${file.slice(SRC.length + 1)}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps every painted text pair at AA in both modes", () => {
    const pairs: [string, string, string][] = [
      ["fg.default on bg.canvas", "--atlas-fg-default", "--atlas-bg-canvas"],
      ["fg.default on bg.surface", "--atlas-fg-default", "--atlas-bg-surface"],
      ["fg.muted on bg.canvas", "--atlas-fg-muted", "--atlas-bg-canvas"],
      ["onAccent.default on accent.default", "--atlas-on-accent", "--atlas-accent"],
      ["state.success.text on its background", "--atlas-success-text", "--atlas-success-bg"],
      ["state.warning on its background", "--atlas-warning-fg", "--atlas-warning-bg"],
      ["state.danger on its background", "--atlas-danger-fg", "--atlas-danger-bg"],
      ["state.info on its background", "--atlas-info-fg", "--atlas-info-bg"],
    ];
    for (const mode of ["light", "dark"] as const) {
      const tokens = CONTRACT[mode];
      for (const [label, foreground, background] of pairs) {
        const ratio = contrast(String(tokens[foreground]), String(tokens[background]));
        expect(ratio, `${mode}: ${label} measures ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps the canvas-safe control border at 3:1 where border.control is painted", () => {
    // The derivation the treatment relies on: a control paints the canvas, so
    // only the canvas figure has to clear 3:1. These two are the measured ones.
    const onCanvas = { light: 3.83, dark: 3.73 } as const;
    // Dark mode on a surface is 2.79:1, which is the shortfall the treatment
    // exists for. If a future token edit closes that gap, this stops being why
    // the treatment is needed and the comment has to be revisited.
    const onSurface = { light: 3.32, dark: 2.79 } as const;

    for (const mode of ["light", "dark"] as const) {
      const tokens = CONTRACT[mode];
      const canvasRatio = contrast(String(tokens["--atlas-border-control"]), String(tokens["--atlas-bg-canvas"]));
      const surfaceRatio = contrast(String(tokens["--atlas-border-control"]), String(tokens["--atlas-bg-surface"]));

      expect(canvasRatio.toFixed(2), `${mode} control on canvas`).toBe(onCanvas[mode].toString());
      expect(canvasRatio, `${mode} border.control on bg.canvas must clear 3:1`).toBeGreaterThanOrEqual(3);
      expect(surfaceRatio.toFixed(2), `${mode} control on surface`).toBe(onSurface[mode].toString());
      // The repaint rules below are what keep muted text and control borders off
      // a surface; removing them would put a measured shortfall in front of a user.
      expect(css, `${mode}: the surface repaint must exist`).toContain(".on-surface");
    }
  });

  it("keeps the muted-on-surface repaint and the state-note escape hatch", () => {
    expect(css).toContain(".on-surface .text-muted-foreground {");
    expect(css).toContain("color: var(--foreground);");
    expect(css).toContain(".on-surface .text-muted-foreground.state-note {");
    expect(css).toContain('.on-surface [data-slot="input"]');
  });

  it("drives the dark mode from the one class the index.html script sets", () => {
    const html = readFileSync(join(SRC, "..", "index.html"), "utf8");
    expect(html).toContain('classList.toggle("dark"');
    expect(html).toContain("prefers-color-scheme: dark");
    expect(css).toContain('@custom-variant dark (&:is(.dark *));');
  });
});
