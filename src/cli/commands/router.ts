// =============================================================================
// Router Command - Manage the Subnet Router
// =============================================================================

import { parseArgs } from "@std/cli";
import {
  statusOk,
  statusInfo,
  statusWarn,
  bold,
  dim,
  green,
  red,
  yellow,
  confirm,
  Spinner,
  die,
} from "../../../lib/cli.ts";
import { registerCommand } from "../mod.ts";
import {
  loadConfig,
  saveConfig,
  requireConfig,
} from "../../schemas/config.ts";
import { createFlyProvider } from "../../providers/fly.ts";
import { createTailscaleProvider, waitForDevice } from "../../providers/tailscale.ts";

// =============================================================================
// Router Command
// =============================================================================

const router = async (argv: string[]): Promise<void> => {
  const args = parseArgs(argv, {
    boolean: ["help", "yes"],
    alias: { y: "yes" },
  });

  const subcommand = args._[0] as string | undefined;

  if (args.help || !subcommand) {
    console.log(`
${bold("chromatic router")} - Manage the Subnet Router

${bold("USAGE")}
  chromatic router <subcommand> [options]

${bold("SUBCOMMANDS")}
  status      Show router status
  redeploy    Redeploy the router (after Dockerfile changes)
  destroy     Remove the router from Fly.io and Tailscale
  logs        Show router logs

${bold("OPTIONS")}
  -y, --yes   Skip confirmation prompts

${bold("EXAMPLES")}
  chromatic router status
  chromatic router redeploy
  chromatic router destroy
  chromatic router logs
`);
    return;
  }

  switch (subcommand) {
    case "status":
      await routerStatus();
      break;
    case "redeploy":
      await routerRedeploy();
      break;
    case "destroy":
      await routerDestroy(args.yes);
      break;
    case "logs":
      await routerLogs();
      break;
    default:
      return die(`Unknown Subcommand: ${subcommand}`);
  }
};

// =============================================================================
// Router Status
// =============================================================================

const routerStatus = async (): Promise<void> => {
  const config = await loadConfig();

  if (!config?.router) {
    return die("Router Not Configured. Run 'chromatic setup' First");
  }

  const fly = createFlyProvider();
  const tailscale = createTailscaleProvider(config.tailscale.tailnet, config.tailscale.apiKey);

  console.log();
  console.log(bold("Router Status"));
  console.log();

  // Check Fly app
  const appExists = await fly.appExists(config.router.appName);
  if (appExists) {
    statusOk(`Fly App: ${config.router.appName}`);
  } else {
    statusWarn(`Fly App: ${config.router.appName} (not found)`);
  }

  // Check machines
  if (appExists) {
    const machines = await fly.listMachines(config.router.appName);
    const running = machines.filter(m => m.state === "running").length;
    const total = machines.length;

    if (running > 0) {
      console.log(`  Machines: ${green(`${running}/${total} running`)}`);
    } else if (total > 0) {
      console.log(`  Machines: ${yellow(`0/${total} running`)}`);
    } else {
      console.log(`  Machines: ${red("none")}`);
    }
  }

  // Check Tailscale device
  const device = await tailscale.getDeviceByHostname(config.router.appName);
  if (device) {
    statusOk(`Tailscale: ${device.addresses[0]}`);

    if (device.advertisedRoutes && device.advertisedRoutes.length > 0) {
      console.log(`  Routes: ${device.advertisedRoutes.join(", ")}`);
    }

    if (device.enabledRoutes && device.enabledRoutes.length > 0) {
      console.log(`  Enabled: ${green(device.enabledRoutes.join(", "))}`);
    }
  } else {
    statusWarn("Tailscale: Device Not Found");
  }

  console.log();
};

// =============================================================================
// Router Redeploy
// =============================================================================

const routerRedeploy = async (): Promise<void> => {
  const config = await requireConfig();

  if (!config.router) {
    return die("Router Not Configured. Run 'chromatic setup' First");
  }

  const fly = createFlyProvider();
  const tailscale = createTailscaleProvider(config.tailscale.tailnet, config.tailscale.apiKey);

  console.log();
  console.log(bold("Redeploying Router"));
  console.log();

  statusInfo(`App: ${config.router.appName}`);

  // Check if app exists
  const appExists = await fly.appExists(config.router.appName);
  if (!appExists) {
    return die(`Router App '${config.router.appName}' Not Found. Run 'chromatic setup' to Create`);
  }

  // Redeploy
  const dockerDir = new URL("../../docker/router", import.meta.url).pathname;

  console.log();
  console.log(dim("Deploying router..."));

  await fly.deploy(config.router.appName, dockerDir, { region: config.fly.region });
  statusOk("Router Deployed");

  // Wait for device to come back online
  const spinner = new Spinner();
  spinner.start("Waiting for router to rejoin tailnet");

  const device = await waitForDevice(tailscale, config.router.appName, 180000);

  spinner.success(`Router Online: ${device.addresses[0]}`);

  // Update config with new IP if changed
  if (device.addresses[0] !== config.router.tailscaleIp) {
    config.router.tailscaleIp = device.addresses[0];
    await saveConfig(config);
    statusInfo("Updated Router IP in Config");

    // Update split DNS for both domains
    await tailscale.setSplitDns("internal", [device.addresses[0]]);
    await tailscale.setSplitDns("flycast", [device.addresses[0]]);
    statusOk("Split DNS Updated (.internal, .flycast)");
  }

  // Clean up stale router devices from previous deployments
  const devices = await tailscale.listDevices();
  const staleDevices = devices.filter(
    (d) =>
      d.id !== device.id &&
      (d.hostname === config.router.appName ||
        d.hostname.startsWith(config.router.appName + "-"))
  );

  if (staleDevices.length > 0) {
    for (const stale of staleDevices) {
      try {
        await tailscale.deleteDevice(stale.id);
      } catch {
        // Ignore errors deleting stale devices
      }
    }
    statusOk(`Cleaned Up ${staleDevices.length} Stale Device(s)`);
  }

  console.log();
  statusOk("Router Redeployed Successfully");
};

// =============================================================================
// Router Destroy
// =============================================================================

const routerDestroy = async (skipConfirm: boolean): Promise<void> => {
  const config = await loadConfig();

  if (!config?.router) {
    return die("Router Not Configured");
  }

  const fly = createFlyProvider();
  const tailscale = createTailscaleProvider(config.tailscale.tailnet, config.tailscale.apiKey);

  console.log();
  console.log(bold("Destroy Router"));
  console.log();

  statusInfo(`App: ${config.router.appName}`);

  if (!skipConfirm) {
    console.log();
    console.log(red("This will:"));
    console.log(red("  - Delete the router app from Fly.io"));
    console.log(red("  - Remove the device from Tailscale"));
    console.log(red("  - Clear split DNS"));
    console.log(red("  - Clear router configuration"));
    console.log();

    const shouldProceed = await confirm("Destroy Router?");
    if (!shouldProceed) {
      console.log("Cancelled.");
      return;
    }
  }

  console.log();

  // Delete Fly app
  const appExists = await fly.appExists(config.router.appName);
  if (appExists) {
    await fly.deleteApp(config.router.appName);
    statusOk("Fly App Deleted");
  } else {
    statusInfo("Fly App Already Deleted");
  }

  // Delete Tailscale device
  const device = await tailscale.getDeviceByHostname(config.router.appName);
  if (device) {
    await tailscale.deleteDevice(device.id);
    statusOk("Tailscale Device Removed");
  } else {
    statusInfo("Tailscale Device Already Removed");
  }

  // Clear split DNS for .internal and .flycast
  try {
    await tailscale.clearSplitDns("internal");
    await tailscale.clearSplitDns("flycast");
    statusOk("Split DNS Cleared (.internal, .flycast)");
  } catch {
    statusInfo("Split DNS Already Cleared");
  }

  // Clear router config
  config.router = undefined;
  await saveConfig(config);
  statusOk("Configuration Cleared");

  console.log();
  statusOk("Router Destroyed");
  console.log();
  console.log(dim("Run 'chromatic setup' to create a new router."));
  console.log();
};

// =============================================================================
// Router Logs
// =============================================================================

const routerLogs = async (): Promise<void> => {
  const config = await loadConfig();

  if (!config?.router) {
    return die("Router Not Configured. Run 'chromatic setup' First");
  }

  console.log();
  console.log(dim(`Fetching logs for ${config.router.appName}...`));
  console.log();

  // Use Deno.Command to run fly logs interactively
  const command = new Deno.Command("fly", {
    args: ["logs", "-a", config.router.appName, "--no-tail"],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  const process = command.spawn();
  const status = await process.status;

  if (!status.success) {
    return die("Failed to Fetch Logs");
  }
};

// =============================================================================
// Register Command
// =============================================================================

registerCommand({
  name: "router",
  description: "Manage the Tailscale subnet router (status, redeploy, destroy)",
  usage: "chromatic router <status|redeploy|destroy|logs>",
  run: router,
});
