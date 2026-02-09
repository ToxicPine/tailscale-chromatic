// =============================================================================
// Doctor Command - Verify Environment and Infrastructure Health
// =============================================================================

import { parseArgs } from "@std/cli";
import {
  statusOk,
  statusErr,
  bold,
  dim,
} from "../../../lib/cli.ts";
import { runCommand } from "../../../lib/command.ts";
import { registerCommand } from "../mod.ts";
import { loadConfig } from "../../schemas/config.ts";
import { createFlyProvider } from "../../providers/fly.ts";
import {
  createTailscaleProvider,
  isTailscaleInstalled,
  isAcceptRoutesEnabled,
} from "../../providers/tailscale.ts";

// =============================================================================
// Types
// =============================================================================

interface Check {
  name: string;
  run: () => Promise<CheckResult>;
}

interface CheckResult {
  ok: boolean;
  hint?: string;
}

// =============================================================================
// Doctor Command
// =============================================================================

const doctor = async (argv: string[]): Promise<void> => {
  const args = parseArgs(argv, {
    boolean: ["help"],
  });

  if (args.help) {
    console.log(`
${bold("chromatic doctor")} - Verify Environment and Infrastructure Health

${bold("USAGE")}
  chromatic doctor

${bold("DESCRIPTION")}
  Runs a series of checks to verify that your local environment
  and Chromatic infrastructure are properly configured.

${bold("CHECKS")}
  • Tailscale CLI installed
  • Tailscale connected
  • Accept-routes enabled
  • Chromatic configured
  • Router deployed and running
  • Router visible in tailnet
`);
    return;
  }

  console.log();
  console.log(bold("Chromatic Doctor"));
  console.log();

  const config = await loadConfig();

  const checks: Check[] = [
    {
      name: "Tailscale Installed",
      run: async () => ({
        ok: await isTailscaleInstalled(),
        hint: "Install from https://tailscale.com/download",
      }),
    },
    {
      name: "Tailscale Connected",
      run: async () => {
        const result = await runCommand(["tailscale", "status", "--json"]);
        if (!result.success) {
          return { ok: false, hint: "Run: tailscale up" };
        }
        try {
          const status = JSON.parse(result.stdout);
          return {
            ok: status.BackendState === "Running",
            hint: "Run: tailscale up",
          };
        } catch {
          return { ok: false, hint: "Run: tailscale up" };
        }
      },
    },
    {
      name: "Accept Routes Enabled",
      run: async () => ({
        ok: await isAcceptRoutesEnabled(),
        hint: "Run: sudo tailscale set --accept-routes",
      }),
    },
    {
      name: "Chromatic Configured",
      run: async () => ({
        ok: config !== null && config.router !== undefined,
        hint: "Run: chromatic setup",
      }),
    },
    {
      name: "Router Running",
      run: async () => {
        if (!config?.router) {
          return { ok: false, hint: "Run: chromatic setup" };
        }

        const fly = createFlyProvider();
        const machines = await fly.listMachines(config.router.appName);
        const running = machines.filter((m) => m.state === "running").length;

        return {
          ok: running > 0,
          hint: "Run: chromatic router redeploy",
        };
      },
    },
    {
      name: "Router in Tailnet",
      run: async () => {
        if (!config?.router || !config?.tailscale) {
          return { ok: false, hint: "Run: chromatic setup" };
        }

        const tailscale = createTailscaleProvider(
          config.tailscale.tailnet,
          config.tailscale.apiKey
        );
        const device = await tailscale.getDeviceByHostname(config.router.appName);

        return {
          ok: device !== null,
          hint: "Router may still be starting, or check router logs",
        };
      },
    },
  ];

  let issues = 0;

  for (const check of checks) {
    const result = await check.run();

    if (result.ok) {
      statusOk(check.name);
    } else {
      statusErr(check.name);
      if (result.hint) {
        console.log(dim(`    ${result.hint}`));
      }
      issues++;
    }
  }

  console.log();

  if (issues === 0) {
    console.log("All Checks Passed.");
  } else {
    console.log(`${issues} Issue${issues > 1 ? "s" : ""} Found.`);
  }

  console.log();
};

// =============================================================================
// Register Command
// =============================================================================

registerCommand({
  name: "doctor",
  description: "Check that Tailscale and the router are working correctly",
  usage: "chromatic doctor",
  run: doctor,
});
