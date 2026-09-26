# Legacy Knowledge Transfer

**Evidence base:** `ecom-erp`, at `../ecom-erp`, read-only.
**Status:** supporting document for the `Legacy knowledge transfer` section of
`contract.md` v1.3.0. It records what the legacy project proved, what is
deliberately not carried, and what a transferred capability has to ship. It
grants no scope of its own; where it and the contract disagree, the contract
decides.

## 1. Purpose and rule

The legacy project is the **evidence base for this contract, not its
authority**. Atlas Ecom is a different product with a different architecture
(`core -> cluster -> plugin -> module`), a different database, and two
frontends. A legacy file is a witness to a requirement, not a template for an
implementation.

Three dispositions, and nothing else:

- **Adopt** — the invariant, requirement, or test a legacy area genuinely
  proved. Each is restated below as a rule for *this* product and, where it is
  a rule rather than a preference, as a test that runs in *this* repository.
- **Redesign** — the mechanism behind an adopted requirement is designed fresh
  inside this product's hierarchy, against `atlas_ecom` and this product's own
  frontends. The legacy mechanism is evidence of a need, never a source of
  code.
- **Drop** — legacy accidents, dead surfaces, and duplicated systems. These
  are named in section 4 so that a later reader who finds one in the legacy
  tree knows it was rejected on purpose and not simply overlooked.

The prohibitions are absolute and are restated from the contract:

- No legacy source, schema, route, component, style, or configuration is
  copied, vendored, or adapted into this product.
- No legacy table is read, imported, or migrated. **Legacy data is not
  imported**, which is the existing non-goal in `contract.md` restated here
  against a named project rather than in the abstract.
- Where a legacy behavior is ambiguous or contradictory, this contract decides
  and the legacy path is cited as evidence for the requirement only.

Everything below is a citation, not a quotation. Line numbers refer to the
legacy tree at the time of reading and are given so a reviewer can find the
witness; they are not an API this product is expected to match.

## 2. Adopted Ecom requirements

Each item states the rule this product adopts, then the legacy paths that prove
the requirement was real, and then what is *not* carried over.

### 2.1 Variant identity and per-variant media

**Rule.** A sellable option is an identity with its own row, its own media, and
its own stock, not a string on a product. Colour and size are structured data
that a variant is selected by; media and alt text are bound to the variant
rather than to the product.

**Evidence.** `server/db.js:827-841` (`product_variants` carrying `sku`,
`barcode`, and attribute columns), `server/db.js:846-862` (`inventory` keyed on
`variant_id`), and `server/db.js:607-615` (`product_images` with
`variant_attributes` and `sort_order`). The client-side resolver that binds a
selection to one image is `client/src/utils/productParsers.js:43-93`
(`matchVariantImage`), and the design record is
`docs/archive/notes/VARIANT_IMAGES_IMPLEMENTATION.md`.

**Not carried.** The `variant_attributes` text encoding. The requirement is
per-variant media; the legacy mechanism was a JSON-in-a-text-column binding
that the same codebase had to defend against three different ways. See 4.1 and
4.2.

### 2.2 Server-paginated, server-filtered browse

**Rule.** Browse is a server operation. Paging, filtering, search, and sorting
are resolved server-side against a bounded result set, and the response
carries the total needed to render paging. The browser never holds the whole
catalogue to filter it.

**Evidence.** `server/routes/mobileProducts.js:18-32, 66-74, 95-96, 125-128`
computes `page`/`limit` (capped at 100) and `offset`, runs a `COUNT(*)` for the
total, and returns `total_pages`. Admin order listing paginates the same way at
`server/routes/admin.js:959-997`. Server-side filter and sort parameters are
demonstrated at `server/routes/products.js:13, 51-73`.

**Not carried, and this is the sharp part.** The customer-facing storefront
listing at `server/routes/products.js:11-86` has **no `LIMIT`/`OFFSET` at all**
and returns every active row on every request, and
`client/src/pages/ProductsPage.jsx` has no paging control. The requirement was
therefore proved on the mobile and admin paths and *failed* on the storefront
path, in the same repository, at the same time. The adopted rule is the mobile
behaviour; the storefront behaviour is 4.5 and 4.6.

### 2.3 Server-authoritative pricing

**Rule.** A price the browser sends is never the price charged. Line prices and
order totals are re-resolved from the database at admission, a tampered or
stale client value is discarded rather than reconciled, and internal cost data
never reaches a customer-facing response.

**Evidence.** `server/services/orderPricing.js:1-2` states the rule in its own
header ("the server-side authority for order totals") and
`:58-75` (`computeAuthoritativeOrder`) implements it;
`server/routes/orders.js:18-28` is the enforcement point at the route. The
behaviour is proven, not asserted: `server/tests/orderPricing.test.js:2-4,
33-79` submits a client price of 250 against a database price and requires the
database value, and rejects unknown, inactive, zero, and negative-quantity
lines. Cost columns are stripped from customer responses by
`server/middleware/sanitizeProducts.js:7, 13-27`. The pre-fix state is recorded
in `docs/pricing-reality.md`, which is useful precisely because it names the
defect: checkout totals were client-sent and unverified.

**Not carried.** No pricing preview computed in the browser is authoritative,
even where one is offered as a convenience.

### 2.4 Idempotent command admission

**Rule.** One admitted command per key. A command carries a caller-supplied
idempotency key; the claim, the request identity, and the response are
durable; a repeat of the identical request replays the original receipt rather
than performing the work twice; the same key with a materially different
request is a conflict, not a second order; and a failed command releases the
claim so an honest retry is possible.

**Evidence.** `server/services/idempotencyService.js:13-19` states the
invariant and names the claim key `(actor, endpoint, Idempotency-Key)` with a
`sha256` request identity, then distinguishes same-key/same-body replay from
`:177-178` (`409 idempotency-conflict`) and `:199` (`409 idempotency-in-flight`).
Correctness is in the database, not memory: `server/db.js:1152`
(`idempotency_records`) and `server/services/idempotencyService.js:141-175`
(insert under a unique key), with commit on success and release on failure at
`:196-241`. Order admission applies the same rule to commerce at
`server/routes/orders.js:44, 62, 100, 118, 121`, where a `UNIQUE(customer_id,
idempotency_key)` index is the final authority. Tests:
`server/tests/idempotencyN1.test.js`, `server/tests/checkoutIdempotencyN2.test.js`,
`server/tests/concurrency.test.js`.

**Already held here, and the reason it is cited as precedent.** This repository
already implements this requirement for the connected order path
(`src/postgres-order-store.ts`, with `reserve`/`complete`/`abort` and a
`request_hash`, covered by the `ConnectedCheckout` and durable-store tests). The
transfer widens it to local commands; it does not invent it. See 4.3 for the
legacy fingerprint defect that makes the *scope* of the fingerprint load-bearing.

### 2.5 Order lifecycle

**Rule.** An order has named states and only the declared transitions between
them are legal. The legal set is data, so a transition is added by editing one
table rather than by editing control flow scattered through handlers. An
illegal transition is rejected.

**Evidence.** `server/services/orderWorkflowService.js:6` declares the chain
(`draft -> payment_pending -> payment_verified -> admin_review -> confirmed ->
picking -> packing -> ready_for_shipping -> shipped -> delivered -> completed`),
`:42` (`transitionMap`) is the data-driven edge set, `:65` shows cancellation
reachable from an active state, and `:77` is the guarded check. The spec is
`docs/payment-state-machine.md`; the tests are `server/tests/workflow.test.js`.

**Not carried.** The payment model. Status-only payment truth is named as a
dropped legacy accident in the contract, and a state name is not proof of
payment.

### 2.6 Customer identity, and why reviews and wishlist follow it

**Rule.** A customer is a real, server-owned record. Scoped access — own order
history, own review, own wishlist — is resolved from the authenticated
principal on the server. No customer-scoped capability ships before identity
exists and before a restart keeps what it wrote.

**Evidence.** `server/routes/auth.js:74-75` (`isAuthenticated`) is the single
gate reused across modules. `server/db.js:212-222` is the identity root.
`server/routes/orders.js:189, 253` scope `/orders/mine` and `/orders/tracker` to
the authenticated customer rather than to a request parameter. The dependency is
direct in the evidence, not inferred: review writes are authenticated at
`server/routes/products.js:221` and take `customer_id` from the principal at
`:237`, and all three wishlist routes are authenticated at
`server/routes/wishlist.js:7, 28, 48` with every query filtered on the
principal's id at `:17, 38, 51`.

**The dependency is the transferable insight.** In the legacy code, reviews and
wishlist were customer-scoped *because* identity already existed, and the
client's rendering of both branches on the same authenticated user
(`client/src/pages/ProductDetailPage.jsx:53, 353, 583`). The ordering
constraint is therefore evidence, and this product honours it by recording
identity as a prerequisite in section 3 rather than as a parallel candidate.

**Not carried.** Guest checkout as a way of avoiding identity. The legacy
find-or-create-by-email path with a synthetic `guest_` placeholder
(`server/routes/orders.js:34-41`) was a workaround for a missing identity
model, and adopting it would reintroduce that model.

### 2.7 Reviews and wishlist

**Rule.** One review per customer per product, enforced by the database rather
than by an application check, so a second submit updates rather than
duplicates. Reading reviews is public; writing them is not. A wishlist holds
saved items per customer with no duplicates.

**Evidence.** `server/db.js:253-261` carries
`UNIQUE(product_id, customer_id)` on `reviews` and
`server/routes/products.js:235-236` uses it as an upsert target; `:202-215` is
the public read and `:221` the authenticated write. Rating aggregates are
resolved in the listing query itself at `server/routes/products.js:41-42`, so
a list and a detail page cannot disagree. `server/db.js:235-242` carries
`UNIQUE(customer_id, product_id)` on `wishlist`, and
`server/routes/wishlist.js:9-19` joins full product detail rather than returning
bare ids.

**Not carried.** The client-side review and wishlist components, and the
client-side state context that mirrors them.

### 2.8 Merchandising and storefront presentation

**Rule.** Store identity and merchandising are data the operator can change,
read through one accessor, and consumed by the storefront without the storefront
owning it. Presentation is separable from the catalogue.

**Evidence.** `server/db.js:1665` stores `appearance_primary_color` as a
setting row, alongside the public identity settings at `:1529, 1561, 1626`
(`store_name`, `currency`, `logo_link`). One accessor serves every consumer
(`server/services/settingsService.js`), with public read, admin read, and
gated single-key and batch write at `server/routes/settings.js:7, 16, 42, 60`.
Merchandising surfaces are admin-owned data too: `server/routes/heroSlides.js:23`
exposes an active set publicly, with `server/routes/welcomeSlides.js` and
`server/routes/announcements.js` the same shape. The language spec is
`docs/design-language.md`.

**Read against this product's contract.** Presentation that a *peer* supplies is
the `Presentation` acceptance gate and the cross-product ownership rule; it is
consumed and never owned. The transferable requirement is the separation and the
single accessor, not the legacy colour value or the legacy settings keys.

### 2.9 Validated inbound import

**Rule.** An import is validated before anything is written, reports its errors
with enough detail to fix them, and commits all-or-nothing. Preview never
writes. A duplicate inside the file is a validation error, not a silent
overwrite.

**Evidence.** `server/services/onboardingImport.js:5-6` states the three phases
in the header — parse, then preview with mapping, validation, duplicate
detection and exact counts, then a single all-or-nothing transaction. Per-cell
validators raise located errors at `:48-132`; preview resolution runs inside a
rolled-back `SAVEPOINT` at `:419-420` and `:463-492`, which is what makes
"preview never wrote" true rather than aspirational. In-file duplicates are
errors at `:433-446`, and the route returns an empty error list only because a
commit either fully happens or never does
(`server/routes/productsImportExport.js:148-180`). Tests:
`server/tests/onboardingImport095.test.js`.

### 2.10 Outbound integrations

**Rule.** Outbound events are a durable, signed, retried delivery with a
receipt, not a fire-and-forget call. A payload is verifiable by the receiver. A
failed delivery is recorded, not lost. An inbound counterpart is deduplicated
on the provider's own event identity.

**Evidence.** `server/services/webhookService.js:2-6` states signing and retry
in its header; `:26` is the HMAC-SHA256 signature, `:15` the backoff schedule,
and `:37-40` a constant-time verification for receivers. Subscriptions, a
delivery receipt log, and a test-fire endpoint are at
`server/routes/webhooks.js:48-239`, over `server/db.js:1221-1247`. The inbound
side is deduplicated on a provider event key
(`server/services/kashierWebhookService.js:5, 29-35`, `server/db.js:1557`).
Channel abstraction is at `server/services/notificationChannels.js:4, 55`, and
the event vocabulary at `server/services/eventService.js:16, 99`.

**The peer-handshake lesson, which is the part that matters here.** The inbound
payment handler records its own authority rule in the source: it concludes
"paid" only when a *signed* provider amount matches the order's
*server-computed* authoritative total (`server/services/kashierWebhookService.js:99-123`).
That is 2.3 and 2.4 meeting at a boundary, and it is the model for the Ecom/ERP
sale submission: a signed, verified, server-priced claim rather than a
client-asserted one. `docs/ERP_GUIDE.md:239` documents the stock-sync
handshake.

**Not carried.** The transport, the retry schedule, the signature scheme, or the
event names. Atlas Connect and this product's durable outbox already own
delivery; a second delivery system is 4.11.

## 3. Candidate evolution map

This mirrors the `Evolution map` table in `contract.md` v1.3.0 and adds the
legacy provenance for each row. **Nothing here is approved scope.** A candidate
becomes scope only when an amendment promotes it, and a promoted module ships
only against the gate in section 5.

| Capability | Candidate modules | Legacy provenance | Status |
| --- | --- | --- | --- |
| Catalog | `browse` | `server/routes/mobileProducts.js` (paging), `server/routes/products.js:13, 51-73` (filter/sort) | candidate |
| Catalog | `variant-media` | `server/db.js:607-615`, `client/src/utils/productParsers.js:43-93` | candidate |
| Presentation | `storefront-presentation` | `server/routes/settings.js`, `server/routes/heroSlides.js` | candidate |
| Orders | `lifecycle` | `server/services/orderWorkflowService.js:6, 42, 77` | candidate |
| Command admission | `idempotent-admission` | `server/services/idempotencyService.js:13-19`, `server/routes/orders.js:44, 100` | candidate |
| Customer identity | `customer` | `server/routes/auth.js:74-75`, `server/db.js:212-222` | **prerequisite, not implemented** |
| Reviews | `reviews` | `server/db.js:253-261`, `server/routes/products.js:202-245` | candidate, gated on identity |
| Wishlist | `wishlist` | `server/db.js:235-242`, `server/routes/wishlist.js` | candidate, gated on identity |
| Integration | `import` | `server/services/onboardingImport.js:5-6, 463-492` | candidate |
| Integration | `outbound` | `server/services/webhookService.js`, `server/services/kashierWebhookService.js:99-123` | candidate |

Two ordering rules carry over from the contract and are restated because the
provenance is what justifies them:

- **Identity before customer scope.** `reviews` and `wishlist` are the two rows
  whose legacy evidence is an authenticated gate on every route. They are not
  approved until `customer` exists.
- **Persistence before customer scope.** No customer-scoped capability is
  approved until a restart keeps what it wrote. In the legacy tree the durable
  records are tables (`server/db.js:1152`); in this product the only owned table
  today is the connected-order receipt, and `PROJECT_STATE.md` records that
  `OrderBook` and the local commerce path are still in memory.

## 4. Anti-patterns not carried

Each is a real, located defect or duplication in the legacy tree. They are
listed so that a future reader who finds one in `../ecom-erp` knows it was
rejected deliberately. None of them is a criticism to fix there; the legacy
project is closed and is not being modified.

### 4.1 Colour and size as free-text JSON

`server/schema.sql:30, 33` and `server/db.js:198` declare `colors TEXT DEFAULT
'[]'` and `sizes TEXT DEFAULT '[]'` on `products`. Every reader then has to
defend against the encoding: `client/src/utils/productParsers.js:1-12` documents
that the same field arrives as an array, a JSON string, or null and wraps every
read in a parse guard, and the guard was re-implemented independently in
`client/src/components/ProductColorSwatches.jsx:33`,
`client/src/components/SizeSelector.jsx:30`,
`client/src/components/ProductCard.jsx:38-39`, and
`client/src/pages/ProductDetailPage.jsx:111, 117`.

**Not carried.** Option identity is structured data, so it is typed, validated,
and queryable. No variant axis is a JSON blob in a text column.

### 4.2 Broken variant image switching

`docs/archive/notes/VARIANT_IMAGE_SWITCHING_FIX.md:1-8` names the defect
directly: selecting a variant filtered the gallery so that the gallery changed
under the customer. The manual test that exposed it is recorded in
`docs/archive/notes/VARIANT_IMAGES_IMPLEMENTATION.md:86-89, 144-145`. A related
defect outlived the fix on the listing card: the size is *guessed* rather than
chosen, by matching a string prefix
(`client/src/components/ProductCard.jsx:100-101`), and the resolved image falls
back to the product-level image when no variant matches
(`client/src/components/ProductCard.jsx:91-92`) — so a card can show an image
that is not the variant being added to the cart.

**Not carried.** The media binding is variant-keyed, and the gallery is a
function of the selection rather than a filter applied on top of it. A variant's
media and a variant's selectable options are the same data, so an image and the
size that produced it cannot disagree.

### 4.3 Cart identity losing the size

`client/src/context/CartContext.jsx:71` keys a cart line on
`id + color + size`, and `:73, 77, 81, 90` match lines on the size argument.
`client/src/pages/CartPage.jsx:142, 151, 162` call `updateQuantity` and
`removeFromCart` passing only `item.color?.name`, so for a sized line the
comparison is against `undefined` and the update or removal silently misses. The
React key at `:126` omits size for the same reason. The second cart surface,
`client/src/components/CartDrawer.jsx`, does pass size, so the two surfaces
disagree.

**Not carried.** Cart line identity is one definition, used by every surface.
The defect class is dropped, not just this instance of it.

### 4.4 An idempotency fingerprint that omits the thing that differs

`client/src/pages/CartPage.jsx:51-54` seeds the order idempotency key from
`id`, `quantity`, and `color` — **not** `size`. Two cart lines differing only by
size therefore produce the same key, and `server/routes/orders.js:62-67`
correctly replays the first order for the second. The server behaved correctly;
the client computed an insufficient identity.

**Not carried.** A request fingerprint covers every field that can change the
result. This is why 2.4 makes the *scope* of the fingerprint part of the
requirement.

### 4.5 A search that the storefront cannot reach

`server/routes/products.js:67-70` supports a `search` parameter.
`client/src/pages/ProductsPage.jsx:19` initialises `search` to `''` and
`:25-28` reads back only `category`, `brand`, `min_price`, and `max_price` from
the URL, so the value never arrives; `client/src/api/products.js:55-62` has no
`search` parameter to forward. The search box navigates correctly
(`client/src/components/SmartSearch.jsx:130, 139, 335`) into a parameter the page
discards.

**Not carried.** A control that appears to work and does not. If a search field
is rendered, the query it produces reaches the server and changes the result.

### 4.6 No pagination on the main listing

`server/routes/products.js:38-73` builds the storefront listing with no
`LIMIT`/`OFFSET` and returns every active row; `server/routes/admin.js:197-208`
does the same for the admin product list. The only `LIMIT`s in
`server/routes/products.js` (`:100`, `:147`) are on the `/featured` and
`/top-selling` widgets. `client/src/pages/ProductsPage.jsx` has no paging
control.

**Not carried.** Every listing is bounded and reports its total. See 2.2, which
is the same repository's correct implementation on the mobile path.

### 4.7 Client-side filtering

`client/src/pages/ProductsPage.jsx:67-73` filters the already-fetched array in
the browser, and `:58-65` computes the price bounds with `Math.min`/`Math.max`
over the full result set purely to build the filter UI.
`client/src/components/SmartSearch.jsx:16-29` fetches the entire catalogue once
into a module-level cache and searches it in the browser.

**Not carried.** Filtering that scales with the size of the table.

### 4.8 Orphaned surfaces

`client-admin/src/components/ProductGallery.jsx:117` is the entire variant-image
admin surface — upload, reorder, variant assignment — with no importer anywhere
in the repository; it is the admin surface described in
`docs/archive/notes/VARIANT_IMAGES_IMPLEMENTATION.md:71-77`, left behind by the
admin split. Also unreferenced: `client/src/components/PhotoStack.jsx:33`,
`client-admin/src/components/Sidebar.jsx` (shadowed by
`client-admin/src/admin/components/Sidebar.jsx`), `client/src/pages/ProductForm.jsx`,
and the ten-file `client/src/admin/` subtree left behind by the same split.
There are two `Sidebar` components and one is used.

**Not carried.** Unreachable code. If a surface is not reachable it is deleted,
not parked; a feature described in a design note and unreachable in the product
is a lie told to the next reader.

### 4.9 Placeholder content presented as real

`server/undefined` is a 598 KB SQLite database committed at a path literally
named `undefined`; it escaped the `*.db` rule at `.gitignore:14` by having no
extension. `server/scripts/seed-demo-data.js:6-8` carries the clause "No fake
customers, no fake reviews, no fabricated order or payment history, ever" —
written because the failure mode was real — and `:27` still ships a
`demo1234` admin password that `server/index.js:425` logs.
`docs/archive/notes/VARIANT_IMAGES_IMPLEMENTATION.md:173` records that image
upload used SVG placeholders. `client/src/components/DemoBanner.jsx:29` and
`client-admin/src/components/DemoBanner.jsx:29` duplicated a permanent
"nothing is real" bar across both clients.

**Not carried.** This product already labels demo state at the source
(`mode`, `in_memory`, `database`, `peer_connected` on the API, and `paid:
false, persisted: false` on checkout). That honesty is kept and extended: a
placeholder is either labelled as one at the surface that shows it, or it is not
shipped.

### 4.10 Authorization from a single session boolean

`server/middleware/adminAuth.js:3` is the entire admin gate, one line:
`if (req.session && req.session.isAdmin)`. `server/middleware/rbac.js:18, 86`
grants a super-admin bypass on the same boolean when no user row matches, and
`server/routes/admin.js:191` answers the environment-admin session with
`permissions: ['*'], isSuperAdmin: true` and no permission check at all. The
client then makes its own authorization decision from a response field: `client/src/pages/ProductForm.jsx:27-32`,
`client/src/admin/context/AdminAuthContext.jsx:18-23`,
`client-admin/src/admin/AdminLayout.jsx:22`. The same boolean also drives
rate-limit identity and the CSRF endpoint (`server/index.js:96, 259`).

**Stated accurately, because the obvious description is wrong.** The flag is
*not* client-supplied: it is set server-side after a bcrypt check
(`server/routes/admin.js:34-46`) in a signed cookie (`server/index.js:219-228`).
What is dropped is the **shape** of the decision — one boolean as the entire
authorization model, with no permission granularity and a second, independent
client-side gate on a response field. `server/middleware/rbac.js` plus
`server/services/permissionService.js` is the real permission layer that later
replaced it, and `docs/security-audit.md:19` flags the original.

**Not carried.** Server-side permission checks as the only authorization, with
the UI reflecting them rather than substituting for them.

### 4.11 Dual UIs and three competing dark systems

`client/src/App.jsx:18` records the split ("Admin routes moved to client-admin
(5174); Customer App (5173) remains isolated"), which is why `client/src/admin/`
is dead. Three dark-mode implementations then coexisted:

1. `client/src/context/ThemeContext.jsx:10, 25` — `localStorage` key `theme`,
   toggling `dark` on `<html>`.
2. `client-admin/src/utils/theme.js:8, 23-34` — a **different** localStorage
   key, same `dark` class.
3. `client-admin/src/utils/appearance.js` — a third system that injects a
   runtime `<style>` at `:15` and `:138` carrying hardcoded hex and `!important`
   overrides: a primary-scale block at `:59-79` and a separate slate dark block
   at `:140-156` that repaints `bg-white`, `text-gray-900`, `border-gray-200`
   and more. It uses no storage at all.

`client-admin/src/styles/design-tokens.css:2` defines a teal primary that is
never imported, while hardcoded literals of the same colour sit in six JSX files
and `client-admin/tailwind.config.js` defines a different primary entirely;
`docs/archive/legacy/current-state-matrix.md:52` records the split. Ten modules
are duplicated across the two clients with differing contents, including both
`i18n` dictionaries.

**Not carried.** Two systems of colour truth. This product has one shared token
table, one bridge per product, and a parity requirement (contract v1.3.0, Token
mapping). The legacy failure mode is the reason that requirement is an
acceptance gate rather than a note.

### 4.12 Also observed, and rejected on the same basis

Recorded so they are not rediscovered as if they were new:

- **A second accounting application vendored into the tree** —
  `deps/smartaccounting/`, a separate Flask/Python app with its own database and
  templates, living inside the commerce repository.
- **A parallel mobile API for a client that is not in the repository** —
  `server/routes/mobile*.js` is a complete second domain implementation
  (`mobileProducts`, `mobileOrders`, `mobileCart`, `mobileWishlist`,
  `mobileCustomerAuth`, `mobileNotifications`, `mobileAuth`) for a
  `mobile-app/` described as planned in `docs/BACKLOG.md:61`. It is the only
  place with real pagination (2.2), which is why 2.2's evidence is a path and
  not a claim about the system as a whole.
- **Two clients sharing duplicated business logic** — see 4.11.
- **Duplicated documentation** — `client-admin/public/manual.html` holds a
  second copy of screenshots also stored under `docs/screenshots/`.

## 5. Acceptance-gate template

Contract acceptance gate 8 ("Legacy transfer") is the gate. This is the
per-capability form to fill in when a module from section 3 is promoted. A
capability is not done until every row is answered, and a row answered with an
absent, skipped, or stubbed test counts as unanswered.

| # | Requirement | Must state |
| --- | --- | --- |
| 1 | **Public seam** | The named operation or endpoint this capability exposes, and its input and output shape. |
| 2 | **Invariant** | The one rule that must hold, phrased so a violation is observable. |
| 3 | **Owning cluster** | The cluster in `core -> cluster -> plugin -> module` that owns it, and what it must not own. |
| 4 | **Failure semantics** | What a rejection looks like: the status, the message, and whether the caller may retry the same request safely. |
| 5 | **Real test** | The named test that runs in this repository and fails if the invariant breaks. A skipped test is not evidence. |
| 6 | **UI states** | Defined loading, empty, error, and success states on every surface that shows the capability. |
| 7 | **Legacy disposition** | Which of adopt / redesign / drop applied, with the cited legacy path, and confirmation that nothing was copied. |

Two rules that apply to the template itself:

- **Row 7 is a claim about the diff, not an intention.** It is answered by
  pointing at the change, and it is false if any legacy code, schema, route, or
  style appears in the diff.
- **Row 5 must be able to fail.** The strongest available check for a
  transferred rule is one that was written against the defect, the way
  `server/tests/orderPricing.test.js:33-79` submits a client price of 250 and
  requires the server to discard it. Restating the invariant as an assertion
  that cannot fail is the same failure as no test.

## 6. What this document does not do

- It does not approve scope. Section 3 is a candidate map; only an amendment
  promotes a row.
- It does not import legacy data, and it does not propose a migration path for
  any. The contract's non-goal stands.
- It does not record a legacy verdict. The legacy project's own status
  matrices — `docs/feature-reality-matrix.md`,
  `docs/system-audit-2026-08-28.md`, `docs/KNOWN_ISSUES.md` — are the record
  there, and they are not restated or corrected here.
- It does not claim any capability above is implemented in this product. With
  the exception of 2.4, which this repository already holds for the connected
  order path, every requirement in section 2 is **adopted and unimplemented**;
  `PROJECT_STATE.md` is the authority on what this product has actually built.
