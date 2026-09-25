# Atlas Ecom frontend

React 19 + TypeScript + Vite + Tailwind CSS v4 + shadcn/ui on Radix primitives.
Two routes: `/` is the customer storefront and `/manager` is the `ecom-manager`.

The Ecom Node API is the only data source. Nothing here reads a database,
duplicates the commerce domain, or computes money: every price and total is the
integer number of cents the API sent.

## The API is required

The dev server proxies `/api` to `http://127.0.0.1:4312`, so every fetch in
`src/lib/api.ts` is a same-origin relative path and no component knows where the
API runs. Start the API first, from the repository root:

```sh
npm run web          # the Node API on 127.0.0.1:4312
```

Without it the pages render their error state; there is no fixture fallback.
Override the target with `ATLAS_ECOM_API_ORIGIN` if the API is elsewhere.

| Route | Method | Used by |
| --- | --- | --- |
| `/api/health` | GET | manager stats and the mode/database/peer line |
| `/api/catalog` | GET, POST | storefront product cards, manager stock table, manager Add Product |
| `/api/cart` | GET, POST | storefront cart panel, add to cart |
| `/api/orders` | GET | manager order list and order-value stat |
| `/api/checkout` | POST | storefront checkout |

**Add Product is a JSON `POST /api/catalog`** with `{name, price_cents, quantity}`, answered
`201` with the created product and the catalogue counts as they now are. It is the
standalone branch of the contract: no peer is paired, so the write goes straight into
the in-memory catalogue, and the server revalidates the same rules the domain uses. The
`POST /manager` form on the server-rendered page is still there and is the same write
with an HTML answer; the two share one validation path.

## Commands

```sh
npm install
npm run dev         # Vite dev server, /api proxied to the Node API
npm run typecheck   # tsc -b
npm test            # vitest run
npm run build       # tsc -b && vite build
npm run preview     # serve dist, with the same /api proxy
npm run lint        # oxlint
```

## The token bridge

`src/styles/atlas-tokens.css` is the only file allowed to contain a colour
value. It declares the shared Atlas UI token table from `contract.md` v1.1.1 as
`--atlas-*` custom properties for both modes, and maps the shadcn/Tailwind
variables onto that table per the required v1.2.0 mapping. `src/index.css` holds
imports and nothing else.

`src/test/atlas-tokens.test.ts` reads that file back and fails if the table drifts
from the contract, if a required mapping changes, if a colour literal appears
anywhere else in `src/`, or if a painted text pair drops below AA in either mode.
Two rules in the stylesheet are there because the tokens were derived against
`bg.canvas`, not against a surface:

- `fg.muted` is a canvas colour. Inside `.on-surface` it repaints to
  `fg.default`, because it measures 3.48:1 on `bg.surface` in dark mode.
- `border.control` is a control boundary. A control that sits on a surface paints
  the canvas as its own background, so the border keeps the 3:1 it was derived
  for (2.79:1 on `bg.surface` in dark mode is the shortfall this avoids).

## Light and dark

The mode is one class on `<html>`, set before first paint by a small inline script
in `index.html` so a reload never flashes the other mode. An explicit choice
persists in `localStorage`; with no choice stored, `prefers-color-scheme` decides
and keeps deciding while the tab is open.

## Re-running the shadcn CLI

Components live in `src/components/ui` and are owned here, not consumed as a
package. To add or upgrade one:

```sh
npx shadcn@latest add <component> --yes
```

`shadcn add` appends its own `:root` / `.dark` blocks with the default palette to
`src/index.css`. Delete them: the colour bridge stays in `atlas-tokens.css`, and a
second palette is a second source of truth. Two local edits are already made over
generated code and are marked `LOCAL EDIT` in place.

## What is not here

No authentication, accounts, or sessions; one shared cart; no payment; no
persistence; no connection to Atlas ERP. Every page says so. The manager's
Add Product is the standalone branch of the contract, and it becomes a Connect
proposal only once a peer actually holds the capability.
