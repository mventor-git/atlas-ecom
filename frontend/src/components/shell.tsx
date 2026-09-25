import { MoonIcon, SunIcon } from "lucide-react";
import { NavLink } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * The one control that changes the mode. The choice is the visitor's and is
 * persisted, so it survives a reload and a walk between the two surfaces; with
 * no choice stored, the system preference decides.
 */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <Button variant="secondary" size="sm" onClick={toggle} aria-pressed={theme === "dark"}>
      {theme === "dark" ? <SunIcon aria-hidden /> : <MoonIcon aria-hidden />}
      {theme === "dark" ? "Light mode" : "Dark mode"}
    </Button>
  );
}

/**
 * Both surfaces share this shell so a page moved between them keeps its
 * appearance, which is the point of a shared token table.
 */
export function AppShell({
  surface,
  children,
  aside,
}: {
  surface: "storefront" | "ecom-manager";
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-4 px-4 pb-10">
      <header className="flex flex-wrap items-center justify-between gap-3 pt-6">
        <div>
          <h1 className="font-heading text-xl font-medium">
            {surface === "storefront" ? "Atlas Ecom" : "ecom-manager"}
          </h1>
          <p className="text-sm text-muted-foreground">{surface}</p>
        </div>
        <div className="flex items-center gap-2">
          {aside}
          <ThemeToggle />
          <NavLink
            to={surface === "storefront" ? "/manager" : "/"}
            className={({ isActive }) => cn("text-sm", isActive && "font-medium")}
          >
            {surface === "storefront" ? "ecom-manager" : "Storefront"}
          </NavLink>
        </div>
      </header>
      {children}
      <footer className="mt-auto border-t pt-3 text-sm text-muted-foreground">
        <p>
          The catalogue, cart and orders all come from the Ecom Node API over <code>/api</code>. That API is
          in memory and process-local: stopping it loses the cart, the orders and anything an operator added.
        </p>
      </footer>
    </div>
  );
}

/** `state.info`: a fact about the limits of the slice, not an error. */
export function Notice({
  tone = "info",
  role = "note",
  children,
}: {
  tone?: "info" | "success" | "warning" | "danger";
  role?: "note" | "status" | "alert";
  children: React.ReactNode;
}) {
  return (
    <p
      role={role}
      className={cn(
        "state-note rounded-md border border-input px-3 py-2 text-sm",
        tone === "info" && "bg-info text-info-foreground",
        tone === "success" && "bg-success text-success-foreground",
        tone === "warning" && "bg-warning text-warning-foreground",
        tone === "danger" && "bg-danger text-danger-foreground",
      )}
    >
      {children}
    </p>
  );
}

/**
 * `state.success` is a pair, and the contract reserves the supplied `#2A7C13`
 * for the non-text indicator: it sits beside the accessible ink, never as the
 * text itself, so the note reads at AA without relying on the marker.
 */
export function SuccessNotice({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="state-note bg-success text-success-foreground rounded-md border border-input px-3 py-2 text-sm">
      <span
        aria-hidden
        className="mr-2 inline-block size-2 rounded-full bg-success-indicator align-middle"
      />
      {children}
    </p>
  );
}
