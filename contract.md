# Atlas Ecom Contract

## Metadata

- Product: Atlas Ecom
- Contract version: 1.0.0
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

## Risks and unknowns

- The exact boundaries and APIs for the two frontends and their plugins are
  not yet implemented.
- The presentation contract needs validation for storefront rendering and
  cache invalidation.
- Proposal UX and conflict handling need to make ERP authority clear to
  commerce operators.
- Prolonged degradation, cursor retention, and resynchronization behavior need
  validation with realistic data volumes.

## Amendment history

| Version | Date | Change | Status |
| --- | --- | --- | --- |
| 1.0.0 | 2026-09-25 | Initial approved standalone commerce contract, storefront and manager boundaries, Ecom ownership, and embedded connect defaults. | ACTIVE |
