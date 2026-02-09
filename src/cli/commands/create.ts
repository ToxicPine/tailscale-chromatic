// =============================================================================
// Create Command - Create a New CDP Instance
// =============================================================================

import { parseArgs } from "@std/cli";
import {
  statusOk,
  statusInfo,
  bold,
  dim,
  randomId,
  Spinner,
  die,
} from "../../../lib/cli.ts";
import { registerCommand } from "../mod.ts";
import { requireRouter, MachineSizeEnum, type MachineSize } from "../../schemas/config.ts";
import {
  validateInstanceName,
  getCdpEndpoint,
  fetchCdpVersionInfo,
  convertWsUrlToHostname,
} from "../../schemas/instance.ts";
import { createFlyProvider, getCdpAppName, isCdpApp } from "../../providers/fly.ts";

// =============================================================================
// Create Command
// =============================================================================

const create = async (argv: string[]): Promise<void> => {
  const args = parseArgs(argv, {
    string: ["count", "size", "region"],
    boolean: ["help"],
  });

  if (args.help) {
    console.log(`
${bold("chromatic create")} - Create a New CDP Instance

${bold("USAGE")}
  chromatic create <name> [options]

${bold("OPTIONS")}
  --count <n>     Number of machines (default: 1)
  --size <size>   Machine size (default: shared-cpu-1x)
  --region <reg>  Fly.io region (default: from config)

${bold("SIZES")}
  shared-cpu-1x   1 CPU, 1GB RAM
  shared-cpu-2x   2 CPU, 2GB RAM
  shared-cpu-4x   4 CPU, 4GB RAM

${bold("EXAMPLES")}
  chromatic create my-browser
  chromatic create scrapers --count 3
  chromatic create heavy --size shared-cpu-4x
`);
    return;
  }

  const name = args._[0] as string | undefined;
  if (!name) {
    return die("Instance Name Required");
  }

  const validation = validateInstanceName(name);
  if (!validation.valid) {
    return die(validation.error ?? "Invalid Instance Name");
  }

  const config = await requireRouter();
  const fly = createFlyProvider();

  // Parse count
  const count = parseInt(args.count ?? "1", 10);
  if (isNaN(count) || count < 1 || count > 10) {
    return die("Count Must Be Between 1 and 10");
  }

  // Parse size
  const sizeArg = args.size ?? config.defaults.machineSize;
  const sizeResult = MachineSizeEnum.safeParse(sizeArg);
  if (!sizeResult.success || !sizeResult.data) {
    return die(`Invalid Size: ${sizeArg}`);
  }
  const size: MachineSize = sizeResult.data;

  const region = args.region ?? config.fly.region;

  console.log();
  console.log(bold("Creating CDP Instance"));
  console.log();
  statusInfo(`Name: ${name}`);
  statusInfo(`Machines: ${count}x ${size}`);
  statusInfo(`Region: ${region}`);
  console.log();

  // Check for existing instance
  const apps = await fly.listApps(config.fly.org);
  const existingApp = apps.find((app) => {
    if (!isCdpApp(app.Name)) return false;
    return app.Name.includes(`-${name}-`);
  });

  if (existingApp) {
    return die(`Instance '${name}' Already Exists`);
  }

  // Create app
  const appName = getCdpAppName(name, randomId(4));

  const spinner = new Spinner();
  spinner.start(`Creating App: ${appName}`);
  await fly.createApp(appName, config.fly.org);
  spinner.success(`Created App: ${appName}`);

  // Deploy CDP image (creates first machine)
  const dockerDir = new URL("../../docker/cdp", import.meta.url).pathname;

  console.log();
  console.log(dim("Deploying CDP Image..."));
  await fly.deploy(appName, dockerDir, { region });
  statusOk("CDP Image Deployed");

  // Create additional machines if count > 1 (deploy already created 1)
  if (count > 1) {
    console.log();
    console.log(dim(`Creating ${count - 1} Additional Machine(s)...`));

    for (let i = 1; i < count; i++) {
      const machine = await fly.createMachine(appName, {
        size,
        region,
        autoStopSeconds: config.defaults.autoStopSeconds,
      });
      statusOk(`Created Machine: ${machine.id.slice(0, 8)}`);
    }
  }

  // Fetch live WebSocket URL
  const machines = await fly.listMachines(appName);
  const runningMachine = machines.find((m) => m.state === "running" && m.privateIp);

  let wsEndpoint = getCdpEndpoint(appName);
  if (runningMachine?.privateIp) {
    const cdpInfo = await fetchCdpVersionInfo(runningMachine.privateIp);
    if (cdpInfo) {
      wsEndpoint = convertWsUrlToHostname(
        cdpInfo.webSocketDebuggerUrl,
        appName
      );
    }
  }

  // Display result
  console.log();
  console.log(bold("=".repeat(50)));
  console.log(bold(`  Instance Created: ${name}`));
  console.log(bold("=".repeat(50)));
  console.log();
  console.log(`CDP Endpoint: ${bold(wsEndpoint)}`);
  console.log();
  console.log(dim("Connect with Puppeteer:"));
  console.log(dim(`  const browser = await puppeteer.connect({`));
  console.log(dim(`    browserWSEndpoint: '${wsEndpoint}'`));
  console.log(dim(`  });`));
  console.log();
};

// =============================================================================
// Register Command
// =============================================================================

registerCommand({
  name: "create",
  description: "Create a new remote browser instance on Fly.io",
  usage: "chromatic create <name> [--count N] [--size SIZE]",
  run: create,
});
