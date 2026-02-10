// =============================================================================
// Status Command - Show Detailed Instance Status
// =============================================================================

import { parseArgs } from "@std/cli";
import { bold, dim, die, green, yellow, red, cyan } from "../../../lib/cli.ts";
import { createOutput } from "../../../lib/output.ts";
import { registerCommand } from "../mod.ts";
import { requireRouter } from "../../schemas/config.ts";
import {
  getInstanceStateSummary,
  getMachineSizeSummary,
  formatMachineSizeSummary,
  getCdpEndpoint,
  getCdpMachineEndpoint,
  fetchCdpVersionInfo,
  convertWsUrlToHostname,
  type Instance,
  type MachineState,
} from "../../schemas/instance.ts";
import {
  createFlyProvider,
  isCdpApp,
  getInstanceNameFromApp,
} from "../../providers/fly.ts";

// =============================================================================
// State Colors
// =============================================================================

const stateColor = (state: MachineState): string => {
  switch (state) {
    case "running":
      return green(state);
    case "frozen":
      return cyan(state);
    case "creating":
      return yellow(state);
    case "failed":
      return red(state);
  }
};

// =============================================================================
// Status Command
// =============================================================================

const status = async (argv: string[]): Promise<void> => {
  const args = parseArgs(argv, {
    boolean: ["help", "json"],
  });

  if (args.help) {
    console.log(`
${bold("chromatic status")} - Show Browser Group Status

${bold("USAGE")}
  chromatic status <name> [options]

${bold("OPTIONS")}
  --json    Output as JSON

${bold("DESCRIPTION")}
  Shows all machines in a browser group with their state and private IPs.
  Use per-machine IPs for sticky sessions to a specific Chrome instance.

${bold("EXAMPLES")}
  chromatic status my-browser
  chromatic status scrapers --json
`);
    return;
  }

  const name = args._[0] as string | undefined;
  if (!name) {
    return die("Instance Name Required");
  }

  const config = await requireRouter();
  const fly = createFlyProvider();

  const apps = await fly.listApps(config.fly.org);
  const app = apps.find((a) => {
    if (!isCdpApp(a.Name)) return false;
    return getInstanceNameFromApp(a.Name) === name;
  });

  if (!app) {
    return die(`Instance '${name}' Not Found`);
  }

  const machines = await fly.listMachines(app.Name);

  const instance: Instance = {
    name,
    flyAppName: app.Name,
    machines,
    region: config.fly.region,
  };

  const out = createOutput<Instance>(args.json, instance);

  const summary = getInstanceStateSummary(instance);
  const sizeSummary = getMachineSizeSummary(instance);
  const endpoint = getCdpEndpoint(instance.flyAppName);

  out.blank()
    .header(`Instance: ${name}`)
    .text(`App:      ${instance.flyAppName}`)
    .text(`Region:   ${instance.region ?? config.fly.region}`)
    .text(`Endpoint: ${endpoint}`)
    .blank()
    .text(`Machines: ${summary.total} (${formatMachineSizeSummary(sizeSummary)})`);

  if (machines.length > 0) {
    out.blank();

    const idWidth = 12;
    const sizeWidth = 16;
    const stateWidth = 10;

    out.dim(
      "ID".padEnd(idWidth) +
      "SIZE".padEnd(sizeWidth) +
      "STATE".padEnd(stateWidth) +
      "PRIVATE IP"
    );

    for (const machine of machines) {
      const id = machine.id.slice(0, 10);
      const ip = machine.privateIp ?? "-";

      out.text(
        id.padEnd(idWidth) +
        machine.size.padEnd(sizeWidth) +
        stateColor(machine.state).padEnd(stateWidth + 9) +
        ip
      );
    }
  }

  out.blank();

  // Fetch live WebSocket URL from a running machine
  const runningMachine = machines.find((m) => m.state === "running" && m.privateIp);
  if (runningMachine?.privateIp) {
    const cdpInfo = await fetchCdpVersionInfo(runningMachine.privateIp);
    if (cdpInfo) {
      const wsUrl = convertWsUrlToHostname(
        cdpInfo.webSocketDebuggerUrl,
        instance.flyAppName
      );
      out.header("Connect with Puppeteer:")
        .dim(`  const browser = await puppeteer.connect({`)
        .dim(`    browserWSEndpoint: '${wsUrl}'`)
        .dim(`  });`)
        .blank();
    }
  } else if (machines.some((m) => m.privateIp)) {
    out.dim("Tip: Connect to a specific machine:");
    const machineWithIp = machines.find((m) => m.privateIp);
    if (machineWithIp?.privateIp) {
      out.dim(`  ${getCdpMachineEndpoint(machineWithIp.privateIp)}`);
    }
    out.blank();
  }

  out.print();
};

// =============================================================================
// Register Command
// =============================================================================

registerCommand({
  name: "status",
  description: "Show browser group details and per-machine endpoints",
  usage: "chromatic status <name> [--json]",
  run: status,
});
