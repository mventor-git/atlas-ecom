import { randomUUID } from "node:crypto";

export const CONNECT_VERSION = "1.0.0";
export const AUTHORITY_ROLES = ["master", "reader", "proposer"] as const;
export type AuthorityRole = (typeof AUTHORITY_ROLES)[number];
export type Cursor = string;

export interface Manifest {
  app_id: string;
  connect_version: string;
  capabilities: readonly string[];
  permissions: readonly string[];
}

export interface HandshakeResult {
  accepted: boolean;
  reason?: string;
}

export interface PairingResult {
  accepted: boolean;
  peer_app_id: string;
  mode: "share-only";
  adopted_capabilities: readonly string[];
  moved_data: false;
  reason?: string;
}

export interface Snapshot {
  type: "snapshot";
  capability: string;
  data: unknown;
  cursor: Cursor;
}

export interface Delta {
  type: "delta";
  event_id: string;
  capability: string;
  previous_cursor: Cursor | null;
  cursor: Cursor;
  change: unknown;
}

export type ProposalDecision = "accepted" | "rejected";
export type ProposalStatus = "pending" | ProposalDecision;

export interface Proposal {
  id: string;
  capability: string;
  requester: string;
  change: unknown;
  status: ProposalStatus;
  reason?: string;
}

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function majorVersion(version: string): number | null {
  if (typeof version !== "string") {
    return null;
  }

  const match = VERSION_PATTERN.exec(version);
  return match ? Number(match[1]) : null;
}

/** Exchange manifests and accept only peers on the same protocol major. */
export function handshake(
  local: Pick<Manifest, "connect_version">,
  peer: Pick<Manifest, "connect_version">,
): HandshakeResult {
  const localMajor = majorVersion(local.connect_version);
  const peerMajor = majorVersion(peer.connect_version);

  if (localMajor === null || peerMajor === null) {
    return { accepted: false, reason: "Invalid connect version" };
  }

  if (localMajor !== peerMajor) {
    return {
      accepted: false,
      reason: `Incompatible connect version: ${local.connect_version} and ${peer.connect_version}`,
    };
  }

  return { accepted: true };
}

type ManifestValidation =
  | { valid: true; app_id: string; manifest: Manifest }
  | { valid: false; app_id: string; reason: string };

function manifestArrayError(
  candidate: Record<string, unknown>,
  field: "capabilities" | "permissions",
): string | undefined {
  const entries = candidate[field];
  if (!Array.isArray(entries)) {
    return `Manifest ${field} must be an array`;
  }

  const seen = new Set<string>();
  for (const entry of entries) {
    if (typeof entry !== "string" || entry.trim() === "") {
      return `Manifest ${field} entries must be non-empty strings`;
    }
    if (seen.has(entry)) {
      return `Manifest ${field} must not contain duplicate entries`;
    }
    seen.add(entry);
  }
  return undefined;
}

function validateManifest(value: unknown): ManifestValidation {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, app_id: "", reason: "Manifest must be an object" };
  }

  const candidate = value as Record<string, unknown>;
  const appIdValue = candidate.app_id;
  const appId = typeof appIdValue === "string" ? appIdValue : "";
  if (appId.trim() === "") {
    return {
      valid: false,
      app_id: "",
      reason: "Manifest app_id must be a non-empty string",
    };
  }

  const connectVersion = candidate.connect_version;
  if (typeof connectVersion !== "string" || connectVersion.trim() === "") {
    return {
      valid: false,
      app_id: appId,
      reason: "Manifest connect_version must be a non-empty string",
    };
  }

  const capabilitiesError = manifestArrayError(candidate, "capabilities");
  if (capabilitiesError !== undefined) {
    return { valid: false, app_id: appId, reason: capabilitiesError };
  }
  const permissionsError = manifestArrayError(candidate, "permissions");
  if (permissionsError !== undefined) {
    return { valid: false, app_id: appId, reason: permissionsError };
  }

  return {
    valid: true,
    app_id: appId,
    manifest: candidate as unknown as Manifest,
  };
}

function rejectedPairing(peerAppId: string, reason: string): PairingResult {
  return {
    accepted: false,
    peer_app_id: peerAppId,
    mode: "share-only",
    adopted_capabilities: [],
    moved_data: false,
    reason,
  };
}

interface StreamState {
  nextPosition: number;
  latestCursor: Cursor | null;
  positions: Map<Cursor, number>;
  deltas: Delta[];
  byEventId: Map<string, Delta>;
}

/**
 * Volatile protocol/test adapter. It intentionally has no production
 * persistence or durability guarantees.
 */
export class InMemoryProtocolTestAdapter {
  private readonly streams = new Map<string, StreamState>();
  private readonly inbox = new Set<string>();
  private readonly proposals = new Map<string, Proposal>();

  private stream(capability: string): StreamState {
    let state = this.streams.get(capability);
    if (state === undefined) {
      state = {
        nextPosition: 0,
        latestCursor: null,
        positions: new Map<Cursor, number>(),
        deltas: [],
        byEventId: new Map<string, Delta>(),
      };
      this.streams.set(capability, state);
    }
    return state;
  }

  snapshot(capability: string, data: unknown): Snapshot {
    const state = this.stream(capability);
    const position = state.nextPosition;
    state.nextPosition += 1;
    const cursor = randomUUID();
    state.positions.set(cursor, position);
    state.latestCursor = cursor;
    return { type: "snapshot", capability, data, cursor };
  }

  appendDelta(capability: string, change: unknown, eventId = randomUUID()): Delta {
    const state = this.stream(capability);
    const existing = state.byEventId.get(eventId);
    if (existing !== undefined) {
      if (existing.capability !== capability) {
        throw new Error("event_id is already used by another capability");
      }
      return existing;
    }

    const previousCursor = state.latestCursor;
    const position = state.nextPosition;
    state.nextPosition += 1;
    const cursor = randomUUID();
    const delta: Delta = {
      type: "delta",
      event_id: eventId,
      capability,
      previous_cursor: previousCursor,
      cursor,
      change,
    };
    state.positions.set(cursor, position);
    state.latestCursor = cursor;
    state.deltas.push(delta);
    state.byEventId.set(eventId, delta);
    return delta;
  }

  deltasSince(capability: string, cursor: Cursor): Delta[] {
    const state = this.stream(capability);
    const from = state.positions.get(cursor);
    if (from === undefined) {
      throw new Error("Unknown or expired cursor");
    }
    return state.deltas.filter((delta) => (state.positions.get(delta.cursor) ?? -1) > from);
  }

  /** Returns false when the same event_id has already been accepted. */
  receive(delta: Delta): boolean {
    if (
      delta === null ||
      typeof delta !== "object" ||
      typeof delta.event_id !== "string" ||
      delta.event_id.trim() === ""
    ) {
      throw new Error("An event_id is required");
    }
    if (this.inbox.has(delta.event_id)) {
      return false;
    }
    this.inbox.add(delta.event_id);
    return true;
  }

  createProposal(input: {
    capability: string;
    requester: string;
    change: unknown;
  }): Proposal {
    const proposal: Proposal = {
      id: randomUUID(),
      capability: input.capability,
      requester: input.requester,
      change: input.change,
      status: "pending",
    };
    this.proposals.set(proposal.id, proposal);
    return proposal;
  }

  getProposal(id: string): Proposal | undefined {
    return this.proposals.get(id);
  }

  resolveProposal(id: string, decision: ProposalDecision, reason: string): Proposal {
    const proposal = this.proposals.get(id);
    if (proposal === undefined) {
      throw new Error("Proposal not found");
    }
    if (proposal.status !== "pending") {
      throw new Error("Only pending proposals can transition");
    }
    const normalizedReason = reason.trim();
    if (normalizedReason === "") {
      throw new Error("A proposal decision requires a reason");
    }

    const resolved: Proposal = {
      ...proposal,
      status: decision,
      reason: normalizedReason,
    };
    this.proposals.set(id, resolved);
    return resolved;
  }
}

/** A small, dependency-free protocol kernel for Atlas products. */
export class ProtocolKernel {
  readonly manifest: Manifest;
  private readonly adapter: InMemoryProtocolTestAdapter;
  private readonly pairedPeers = new Map<string, Manifest>();
  private readonly authorities = new Map<string, Map<string, AuthorityRole>>();

  constructor(manifest: Manifest) {
    this.manifest = {
      ...manifest,
      capabilities: [...manifest.capabilities],
      permissions: [...manifest.permissions],
    };
    this.adapter = new InMemoryProtocolTestAdapter();
  }

  pair(peer: unknown): PairingResult {
    try {
      const validation = validateManifest(peer);
      if (!validation.valid) {
        return rejectedPairing(validation.app_id, validation.reason);
      }

      const result = handshake(this.manifest, validation.manifest);
      if (!result.accepted) {
        return rejectedPairing(
          validation.app_id,
          result.reason ?? "Connect version handshake rejected",
        );
      }

      this.pairedPeers.set(validation.app_id, {
        ...validation.manifest,
        capabilities: [...validation.manifest.capabilities],
        permissions: [...validation.manifest.permissions],
      });
      return {
        accepted: true,
        peer_app_id: validation.app_id,
        mode: "share-only",
        adopted_capabilities: [],
        moved_data: false,
      };
    } catch {
      return rejectedPairing("", "Manifest could not be validated");
    }
  }

  setAuthority(capability: string, peerAppId: string, role: AuthorityRole): this {
    this.assertKnownCapability(capability);
    if (!this.pairedPeers.has(peerAppId)) {
      throw new Error("Peer must be paired before receiving authority");
    }
    if (!AUTHORITY_ROLES.includes(role)) {
      throw new Error("Unknown authority role");
    }

    let roles = this.authorities.get(capability);
    if (roles === undefined) {
      roles = new Map<string, AuthorityRole>();
      this.authorities.set(capability, roles);
    }

    const currentMaster = [...roles.entries()].find(([, currentRole]) => currentRole === "master")?.[0];
    if (role === "master" && currentMaster !== undefined && currentMaster !== peerAppId) {
      throw new Error(`Capability "${capability}" already has master "${currentMaster}"`);
    }
    if (role !== "master" && currentMaster === undefined) {
      throw new Error(`Capability "${capability}" needs a master before granting ${role}`);
    }
    if (currentMaster === peerAppId && role !== "master") {
      throw new Error("A capability master cannot be demoted");
    }

    roles.set(peerAppId, role);
    return this;
  }

  getAuthority(capability: string, peerAppId: string): AuthorityRole | undefined {
    return this.authorities.get(capability)?.get(peerAppId);
  }

  snapshot(capability: string, data: unknown): Snapshot {
    this.assertKnownCapability(capability);
    return this.adapter.snapshot(capability, data);
  }

  appendDelta(capability: string, change: unknown, eventId?: string): Delta {
    this.assertKnownCapability(capability);
    return this.adapter.appendDelta(capability, change, eventId);
  }

  deltasSince(capability: string, cursor: Cursor): Delta[] {
    this.assertKnownCapability(capability);
    return this.adapter.deltasSince(capability, cursor);
  }

  receiveDelta(delta: Delta): boolean {
    this.assertKnownCapability(delta.capability);
    return this.adapter.receive(delta);
  }

  propose(capability: string, requester: string, change: unknown): Proposal {
    this.assertKnownCapability(capability);
    const role = this.getAuthority(capability, requester);
    if (role !== "master" && role !== "proposer") {
      throw new Error("Only a master or proposer can submit a proposal");
    }
    return this.adapter.createProposal({ capability, requester, change });
  }

  resolveProposal(
    proposalId: string,
    decision: ProposalDecision,
    reason: string,
    decidedBy: string,
  ): Proposal {
    const proposal = this.adapter.getProposal(proposalId);
    if (proposal === undefined) {
      throw new Error("Proposal not found");
    }
    this.assertKnownCapability(proposal.capability);
    if (this.getAuthority(proposal.capability, decidedBy) !== "master") {
      throw new Error("Only the capability master can decide a proposal");
    }
    return this.adapter.resolveProposal(proposalId, decision, reason);
  }

  getProposal(id: string): Proposal | undefined {
    return this.adapter.getProposal(id);
  }

  private assertKnownCapability(capability: string): void {
    if (!this.manifest.capabilities.includes(capability)) {
      throw new Error(`Unknown capability "${capability}"`);
    }
  }
}
