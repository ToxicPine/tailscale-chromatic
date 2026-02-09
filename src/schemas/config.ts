// =============================================================================
// Configuration Schema
// =============================================================================

import { z } from "zod";
import { getConfigPath, ensureConfigDir, fileExists, die } from "../../lib/cli.ts";

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_REGION = "iad";
const DEFAULT_AUTO_STOP_SECONDS = 300;
const DEFAULT_MACHINE_SIZE = "shared-cpu-1x" as const;
const DEFAULT_MEMORY_MB = 1024;

// =============================================================================
// Machine Size
// =============================================================================

export const MachineSizeEnum = z.enum([
  "shared-cpu-1x",
  "shared-cpu-2x",
  "shared-cpu-4x",
]);

export type MachineSize = z.infer<typeof MachineSizeEnum>;

// =============================================================================
// Fly.io Configuration
// =============================================================================

export const FlyConfigSchema = z.object({
  org: z.string(),
  region: z.string(),
});

export type FlyConfig = z.infer<typeof FlyConfigSchema>;

// =============================================================================
// Tailscale Configuration
// =============================================================================

export const TailscaleConfigSchema = z.object({
  tailnet: z.string(),
  // API access token (tskey-api-...) for authenticating API requests.
  // Not to be confused with auth keys (tskey-auth-...) which are for device registration.
  apiKey: z.string(),
});

export type TailscaleConfig = z.infer<typeof TailscaleConfigSchema>;

// =============================================================================
// Router Configuration
// =============================================================================

export const RouterConfigSchema = z.object({
  appName: z.string(),
  tailscaleIp: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export type RouterConfig = z.infer<typeof RouterConfigSchema>;

// =============================================================================
// Instance Defaults
// =============================================================================

export const InstanceDefaultsSchema = z.object({
  autoStopSeconds: z.number(),
  machineSize: MachineSizeEnum,
  memoryMb: z.number(),
});

export type InstanceDefaults = z.infer<typeof InstanceDefaultsSchema>;

// =============================================================================
// Full Configuration
// =============================================================================

export const ConfigSchema = z.object({
  fly: FlyConfigSchema,
  tailscale: TailscaleConfigSchema,
  router: RouterConfigSchema.optional(),
  defaults: InstanceDefaultsSchema.optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

// =============================================================================
// Default Values
// =============================================================================

export const getDefaultInstanceDefaults = (): InstanceDefaults => ({
  autoStopSeconds: DEFAULT_AUTO_STOP_SECONDS,
  machineSize: DEFAULT_MACHINE_SIZE,
  memoryMb: DEFAULT_MEMORY_MB,
});

export const getDefaultRegion = (): string => DEFAULT_REGION;

// =============================================================================
// Config with Resolved Defaults
// =============================================================================

export interface ResolvedConfig {
  fly: FlyConfig;
  tailscale: TailscaleConfig;
  router: RouterConfig;
  defaults: InstanceDefaults;
}

export const resolveDefaults = (config: Config & { router: RouterConfig }): ResolvedConfig => ({
  fly: config.fly,
  tailscale: config.tailscale,
  router: config.router,
  defaults: config.defaults ?? getDefaultInstanceDefaults(),
});

// =============================================================================
// Config File Operations
// =============================================================================

export const loadConfig = async (): Promise<Config | null> => {
  const path = getConfigPath();
  if (!(await fileExists(path))) {
    return null;
  }

  try {
    const content = await Deno.readTextFile(path);
    const data = JSON.parse(content);
    const result = ConfigSchema.safeParse(data);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
};

export const saveConfig = async (config: Config): Promise<void> => {
  await ensureConfigDir();
  const path = getConfigPath();
  await Deno.writeTextFile(path, JSON.stringify(config, null, 2) + "\n");
};

export const requireConfig = async (): Promise<Config> => {
  const config = await loadConfig();
  if (!config) {
    return die("Not Configured. Run 'chromatic setup' First");
  }
  return config;
};

export const requireRouter = async (): Promise<ResolvedConfig> => {
  const config = await requireConfig();
  if (!config.router) {
    return die("Router Not Configured. Run 'chromatic setup' First");
  }
  return resolveDefaults(config as Config & { router: RouterConfig });
};
