import type { Cursor, Manifest } from "./protocol.ts";

export interface AtlasErpClientOptions {
  baseUrl: string;
  token: string;
  fetch?: typeof globalThis.fetch;
}

export type ErpHealth = Record<string, unknown>;

/**
 * Typed ERP audit records. Ecom reads these as scoped protocol data and never
 * takes ownership of them: every money field is integer cents and every
 * quantity is an integer, so a snapshot cannot introduce float money.
 */
export interface ErpAuditItem {
  readonly item_id: string;
  readonly sku: string;
  readonly name: string;
  readonly price_cents: number;
}

export interface ErpStockLevel {
  readonly item_id: string;
  readonly quantity: number;
}

export interface ErpSaleLine {
  readonly item_id: string;
  readonly quantity: number;
  readonly unit_price_cents: number;
  readonly total_cents: number;
}

export interface ErpSale {
  readonly sale_id: string;
  readonly customer_id: string;
  readonly journal_id: string;
  readonly total_cents: number;
  readonly lines: readonly ErpSaleLine[];
}

export interface ErpJournalLine {
  readonly account_code: string;
  readonly debit_cents: number;
  readonly credit_cents: number;
}

export interface ErpJournalEntry {
  readonly journal_id: string;
  readonly sale_id: string | null;
  readonly total_debits_cents: number;
  readonly total_credits_cents: number;
  readonly lines: readonly ErpJournalLine[];
}

export interface ErpStockMovement {
  readonly movement_id: string;
  readonly item_id: string;
  readonly quantity_delta: number;
  readonly reason: string;
  readonly reference_id: string;
}

export interface ErpAuditData {
  readonly items: readonly ErpAuditItem[];
  readonly stock: readonly ErpStockLevel[];
  readonly sales: readonly ErpSale[];
  readonly journals: readonly ErpJournalEntry[];
  readonly stock_movements: readonly ErpStockMovement[];
}

export interface ErpAuditSnapshot {
  readonly app_id: string;
  readonly type: "snapshot";
  readonly capability: string;
  readonly connect_version: string;
  /** Opaque protocol position. Ecom stores it verbatim and never parses it. */
  readonly cursor: Cursor;
  readonly data: ErpAuditData;
}

export interface ManualSaleLine {
  readonly itemId: string;
  readonly quantity: number;
  readonly unitPriceCents: number;
}

export interface ManualSaleRequest {
  readonly customerId: string;
  readonly saleId: string;
  readonly lines: readonly ManualSaleLine[];
}

export interface ErpManualSale {
  readonly sale_id: string;
  readonly customer_id: string;
  readonly journal_id: string;
  readonly total_cents: number;
  readonly lines: readonly ErpSaleLine[];
}

const REQUEST_TIMEOUT_MS = 5_000;
/** A manual sale body is a handful of lines; anything larger is not this slice. */
const MAX_REQUEST_BYTES = 8_192;

function requireText(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.trim() === "")) {
    throw new Error(
      allowEmpty
        ? `${label} must be a string`
        : `${label} must be a non-empty string`,
    );
  }
  return value;
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
  return [...value] as string[];
}

function requireInteger(value: unknown, label: string, minimum: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) {
    throw new Error(`${label} must be an integer of at least ${minimum}`);
  }
  return value;
}

function requireNonZeroInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value === 0) {
    throw new Error(`${label} must be a non-zero integer`);
  }
  return value;
}

/** Validates a record array element by element so a bad record names itself. */
function requireRecords<T>(
  value: unknown,
  label: string,
  validate: (entry: Record<string, unknown>, label: string) => T,
): T[] {
  return requireArray(value, label).map((entry, index) => {
    const recordLabel = `${label}[${index}]`;
    return validate(requireObject(entry, recordLabel), recordLabel);
  });
}

function validateHealth(value: unknown): ErpHealth {
  return requireObject(value, "ERP health response");
}

function validateManifest(value: unknown): Manifest {
  const manifest = requireObject(value, "ERP manifest response");
  return {
    app_id: requireText(manifest.app_id, "ERP manifest app_id"),
    connect_version: requireText(manifest.connect_version, "ERP manifest connect_version"),
    capabilities: requireStringArray(manifest.capabilities, "ERP manifest capabilities"),
    permissions: requireStringArray(manifest.permissions, "ERP manifest permissions"),
  };
}

function validateItem(value: Record<string, unknown>, label: string): ErpAuditItem {
  return {
    item_id: requireText(value.item_id, `${label}.item_id`),
    sku: requireText(value.sku, `${label}.sku`),
    name: requireText(value.name, `${label}.name`, true),
    price_cents: requireInteger(value.price_cents, `${label}.price_cents`, 0),
  };
}

function validateStock(value: Record<string, unknown>, label: string): ErpStockLevel {
  return {
    item_id: requireText(value.item_id, `${label}.item_id`),
    quantity: requireInteger(value.quantity, `${label}.quantity`, 0),
  };
}

function validateSaleLine(value: Record<string, unknown>, label: string): ErpSaleLine {
  return {
    item_id: requireText(value.item_id, `${label}.item_id`),
    quantity: requireInteger(value.quantity, `${label}.quantity`, 1),
    unit_price_cents: requireInteger(value.unit_price_cents, `${label}.unit_price_cents`, 0),
    total_cents: requireInteger(value.total_cents, `${label}.total_cents`, 0),
  };
}

function validateSale(value: Record<string, unknown>, label: string): ErpSale {
  return {
    sale_id: requireText(value.sale_id, `${label}.sale_id`),
    customer_id: requireText(value.customer_id, `${label}.customer_id`),
    journal_id: requireText(value.journal_id, `${label}.journal_id`),
    total_cents: requireInteger(value.total_cents, `${label}.total_cents`, 0),
    lines: requireRecords(value.lines, `${label}.lines`, validateSaleLine),
  };
}

function validateJournalLine(value: Record<string, unknown>, label: string): ErpJournalLine {
  return {
    account_code: requireText(value.account_code, `${label}.account_code`),
    debit_cents: requireInteger(value.debit_cents, `${label}.debit_cents`, 0),
    credit_cents: requireInteger(value.credit_cents, `${label}.credit_cents`, 0),
  };
}

function validateJournal(value: Record<string, unknown>, label: string): ErpJournalEntry {
  return {
    journal_id: requireText(value.journal_id, `${label}.journal_id`),
    sale_id: value.sale_id === null ? null : requireText(value.sale_id, `${label}.sale_id`),
    total_debits_cents: requireInteger(value.total_debits_cents, `${label}.total_debits_cents`, 0),
    total_credits_cents: requireInteger(value.total_credits_cents, `${label}.total_credits_cents`, 0),
    lines: requireRecords(value.lines, `${label}.lines`, validateJournalLine),
  };
}

function validateStockMovement(value: Record<string, unknown>, label: string): ErpStockMovement {
  return {
    movement_id: requireText(value.movement_id, `${label}.movement_id`),
    item_id: requireText(value.item_id, `${label}.item_id`),
    quantity_delta: requireNonZeroInteger(value.quantity_delta, `${label}.quantity_delta`),
    reason: requireText(value.reason, `${label}.reason`),
    reference_id: requireText(value.reference_id, `${label}.reference_id`),
  };
}

function validateAuditSnapshot(value: unknown): ErpAuditSnapshot {
  const snapshot = requireObject(value, "ERP audit response");
  if (snapshot.type !== "snapshot") {
    throw new Error("ERP audit type must be snapshot");
  }

  const data = requireObject(snapshot.data, "ERP audit data");
  return {
    app_id: requireText(snapshot.app_id, "ERP audit app_id"),
    type: "snapshot",
    capability: requireText(snapshot.capability, "ERP audit capability"),
    connect_version: requireText(snapshot.connect_version, "ERP audit connect_version"),
    cursor: requireText(snapshot.cursor, "ERP audit cursor"),
    data: {
      items: requireRecords(data.items, "ERP audit data.items", validateItem),
      stock: requireRecords(data.stock, "ERP audit data.stock", validateStock),
      sales: requireRecords(data.sales, "ERP audit data.sales", validateSale),
      journals: requireRecords(data.journals, "ERP audit data.journals", validateJournal),
      stock_movements: requireRecords(
        data.stock_movements,
        "ERP audit data.stock_movements",
        validateStockMovement,
      ),
    },
  };
}

/** Accepts the sale at the top level or wrapped in a `sale` envelope. */
function validateManualSale(value: unknown): ErpManualSale {
  const response = requireObject(value, "ERP manual sale response");
  const sale =
    response.sale === undefined
      ? response
      : requireObject(response.sale, "ERP manual sale response sale");
  return validateSale(sale, "ERP manual sale");
}

interface ErpRequestOptions<T> {
  authenticated: boolean;
  validate: (value: unknown) => T;
  body?: string;
}

/** Minimal authenticated HTTP client for the Atlas ERP loopback profile. */
export class AtlasErpClient {
  private readonly baseUrl: URL;
  private readonly token: string;
  private readonly fetch: typeof globalThis.fetch;

  constructor(options: AtlasErpClientOptions) {
    this.baseUrl = new URL(options.baseUrl);
    this.token = requireText(options.token, "Atlas ERP token");
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  health(): Promise<ErpHealth> {
    return this.request("GET", "/health", { authenticated: false, validate: validateHealth });
  }

  manifest(): Promise<Manifest> {
    return this.request("GET", "/connect/manifest", {
      authenticated: true,
      validate: validateManifest,
    });
  }

  auditSnapshot(): Promise<ErpAuditSnapshot> {
    return this.request("GET", "/connect/audit", {
      authenticated: true,
      validate: validateAuditSnapshot,
    });
  }

  /**
   * Submits one manual sale to the ERP capability master. The write is sent
   * exactly once: a failed submission is never retried automatically, because
   * a retry could post the same sale twice.
   */
  async createManualSale(request: ManualSaleRequest): Promise<ErpManualSale> {
    const customer_id = requireText(request.customerId, "Manual sale customerId");
    const sale_id = requireText(request.saleId, "Manual sale saleId");
    if (request.lines.length === 0) {
      throw new Error("Manual sale requires at least one line");
    }
    const lines = request.lines.map((line, index) => ({
      item_id: requireText(line.itemId, `Manual sale lines[${index}].itemId`),
      quantity: requireInteger(line.quantity, `Manual sale lines[${index}].quantity`, 1),
      unit_price_cents: requireInteger(
        line.unitPriceCents,
        `Manual sale lines[${index}].unitPriceCents`,
        1,
      ),
    }));
    const body = JSON.stringify({ customer_id, sale_id, lines });
    if (Buffer.byteLength(body, "utf8") > MAX_REQUEST_BYTES) {
      throw new Error(`Manual sale body exceeds ${MAX_REQUEST_BYTES} bytes`);
    }

    return this.request("POST", "/connect/sales", {
      authenticated: true,
      body,
      validate: validateManualSale,
    });
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    options: ErpRequestOptions<T>,
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (options.authenticated) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    let response: Response;
    try {
      response = await this.fetch(new URL(path, this.baseUrl), {
        method,
        headers,
        ...(options.body === undefined ? {} : { body: options.body }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "network error";
      throw new Error(`Atlas ERP ${method} ${path} failed: ${detail}`, { cause: error });
    }
    if (!response.ok) {
      const status = `${response.status}${response.statusText === "" ? "" : ` ${response.statusText}`}`;
      throw new Error(`Atlas ERP ${method} ${path} failed: HTTP ${status}`);
    }
    let value: unknown;
    try {
      value = JSON.parse(await response.text()) as unknown;
    } catch (error) {
      throw new Error(`Atlas ERP ${method} ${path} returned invalid JSON`, { cause: error });
    }
    return options.validate(value);
  }
}
