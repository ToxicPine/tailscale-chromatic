// =============================================================================
// Create Command - Create a New CDP Instance
// =============================================================================

import { parseArgs } from "@std/cli";
import {
  bold,
  dim,
  randomId,
  Spinner,
  die,
} from "../../../lib/cli.ts";
import { createOutput } from "../../../lib/output.ts";
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
    boolean: ["help", "json"],
  });

  if (args.help) {
    console.log(`
${bold("chromatic create")} - Create a Browser Group

${bold("USAGE")}
  chromatic create <name> [options]

${bold("OPTIONS")}
  --count <n>     Number of machines in the group (default: 1)
  --size <size>   Machine size (default: shared-cpu-1x)
  --region <reg>  Fly.io region (default: from config)
  --json          Output as JSON

${bold("SIZES")}
  shared-cpu-1x   1 CPU, 1GB RAM
  shared-cpu-2x   2 CPU, 2GB RAM
  shared-cpu-4x   4 CPU, 4GB RAM

${bold("DESCRIPTION")}
  Creates a browser group with one or more machines, each running Chrome.
  Connections to the group's CDP endpoint are load-balanced across machines.
  Use 'chromatic scale' to add or remove machines later.

${bold("EXAMPLES")}
  chromatic create my-browser
  chromatic create scrapers --count 3
  chromatic create heavy --size shared-cpu-4x --json
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

  // Create output handler - methods print immediately in human mode, no-op in JSON mode
  const out = createOutput<{
    name: string;
    flyAppName: string;
    endpoint: string;
    machines: { id: string; state: string; size: string; region: string; privateIp?: string }[];
  }>(args.json);

  out.blank()
    .header("Creating CDP Instance")
    .blank()
    .info(`Name: ${name}`)
    .info(`Machines: ${count}x ${size}`)
    .info(`Region: ${region}`)
    .blank();

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
  if (!out.isJson()) spinner.start(`Creating App: ${appName}`);
  await fly.createApp(appName, config.fly.org);
  if (!out.isJson()) spinner.success(`Created App: ${appName}`);

  // Deploy CDP image (creates first machine)
  const dockerDir = new URL("../../docker/cdp", import.meta.url).pathname;

  out.blank().dim("Deploying CDP Image...");
  await fly.deploy(appName, dockerDir, { region });
  out.ok("CDP Image Deployed");

  // Create additional machines if count > 1 (deploy already created 1)
  if (count > 1) {
    out.blank().dim(`Creating ${count - 1} Additional Machine(s)...`);

    for (let i = 1; i < count; i++) {
      const machine = await fly.createMachine(appName, {
        size,
        region,
        autoStopSeconds: config.defaults.autoStopSeconds,
      });
      out.ok(`Created Machine: ${machine.id.slice(0, 8)}`);
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

  // Set final data for JSON output
  out.merge({
    name,
    flyAppName: appName,
    endpoint: wsEndpoint,
    machines: machines.map((m) => ({
      id: m.id,
      state: m.state,
      size: m.size,
      region: m.region,
      privateIp: m.privateIp,
    })),
  });

  out.blank()
    .header("=".repeat(50))
    .header(`  Instance Created: ${name}`)
    .header("=".repeat(50))
    .blank()
    .text(`CDP Endpoint: ${bold(wsEndpoint)}`)
    .blank()
    .dim("Connect with Puppeteer:")
    .dim(`  const browser = await puppeteer.connect({`)
    .dim(`    browserWSEndpoint: '${wsEndpoint}'`)
    .dim(`  });`)
    .blank();

  out.print();
};

// =============================================================================
// Register Command
// =============================================================================

registerCommand({
  name: "create",
  description: "Create a browser group with one or more machines",
  usage: "chromatic create <name> [--count N] [--size SIZE] [--json]",
  run: create,
});
