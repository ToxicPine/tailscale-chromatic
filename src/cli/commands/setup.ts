// =============================================================================
// Setup Command - Initialize Chromatic
// =============================================================================

import { parseArgs } from "@std/cli";
import {
  statusOk,
  statusErr,
  statusInfo,
  statusWarn,
  bold,
  dim,
  yellow,
  prompt,
  readSecret,
  randomId,
  Spinner,
  die,
} from "../../../lib/cli.ts";
import { runCommand } from "../../../lib/command.ts";
import { registerCommand } from "../mod.ts";
import {
  loadConfig,
  saveConfig,
  type Config,
  type FlyConfig,
  type TailscaleConfig,
  type RouterConfig,
} from "../../schemas/config.ts";
import { createFlyProvider, getRouterAppName } from "../../providers/fly.ts";
import {
  createTailscaleProvider,
  waitForDevice,
  isTailscaleInstalled,
  isAcceptRoutesEnabled,
  enableAcceptRoutes,
} from "../../providers/tailscale.ts";

// =============================================================================
// Setup Command
// =============================================================================

const setup = async (argv: string[]): Promise<void> => {
  const args = parseArgs(argv, {
    string: ["tags", "org", "region", "api-key"],
    boolean: ["help", "yes"],
    alias: { y: "yes" },
  });

  if (args.help) {
    console.log(`
${bold("chromatic setup")} - Initialize Chromatic

${bold("USAGE")}
  chromatic setup [options]

${bold("OPTIONS")}
  --tags <tags>       Tailscale ACL tags for the router (comma-separated)
  --org <org>         Fly.io organization slug
  --region <region>   Fly.io region (default: iad)
  --api-key <key>     Tailscale API access token (tskey-api-...)
  -y, --yes           Skip confirmation prompts

${bold("DESCRIPTION")}
  Sets up Chromatic by:
  1. Configuring Fly.io credentials
  2. Configuring Tailscale API access
  3. Deploying the subnet router
  4. Enabling subnet routes and split DNS

${bold("EXAMPLES")}
  chromatic setup
  chromatic setup --tags tag:browsers,tag:automation
  chromatic setup --org my-org --region sea
  chromatic setup --org my-org --api-key tskey-api-... --yes
`);
    return;
  }

  console.log();
  console.log(bold("=".repeat(50)));
  console.log(bold("  Chromatic Setup"));
  console.log(bold("=".repeat(50)));
  console.log();

  // Check for existing config
  const existingConfig = await loadConfig();
  if (existingConfig?.router) {
    statusInfo(`Existing Configuration Found`);
    console.log(dim(`  Router: ${existingConfig.router.appName}`));
    console.log();

    if (!args.yes) {
      const answer = await prompt("Reconfigure? [y/N] ");
      if (answer.toLowerCase() !== "y") {
        console.log("Cancelled.");
        return;
      }
      console.log();
    }
  }

  // ==========================================================================
  // Step 1: Fly.io Authentication
  // ==========================================================================

  console.log(bold("Step 1: Fly.io Configuration"));
  console.log();

  const fly = createFlyProvider();
  await fly.ensureInstalled();

  const email = await fly.ensureAuth();
  statusOk(`Authenticated as ${email}`);

  // Get organization
  let org = args.org;
  if (!org) {
    const orgs = await fly.listOrgs();
    const orgSlugs = Object.keys(orgs);

    if (orgSlugs.length === 0) {
      return die("No Fly.io Organizations Found");
    }

    if (orgSlugs.length === 1) {
      org = orgSlugs[0];
      statusOk(`Using Organization: ${org}`);
    } else {
      console.log("Available organizations:");
      for (const [slug, name] of Object.entries(orgs)) {
        console.log(`  ${slug} - ${name}`);
      }
      org = await prompt("Organization slug: ");
      if (!orgSlugs.includes(org)) {
        return die(`Invalid Organization: ${org}`);
      }
    }
  }

  // Get region
  const region = args.region || "iad";
  statusOk(`Using Region: ${region}`);

  // Network Bridging Warning
  console.log();
  console.log(yellow("Network Bridging"));
  console.log(dim("  The Router Will Bridge the '") + org + dim("' Fly.io Org's Private Network"));
  console.log(dim("  to Your Tailscale Tailnet. All Apps in This Org Become Accessible"));
  console.log(dim("  From Your Tailnet Devices, Not Just Chromatic Browsers."));
  console.log(dim("  For Isolation, Create a Dedicated Linked Org at fly.io/dashboard"));
  console.log(dim("  and Re-Run: chromatic setup --org <new-org>"));

  const flyConfig: FlyConfig = { org, region };
  console.log();

  // ==========================================================================
  // Step 2: Tailscale Configuration
  // ==========================================================================

  console.log(bold("Step 2: Tailscale Configuration"));
  console.log();

  let apiKey = args["api-key"];
  if (!apiKey) {
    console.log(dim("Chromatic needs an API access token (not an auth key) to manage your tailnet."));
    console.log(dim("Create one at: https://login.tailscale.com/admin/settings/keys"));
    console.log(dim("Select 'Generate API access token' with at least 90 days expiry."));
    console.log();

    apiKey = await readSecret("API access token (tskey-api-...): ");
    if (!apiKey) {
      return die("Tailscale API Access Token Required");
    }
  }

  if (!apiKey.startsWith("tskey-api-")) {
    console.log();
    return die("Invalid Token Format. Expected 'tskey-api-...' (API access token, not auth key)");
  }

  // Use "-" to refer to the default tailnet
  const tailnet = "-";
  const tailscale = createTailscaleProvider(tailnet, apiKey);

  const spinner = new Spinner();
  spinner.start("Validating API Access Token");

  const isValid = await tailscale.validateApiKey();
  if (!isValid) {
    spinner.fail("Invalid API Access Token");
    return die("Failed to Validate Tailscale API Access Token");
  }

  spinner.success("API Access Token Validated");

  const tailscaleConfig: TailscaleConfig = { tailnet, apiKey };
  console.log();

  // ==========================================================================
  // Step 3: Deploy Router
  // ==========================================================================

  console.log(bold("Step 3: Deploy Subnet Router"));
  console.log();

  // Parse tags
  const tags = args.tags
    ? args.tags.split(",").map((t: string) => t.trim()).filter((t: string) => t)
    : undefined;

  if (tags && tags.length > 0) {
    statusInfo(`Router Tags: ${tags.join(", ")}`);
  }

  // Create router app
  const routerAppName = getRouterAppName(randomId(6));
  statusInfo(`Creating Router App: ${routerAppName}`);

  await fly.createApp(routerAppName, org);
  statusOk(`Created App: ${routerAppName}`);

  // Set secrets on the router app (staged, deploy will pick them up)
  // Router uses API token to self-configure (create auth key, approve routes)
  await fly.setSecrets(routerAppName, {
    TAILSCALE_API_TOKEN: apiKey,
  }, { stage: true });
  statusOk("Set Router Secrets");

  // Deploy the router
  const dockerDir = new URL("../../docker/router", import.meta.url).pathname;

  console.log();
  console.log(dim("Deploying router..."));

  await fly.deploy(routerAppName, dockerDir, { region });
  statusOk("Router Deployed");

  // Wait for device to appear in tailnet
  // Router self-approves routes via API, but we need its IP for split DNS
  console.log();
  spinner.start("Waiting for router to join tailnet");

  const device = await waitForDevice(tailscale, routerAppName, 180000);

  spinner.success(`Router joined tailnet: ${device.addresses[0]}`);

  // Verify routes are approved (router self-approves, but let's confirm)
  if (device.advertisedRoutes && device.advertisedRoutes.length > 0) {
    statusOk(`Routes: ${device.advertisedRoutes.join(", ")}`);
  } else {
    statusInfo("Routes Pending (Router Will Self-Approve)");
  }

  // Configure split DNS for .internal and .flycast domains
  spinner.start("Configuring Split DNS");

  await tailscale.setSplitDns("internal", [device.addresses[0]]);
  await tailscale.setSplitDns("flycast", [device.addresses[0]]);

  spinner.success("Split DNS Configured (.internal, .flycast)");

  // ==========================================================================
  // Step 4: Enable Accept Routes on Local Client
  // ==========================================================================

  console.log();
  console.log(bold("Step 4: Local Client Configuration"));
  console.log();

  if (await isTailscaleInstalled()) {
    if (await isAcceptRoutesEnabled()) {
      statusOk("Accept Routes Already Enabled");
    } else {
      spinner.start("Enabling Accept Routes");

      if (await enableAcceptRoutes()) {
        spinner.success("Accept Routes Enabled");
      } else {
        spinner.fail("Could Not Enable Accept Routes");
        console.log();
        console.log(dim("Run Manually with Elevated Permissions:"));
        console.log(dim("  sudo tailscale set --accept-routes"));
      }
    }
  } else {
    statusWarn("Tailscale CLI Not Found");
    console.log(dim("  Ensure Accept-Routes Is Enabled on This Device"));
  }

  // ==========================================================================
  // Save Configuration
  // ==========================================================================

  const routerConfig: RouterConfig = {
    appName: routerAppName,
    tailscaleIp: device.addresses[0],
    tags,
  };

  const config: Config = {
    fly: flyConfig,
    tailscale: tailscaleConfig,
    router: routerConfig,
    defaults: {
      autoStopSeconds: 300,
      machineSize: "shared-cpu-1x",
      memoryMb: 1024,
    },
  };

  await saveConfig(config);
  statusOk("Configuration Saved");

  // ==========================================================================
  // Done!
  // ==========================================================================

  console.log();
  console.log(bold("=".repeat(50)));
  console.log(bold("  Setup Complete!"));
  console.log(bold("=".repeat(50)));
  console.log();
  console.log("Chromatic is ready. Create your first instance:");
  console.log();
  console.log(dim("  chromatic create my-browser"));
  console.log();
};

// =============================================================================
// Register Command
// =============================================================================

registerCommand({
  name: "setup",
  description: "One-time setup: connect Fly.io and Tailscale, deploy router",
  usage: "chromatic setup [--org <org>] [--region <region>] [--api-key <key>] [--yes]",
  run: setup,
});
