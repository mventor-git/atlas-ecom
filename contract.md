# Atlas Ecom Contract

## Metadata

- Product: Atlas Ecom
- Contract version: 1.2.0
- Status: ACTIVE
- Date: 2026-09-25
- Approval date: 2026-09-25

## Vision

Atlas Ecom is a standalone commerce application with a customer-facing
storefront and an `ecom-manager` for operating the commerce business. It is
useful without Atlas ERP, while optionally consuming approved capabilities and
presentation from connected peers.

## Goals

- Provide a standalone storefront and `ecom-manager`.
- Host Ecom's own plugins and modules.
- Consume shared capabilities from a connected peer when explicitly granted.
- Consume presentation supplied by a connected peer for the storefront.
- Keep commerce ownership and ERP authority distinct and visible.

## Non-goals

- Requires no ERP.
- Provides no general ledger, inventory, or purchasing capability.
- Does not automatically migrate or adopt data on connect.
- Does not load or execute ERP code, and does not hot-load ERP modules.

## Users

- Storefront customers who browse products and complete purchases.
- Commerce operators who manage catalog, orders, and storefront operations in
  `ecom-manager`.
- Administrators who configure clusters, plugins, modules, and permissions.
- Integrators who consume approved capabilities without taking ownership of
  another product's data.

## Architecture

The product hierarchy is:

`core -> cluster -> plugin -> module`

The intended implementation is TypeScript/Node, but no implementation is
included in this first version.

Atlas Ecom adds two frontends: a storefront and `ecom-manager`. It owns its
PostgreSQL database, named `atlas_ecom`, and embeds the vendored
`connect/SPEC.md`. The storefront, cart, checkout, and payment capabilities
are Ecom-only. Atlas Connect is additive and is never a required runtime
dependency.

Connect is share-only by default. Adoption or import of data owned by another
application is a separate, explicit operation.

## Design tokens

Presentation uses a shared Atlas UI token set, exposed as named tokens or CSS
variables. The token names and values are the same on every Atlas product
surface, so a surface moved between products keeps its appearance. The table
below is the single shared reference: one name, one meaning, one value per
mode, in both products.

| Token | Role | Light | Dark |
| --- | --- | --- | --- |
| `bg.canvas` | Page background | `#F7F2EB` | `#41444B` |
| `bg.surface` | Card/surface | `#EAE2D6` | `#52575D` |
| `fg.default` | Body text | `#2D0000` | `#DFD8C8` |
| `fg.muted` | Muted text | `#6A2F2F` (derived) | `#B7B3A9` (derived) |
| `accent.default` | Accent | `#8B9A6E` | `#CABFAB` |
| `link.default` | Link | `#2D0000` + underline | `#DFD8C8` + underline |
| `border.divider` | Divider | `#EEEEEE` | `#52575D` |
| `border.control` | Control border | `#757D6F` | `#9AA394` (derived) |
| `onAccent.default` | Text on accent | `#2D0000` | `#41444B` |
| `focus.ring` | Focus ring | `#2D0000` | `#DFD8C8` |
| `state.success` | Success | `#2A7C13` on `#C7D3C0` | `#2D0000` on `#C7D3C0` |
| `state.warning` | Warning | `#2D0000` on `#C8A96B` | `#2D0000` on `#C8A96B` |
| `state.danger` | Danger | `#6D0808` on `#FFDADA` | `#2D0000` on `#FFDADA` |
| `state.info` | Info | `#2D0000` on `#FBE6C2` | `#2D0000` on `#FBE6C2` |

### Token mapping

- `accent.default` is an accent and is never body text on `bg.canvas`; body
  text is `fg.default` only.
- `link.default` carries an underline and does not rely on color alone.
- `border.divider` is decorative and low-contrast by design; it separates
  content and is never a text color.
- `focus.ring` must stay visible on the surface it is drawn on, and is
  applied to every keyboard-focusable control.
- Each `state.*` token is a foreground-on-background pair and is used as
  supplied.
- Tokens are overridable, and overriding one must not change what any value
  means to the data.

### Component foundation

shadcn/ui (Radix/Base UI + Tailwind) is the preferred component foundation
because it consumes CSS variables and preserves markup ownership; it is
replaceable and the token contract is authoritative.

### Contrast

- The target is WCAG AA in both light and dark mode.
- Three values are derived rather than supplied, and are the ones the contrast
  check returned: light `fg.muted` `#6A2F2F` (9.15:1 on `#F7F2EB`), dark
  `fg.muted` `#B7B3A9` (4.66:1 on `#41444B`), and dark `border.control`
  `#9AA394` (3.73:1 on `#41444B`). Every other value is as supplied.
- Caveat: the light `state.success` pair `#2A7C13` on `#C7D3C0` measures
  3.38:1. It is preserved as supplied and is for non-text and large-text use
  only; for normal text on that background, pair it with `#2D0000` instead.

## UI implementation direction

The approved frontend direction for the storefront and `ecom-manager` is
React 19 + TypeScript + Vite + Tailwind CSS v4 + shadcn/ui on Radix UI
primitives. shadcn components are copied into this product's source tree and
owned here, not consumed as a shared runtime package, so a product never
depends on another product's components to build.

- The storefront and the `ecom-manager` are separate frontend builds, each with
  its own dependencies and build output. The existing Node API and its routes
  are unchanged, `atlas_ecom` keeps sole ownership of its database, and both
  frontends read that API as their only data source.
- The v1.1.1 token table above remains the semantic authority. shadcn and
  Tailwind variables are a derived mapping onto that table, not a second source
  of colour truth, and no component file contains a raw hex value.
- The required mapping is fixed, so the two products stay visually identical on
  shared surfaces:

| shadcn / Tailwind variable | Shared token |
| --- | --- |
| `--background` | `--atlas-bg-canvas` (`bg.canvas`) |
| `--foreground` | `--atlas-fg-default` (`fg.default`) |
| `--card` | `--atlas-bg-surface` (`bg.surface`) |
| `--primary` | `--atlas-accent` (`accent.default`) |
| `--primary-foreground` | `--atlas-on-accent` (`onAccent.default`) |
| `--muted-foreground` | `--atlas-fg-muted` (`fg.muted`), canvas use only |
| `--border` | `--atlas-border-divider` (`border.divider`) |
| `--input` | `--atlas-border-control` (`border.control`) |
| `--ring` | `--atlas-focus-ring` (`focus.ring`) |

- The four shadcn state variables (`--success`, `--warning`, `--danger`,
  `--info`) resolve to the `state.*` token pairs above, as a foreground on a
  background. Within `state.success`, `state.success.text` uses the accessible
  ink `#2D0000` in both modes, because the supplied light foreground `#2A7C13`
  on `#C7D3C0` is 3.38:1 and is not a normal-text pair, and
  `state.success.indicator` is the non-text marker carrying the supplied
  foreground.
- Light and dark mode, `:focus-visible` behavior driven by `focus.ring`,
  keyboard operability of every interactive component, and WCAG AA in both
  modes are required, not optional.
- Adopting shadcn/ui is an implementation direction for the frontends only. It
  is not permission to rewrite the backend, to move domain logic into the
  browser, or to share a database with another product.

## Data and ownership

- Atlas Ecom owns its PostgreSQL database, named `atlas_ecom`.
- It does not share tables with another application.
- Commerce data, cart state, checkout, payment state, and local orders remain
  in the local database.
- A durable local outbox is used for protocol events that need delivery to a
  connected peer.
- ERP capabilities and presentation are consumed as scoped protocol data;
  Atlas Ecom does not take ERP ownership by receiving them.
- Peers exchange data through the protocol and never read or write each
  other's tables directly.

## Acceptance gates

1. **Standalone commerce path:** Ecom can publish a catalog and sell through
   the storefront without ERP connected.
2. **Connect conformance:** pairing, authority exchange, snapshot plus ordered
   deltas, proposals, and degradation/resynchronization behave according to
   the vendored protocol specification.
3. **Add Product behavior:** Add Product writes directly in standalone mode;
   when connected to an ERP-owned capability, the same operation is submitted
   as a proposal instead of silently changing ERP data.
4. **Presentation:** presentation passed by ERP is consumed by the storefront
   without Ecom taking ownership of ERP data.
5. **Degradation and resynchronization:** loss or version mismatch of a peer
   degrades shared behavior without breaking standalone commerce, and the
   connection can resynchronize when service returns.
6. **Design tokens:** the storefront and `ecom-manager` are styled from the
   shared token table above in both light and dark mode. Every background,
   surface, body and muted text color, accent, link, divider, control border,
   on-accent color, focus ring, and state pair resolves to the named token
   rather than to a hard-coded color, and text and controls meet WCAG AA in
   both modes. The component foundation behind the markup is not fixed by this
   gate.
7. **Storefront and manager frontends:** the storefront and the `ecom-manager`
   are separate Vite + React + TypeScript frontend builds that use the approved
   shadcn/ui and Tailwind CSS v4 direction, resolve the shared token table above
   through the required shadcn variable mapping in both light and dark mode with
   no raw hex value in a component, and read every value they display from the
   existing Node API, which stays their only data source.

## Risks and unknowns

- The exact boundaries and APIs for the two frontends and their plugins are
  not yet implemented.
- The presentation contract needs validation for storefront rendering and
  cache invalidation.
- Proposal UX and conflict handling need to make ERP authority clear to
  commerce operators.
- Prolonged degradation, cursor retention, and resynchronization behavior need
  validation with realistic data volumes.
- The current demo storefront and `ecom-manager` demonstrate the shared tokens
  and light/dark behavior at the token level, but they are server-rendered
  demos with no build step, so they do not satisfy the new separate
  Vite/React/shadcn frontend gate until they are migrated.
- The light `state.success` pair `#2A7C13` on `#C7D3C0` is 3.38:1 and is not a
  normal-text pair; normal text on that background has to use `#2D0000`.
- The approved direction adds a second and a third Node build surface on top of
  a product that deliberately serves its pages from `node:http` with no build
  step: a Vite build, a lockfile, a Tailwind v4 build step, and generated build
  output per frontend, all of which have to stay out of the existing `src/` and
  test path.
- shadcn components are generated into this product's source tree and into the
  sibling product's tree separately, so the same component exists twice and can
  drift. A shadcn upgrade or a local component edit has to be applied
  deliberately per product, and there is no shared package to upgrade once.
- Nothing checks token parity between the two products. If either shadcn
  variable mapping is edited and the other is not, the storefront and the
  operator console diverge with no failing check, so parity needs a check that
  resolves both mappings to the shared token values in both modes.

## Amendment history

| Version | Date | Change | Status |
| --- | --- | --- | --- |
| 1.0.0 | 2026-09-25 | Initial approved standalone commerce contract, storefront and manager boundaries, Ecom ownership, and embedded connect defaults. | ACTIVE |
| 1.1.0 | 2026-09-25 | Approved shared Atlas UI palette and light/dark design-token contract. | ACTIVE |
| 1.1.1 | 2026-09-25 | Expanded shared UI token table, derived contrast-safe values, and preferred shadcn/ui foundation. | ACTIVE |
| 1.2.0 | 2026-09-25 | Approved React/Vite/Tailwind/shadcn frontend direction and token mapping for both products. | ACTIVE |
