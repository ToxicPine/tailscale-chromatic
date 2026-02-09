// =============================================================================
// Fly.io Provider - Wraps flyctl CLI
// =============================================================================

import { runCommand, runQuiet } from "../../lib/command.ts";
import { commandExists, die, Spinner } from "../../lib/cli.ts";
import {
  FlyAuthSchema,
  FlyStatusSchema,
  FlyMachinesListSchema,
  FlyAppsListSchema,
  FlyOrgsSchema,
  mapFlyMachineState,
  mapFlyMachineSize,
  type FlyMachine,
  type FlyApp,
} from "../schemas/fly.ts";
import { type Machine } from "../schemas/instance.ts";
import { type MachineSize } from "../schemas/config.ts";

// =============================================================================
// Constants
// =============================================================================

const CDP_APP_PREFIX = "chromatic-cdp-";
const ROUTER_APP_PREFIX = "chromatic-router-";

// =============================================================================
// Machine Configuration
// =============================================================================

export interface MachineConfig {
  size: MachineSize;
  memoryMb?: number;
  region?: string;
  autoStopSeconds?: number;
}

const getSizeConfig = (size: MachineSize): { cpus: number; memoryMb: number } => {
  switch (size) {
    case "shared-cpu-1x":
      return { cpus: 1, memoryMb: 1024 };
    case "shared-cpu-2x":
      return { cpus: 2, memoryMb: 2048 };
    case "shared-cpu-4x":
      return { cpus: 4, memoryMb: 4096 };
  }
};

// =============================================================================
// Fly Provider Interface
// =============================================================================

export interface FlyProvider {
  ensureInstalled(): Promise<void>;
  ensureAuth(): Promise<string>;
  listOrgs(): Promise<Record<string, string>>;
  createApp(name: string, org: string): Promise<void>;
  deleteApp(name: string): Promise<void>;
  listApps(org?: string): Promise<FlyApp[]>;
  appExists(name: string): Promise<boolean>;
  listMachines(app: string): Promise<Machine[]>;
  createMachine(app: string, config: MachineConfig): Promise<Machine>;
  destroyMachine(app: string, machineId: string): Promise<void>;
  setSecrets(app: string, secrets: Record<string, string>, options?: { stage?: boolean }): Promise<void>;
  deploy(app: string, dockerfilePath: string, config?: { region?: string }): Promise<void>;
  getFlycastIp(app: string): Promise<string | null>;
}

// =============================================================================
// Create Fly Provider
// =============================================================================

export const createFlyProvider = (): FlyProvider => {
  return {
    async ensureInstalled(): Promise<void> {
      if (!(await commandExists("fly"))) {
        return die("Flyctl Not Found. Install from https://fly.io/docs/flyctl/install/");
      }
    },

    async ensureAuth(): Promise<string> {
      const result = await runCommand(["fly", "auth", "whoami", "--json"]);

      if (result.success) {
        try {
          const parsed = FlyAuthSchema.safeParse(JSON.parse(result.stdout));
          if (parsed.success) {
            return parsed.data.email;
          }
        } catch {
          // Parse failed, need to authenticate
        }
      }

      // Not authenticated - trigger login
      const loginResult = await runCommand(["fly", "auth", "login"]);
      if (!loginResult.success) {
        return die("Fly.io Authentication Failed");
      }

      // Verify authentication
      const checkResult = await runCommand(["fly", "auth", "whoami", "--json"]);
      if (!checkResult.success) {
        return die("Fly.io Authentication Verification Failed");
      }

      const parsed = FlyAuthSchema.safeParse(JSON.parse(checkResult.stdout));
      if (!parsed.success || !parsed.data) {
        return die("Fly.io Authentication Response Invalid");
      }

      return parsed.data.email;
    },

    async listOrgs(): Promise<Record<string, string>> {
      const result = await runCommand(["fly", "orgs", "list", "--json"]);
      if (!result.success) {
        return die("Failed to List Organizations");
      }

      const parsed = FlyOrgsSchema.safeParse(JSON.parse(result.stdout));
      if (!parsed.success || !parsed.data) {
        return die("Failed to Parse Organizations");
      }

      return parsed.data;
    },

    async createApp(name: string, org: string): Promise<void> {
      const result = await runQuiet("Creating App", [
        "fly", "apps", "create", name, "--org", org,
      ]);

      if (!result.success) {
        return die(`Failed to Create App '${name}'`);
      }
    },

    async deleteApp(name: string): Promise<void> {
      const result = await runQuiet("Deleting App", [
        "fly", "apps", "destroy", name, "--yes",
      ]);

      if (!result.success) {
        return die(`Failed to Delete App '${name}'`);
      }
    },

    async listApps(org?: string): Promise<FlyApp[]> {
      const args = ["fly", "apps", "list", "--json"];
      if (org) {
        args.push("--org", org);
      }

      const result = await runCommand(args);
      if (!result.success) {
        return [];
      }

      try {
        const parsed = FlyAppsListSchema.safeParse(JSON.parse(result.stdout));
        return parsed.success ? parsed.data : [];
      } catch {
        return [];
      }
    },

    async appExists(name: string): Promise<boolean> {
      const result = await runCommand(["fly", "status", "-a", name, "--json"]);
      if (!result.success) return false;

      try {
        const parsed = FlyStatusSchema.safeParse(JSON.parse(result.stdout));
        return parsed.success && !!parsed.data.ID;
      } catch {
        return false;
      }
    },

    async listMachines(app: string): Promise<Machine[]> {
      const result = await runCommand(["fly", "machines", "list", "-a", app, "--json"]);
      if (!result.success) {
        return [];
      }

      try {
        const parsed = FlyMachinesListSchema.safeParse(JSON.parse(result.stdout));
        if (!parsed.success) {
          return [];
        }

        return parsed.data.map((m: FlyMachine): Machine => ({
          id: m.id,
          state: mapFlyMachineState(m.state),
          size: mapFlyMachineSize(m.config?.guest),
          region: m.region,
          privateIp: m.private_ip,
        }));
      } catch {
        return [];
      }
    },

    async createMachine(app: string, config: MachineConfig): Promise<Machine> {
      // Get existing machines to find one to clone
      const existingMachines = await this.listMachines(app);

      if (existingMachines.length === 0) {
        return die("No Existing Machine to Clone. Run 'fly deploy' First");
      }

      const sourceMachine = existingMachines[0];
      const sizeConfig = getSizeConfig(config.size);
      const memoryMb = config.memoryMb ?? sizeConfig.memoryMb;

      const args = [
        "fly", "machine", "clone", sourceMachine.id,
        "-a", app,
        "--vm-cpus", String(sizeConfig.cpus),
        "--vm-memory", String(memoryMb),
      ];

      if (config.region) {
        args.push("--region", config.region);
      }

      const spinner = new Spinner();
      spinner.start(`Creating ${config.size} Machine`);

      const result = await runCommand(args);

      if (!result.success) {
        spinner.fail("Machine Creation Failed");
        return die(result.stderr || "Unknown Error");
      }

      spinner.success(`Created ${config.size} Machine`);

      const machines = await this.listMachines(app);
      const newest = machines[machines.length - 1];

      if (!newest) {
        return die("Created Machine Not Found");
      }

      return newest;
    },

    async destroyMachine(app: string, machineId: string): Promise<void> {
      const shortId = machineId.slice(0, 8);
      const result = await runQuiet(`Destroying Machine ${shortId}`, [
        "fly", "machines", "destroy", machineId, "-a", app, "--force",
      ]);

      if (!result.success) {
        return die(`Failed to Destroy Machine '${shortId}'`);
      }
    },

    async setSecrets(app: string, secrets: Record<string, string>, options?: { stage?: boolean }): Promise<void> {
      const pairs = Object.entries(secrets)
        .filter(([_, v]) => v !== undefined && v !== "")
        .map(([k, v]) => `${k}=${v}`);

      if (pairs.length === 0) return;

      const args = ["fly", "secrets", "set", ...pairs, "-a", app];

      // Use --stage to set secrets without triggering immediate deploy
      if (options?.stage) {
        args.push("--stage");
      }

      const result = await runQuiet(
        `Setting ${pairs.length} Secret(s)`,
        args
      );

      if (!result.success) {
        return die("Failed to Set Secrets");
      }
    },

    async deploy(
      app: string,
      dockerDir: string,
      config?: { region?: string }
    ): Promise<void> {
      // Deploy from the directory containing Dockerfile
      // All Chromatic apps are private-only (Flycast + no public IPs)
      const args = [
        "fly", "deploy", dockerDir,
        "-a", app,
        "--yes",           // Accept prompts
        "--ha=false",      // Single machine initially
        "--flycast",       // Allocate private Flycast IPv6
        "--no-public-ips", // No public internet access
      ];

      if (config?.region) {
        args.push("--primary-region", config.region);
      }

      console.log(`Deploying ${app}...`);
      const result = await runCommand(args);

      if (!result.success) {
        console.error(result.stderr);
        return die(`Deploy Failed for '${app}'`);
      }
    },

    async getFlycastIp(app: string): Promise<string | null> {
      const result = await runCommand(["fly", "ips", "list", "-a", app, "--json"]);
      if (!result.success) return null;

      try {
        const ips = JSON.parse(result.stdout) as Array<{ Address: string; Type: string }>;
        const flycast = ips.find((ip) => ip.Type === "private_v6");
        return flycast?.Address ?? null;
      } catch {
        return null;
      }
    },
  };
};

// =============================================================================
// CDP App Naming
// =============================================================================

export const isCdpApp = (appName: string): boolean => {
  return appName.startsWith(CDP_APP_PREFIX);
};

export const getCdpAppName = (instanceName: string, randomSuffix: string): string => {
  return `${CDP_APP_PREFIX}${instanceName}-${randomSuffix}`;
};

export const getInstanceNameFromApp = (appName: string): string | null => {
  if (!isCdpApp(appName)) return null;
  const rest = appName.slice(CDP_APP_PREFIX.length);
  const parts = rest.split("-");
  if (parts.length < 2) return rest;
  return parts.slice(0, -1).join("-");
};

// =============================================================================
// Router App Naming
// =============================================================================

export const isRouterApp = (appName: string): boolean => {
  return appName.startsWith(ROUTER_APP_PREFIX);
};

export const getRouterAppName = (randomSuffix: string): string => {
  return `${ROUTER_APP_PREFIX}${randomSuffix}`;
};
