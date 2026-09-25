import { CONNECT_VERSION } from "./protocol.ts";
import type { Manifest } from "./protocol.ts";

export interface CapabilityGrant {
  capability: string;
  permissions: readonly string[];
}

export interface ClusterRegistration {
  id: string;
  name?: string;
}

export interface PluginRegistration {
  id: string;
  cluster_id: string;
  name?: string;
  capabilities?: readonly CapabilityGrant[];
}

export interface ModuleRegistration {
  id: string;
  plugin_id: string;
  name?: string;
  capabilities?: readonly CapabilityGrant[];
}

export interface RegistryOptions {
  app_id: string;
  connect_version: string;
}

function assertId(value: string, label: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function normalizeGrants(grants: readonly CapabilityGrant[] | undefined, label: string): CapabilityGrant[] {
  if (grants === undefined) {
    return [];
  }
  if (!Array.isArray(grants)) {
    throw new Error(`${label} capabilities must be an array`);
  }

  return grants.map((grant) => {
    assertId(grant.capability, `${label} capability`);
    if (!Array.isArray(grant.permissions)) {
      throw new Error(`Permissions for "${grant.capability}" must be an array`);
    }
    const permissions = grant.permissions.map((permission) => {
      assertId(permission, `Permission for "${grant.capability}"`);
      return permission;
    });
    return { capability: grant.capability, permissions: [...new Set(permissions)] };
  });
}

/** The standalone core -> cluster -> plugin -> module registry. */
export class Registry {
  private readonly appId: string;
  private readonly connectVersion: string;
  private readonly clusters = new Map<string, ClusterRegistration>();
  private readonly plugins = new Map<string, PluginRegistration>();
  private readonly modules = new Map<string, ModuleRegistration>();

  constructor(options: RegistryOptions) {
    assertId(options.app_id, "app_id");
    assertId(options.connect_version, "connect_version");
    this.appId = options.app_id;
    this.connectVersion = options.connect_version;
  }

  registerCluster(cluster: ClusterRegistration): this {
    assertId(cluster.id, "Cluster id");
    if (this.clusters.has(cluster.id)) {
      throw new Error(`Cluster "${cluster.id}" is already registered`);
    }
    this.clusters.set(cluster.id, { ...cluster, name: cluster.name ?? cluster.id });
    return this;
  }

  registerPlugin(plugin: PluginRegistration): this {
    assertId(plugin.id, "Plugin id");
    assertId(plugin.cluster_id, "Plugin cluster_id");
    if (!this.clusters.has(plugin.cluster_id)) {
      throw new Error(`Unknown parent cluster "${plugin.cluster_id}"`);
    }
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Plugin "${plugin.id}" is already registered`);
    }
    this.plugins.set(plugin.id, {
      ...plugin,
      name: plugin.name ?? plugin.id,
      capabilities: normalizeGrants(plugin.capabilities, "Plugin"),
    });
    return this;
  }

  registerModule(module: ModuleRegistration): this {
    assertId(module.id, "Module id");
    assertId(module.plugin_id, "Module plugin_id");
    if (!this.plugins.has(module.plugin_id)) {
      throw new Error(`Unknown parent plugin "${module.plugin_id}"`);
    }
    if (this.modules.has(module.id)) {
      throw new Error(`Module "${module.id}" is already registered`);
    }
    this.modules.set(module.id, {
      ...module,
      name: module.name ?? module.id,
      capabilities: normalizeGrants(module.capabilities, "Module"),
    });
    return this;
  }

  manifest(): Manifest {
    const capabilities = new Set<string>();
    const permissions = new Set<string>();
    const collect = (grants: readonly CapabilityGrant[]): void => {
      for (const grant of grants) {
        capabilities.add(grant.capability);
        for (const permission of grant.permissions) {
          permissions.add(permission);
        }
      }
    };

    for (const plugin of this.plugins.values()) {
      collect(plugin.capabilities ?? []);
    }
    for (const module of this.modules.values()) {
      collect(module.capabilities ?? []);
    }

    return {
      app_id: this.appId,
      connect_version: this.connectVersion,
      capabilities: [...capabilities].sort(),
      permissions: [...permissions].sort(),
    };
  }
}

export const ECOM_CAPABILITIES = [
  "catalog",
  "orders",
  "presentation",
  "cart",
  "checkout",
  "payment",
] as const;
export type EcomCapability = (typeof ECOM_CAPABILITIES)[number];

export const ECOM_CAPABILITY_PERMISSIONS: Readonly<
  Record<EcomCapability, readonly string[]>
> = {
  catalog: ["catalog:read", "catalog:write"],
  orders: ["orders:read", "orders:write"],
  presentation: ["presentation:read", "presentation:write"],
  cart: ["cart:read", "cart:write"],
  checkout: ["checkout:read", "checkout:write"],
  payment: ["payment:read", "payment:write"],
};

/** Build Ecom's local commerce hierarchy without requiring a peer. */
export function createEcomRegistry(): Registry {
  const registry = new Registry({ app_id: "atlas-ecom", connect_version: CONNECT_VERSION });
  registry.registerCluster({ id: "commerce", name: "Commerce" });
  registry.registerPlugin({
    id: "commerce-core",
    cluster_id: "commerce",
    name: "Commerce core",
    capabilities: [
      {
        capability: "presentation",
        permissions: ECOM_CAPABILITY_PERMISSIONS.presentation,
      },
    ],
  });

  for (const capability of ECOM_CAPABILITIES) {
    if (capability === "presentation") {
      continue;
    }
    registry.registerModule({
      id: `${capability}-module`,
      plugin_id: "commerce-core",
      name: `${capability} module`,
      capabilities: [
        {
          capability,
          permissions: ECOM_CAPABILITY_PERMISSIONS[capability],
        },
      ],
    });
  }

  return registry;
}
