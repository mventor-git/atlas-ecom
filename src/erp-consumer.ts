import type { Cursor } from "./protocol.ts";
import type { ErpAuditItem, ErpAuditSnapshot, ErpStockLevel } from "./erp-client.ts";

/**
 * Ecom's read side of the ERP audit capability.
 *
 * The consumer applies one snapshot at a time and remembers only the opaque
 * cursor it last applied, so re-reading that same position is a no-op instead
 * of a second application. This profile publishes snapshots only, so there is
 * no delta chain to walk and no seen-cursor set to retain: an older cursor
 * arriving later is treated as a fresh read, not a replay. State is
 * process-local: there is no persistence and no network access here, so a
 * restart re-reads from the peer rather than resurrecting stale ERP data.
 * Ecom does not adopt ERP records; it only projects them.
 */
export class ErpAuditConsumer {
  private appliedAppId: string | null = null;
  private appliedCapability: string | null = null;
  private appliedCursor: Cursor | null = null;
  private items: readonly ErpAuditItem[] = [];
  private stock: readonly ErpStockLevel[] = [];

  /** Returns false when the snapshot cursor equals the last applied cursor. */
  apply(snapshot: ErpAuditSnapshot): boolean {
    if (this.appliedAppId === null) {
      this.appliedAppId = snapshot.app_id;
      this.appliedCapability = snapshot.capability;
    } else if (
      this.appliedAppId !== snapshot.app_id ||
      this.appliedCapability !== snapshot.capability
    ) {
      throw new Error(
        `ERP audit identity changed: expected ${this.appliedAppId}/${this.appliedCapability}, got ${snapshot.app_id}/${snapshot.capability}`,
      );
    }

    if (snapshot.cursor === this.appliedCursor) {
      return false;
    }
    this.items = snapshot.data.items;
    this.stock = snapshot.data.stock;
    this.appliedCursor = snapshot.cursor;
    return true;
  }

  /** The last applied opaque cursor, or null before the first snapshot. */
  get cursor(): Cursor | null {
    return this.appliedCursor;
  }

  get appId(): string | null {
    return this.appliedAppId;
  }

  get capability(): string | null {
    return this.appliedCapability;
  }

  listItems(): readonly ErpAuditItem[] {
    return this.items;
  }

  listStock(): readonly ErpStockLevel[] {
    return this.stock;
  }

  getStockLevel(itemId: string): ErpStockLevel | undefined {
    return this.stock.find((level) => level.item_id === itemId);
  }
}

/** One sellable ERP item joined to its current stock. */
export interface ConnectedCatalogEntry {
  readonly item_id: string;
  readonly sku: string;
  readonly name: string;
  readonly price_cents: number;
  readonly quantity: number;
}

/**
 * A read-only storefront view of ERP-owned items and their current stock.
 *
 * It holds no `StandaloneCatalog` and no write path: Ecom cannot change ERP
 * pricing or availability from here, it only reads what the peer published.
 * An item with no stock record joins as quantity 0, which reads as unavailable
 * rather than as missing data.
 */
export class ConnectedCatalog {
  private readonly consumer: ErpAuditConsumer;

  constructor(consumer: ErpAuditConsumer) {
    this.consumer = consumer;
  }

  /** ERP item order, as published by the peer. */
  list(): ConnectedCatalogEntry[] {
    return this.consumer.listItems().map((item) => this.entry(item));
  }

  getById(itemId: string): ConnectedCatalogEntry | undefined {
    const item = this.consumer.listItems().find((entry) => entry.item_id === itemId);
    return item === undefined ? undefined : this.entry(item);
  }

  getBySku(sku: string): ConnectedCatalogEntry | undefined {
    const item = this.consumer.listItems().find((entry) => entry.sku === sku);
    return item === undefined ? undefined : this.entry(item);
  }

  private entry(item: ErpAuditItem): ConnectedCatalogEntry {
    return {
      item_id: item.item_id,
      sku: item.sku,
      name: item.name,
      price_cents: item.price_cents,
      quantity: this.consumer.getStockLevel(item.item_id)?.quantity ?? 0,
    };
  }
}
