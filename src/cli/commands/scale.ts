// =============================================================================
// Scale Command - Declarative Machine Scaling
// =============================================================================

import { parseArgs } from "@std/cli";
import {
  bold,
  confirm,
  die,
  green,
  red,
} from "../../../lib/cli.ts";
import { createOutput } from "../../../lib/output.ts";
import { registerCommand } from "../mod.ts";
import { requireRouter, type MachineSize } from "../../schemas/config.ts";
import {
  getMachineSizeSummary,
  formatMachineSizeSummary,
  type MachineSizeSummary,
} from "../../schemas/instance.ts";
import {
  createFlyProvider,
  isCdpApp,
  getInstanceNameFromApp,
} from "../../providers/fly.ts";

// =============================================================================
// Scale Command
// =============================================================================

const scale = async (argv: string[]): Promise<void> => {
  const args = parseArgs(argv, {
    string: ["shared-cpu-1x", "shared-cpu-2x", "shared-cpu-4x"],
    boolean: ["help", "yes", "json"],
    alias: { y: "yes" },
  });

  if (args.help) {
    console.log(`
${bold("chromatic scale")} - Scale Machines in a Browser Group

${bold("USAGE")}
  chromatic scale <name> [options]
  chromatic scale <name> <count>

${bold("OPTIONS")}
  --shared-cpu-1x <n>   Number of 1x machines
  --shared-cpu-2x <n>   Number of 2x machines
  --shared-cpu-4x <n>   Number of 4x machines
  -y, --yes             Skip confirmation
  --json                Output as JSON

${bold("DESCRIPTION")}
  Add or remove machines in a browser group. Each machine runs an independent
  Chrome instance. Connections to the group's CDP endpoint are load-balanced
  across all machines, so this is for stateless workloads where each session
  is independent.

${bold("EXAMPLES")}
  chromatic scale scrapers 5
  chromatic scale scrapers --shared-cpu-1x 3 --shared-cpu-2x 2
  chromatic scale scrapers --shared-cpu-4x 2 --json
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
  const currentSummary = getMachineSizeSummary({
    name,
    flyAppName: app.Name,
    machines,
  });

  // Parse desired state
  let desiredSummary: MachineSizeSummary;

  const simpleCount = args._[1] as string | undefined;
  if (simpleCount) {
    const count = parseInt(simpleCount, 10);
    if (isNaN(count) || count < 0 || count > 20) {
      return die("Count Must Be Between 0 and 20");
    }

    desiredSummary = {
      "shared-cpu-1x": count,
      "shared-cpu-2x": 0,
      "shared-cpu-4x": 0,
    };
  } else {
    const parse = (val: string | undefined): number => {
      if (!val) return 0;
      const n = parseInt(val, 10);
      return isNaN(n) || n < 0 ? 0 : n;
    };

    desiredSummary = {
      "shared-cpu-1x": parse(args["shared-cpu-1x"]),
      "shared-cpu-2x": parse(args["shared-cpu-2x"]),
      "shared-cpu-4x": parse(args["shared-cpu-4x"]),
    };

    const totalDesired =
      desiredSummary["shared-cpu-1x"] +
      desiredSummary["shared-cpu-2x"] +
      desiredSummary["shared-cpu-4x"];

    if (totalDesired === 0) {
      return die("Specify Count or Size Options");
    }
  }

  // Calculate diff
  const diff: Record<MachineSize, number> = {
    "shared-cpu-1x": desiredSummary["shared-cpu-1x"] - currentSummary["shared-cpu-1x"],
    "shared-cpu-2x": desiredSummary["shared-cpu-2x"] - currentSummary["shared-cpu-2x"],
    "shared-cpu-4x": desiredSummary["shared-cpu-4x"] - currentSummary["shared-cpu-4x"],
  };

  const totalCurrent =
    currentSummary["shared-cpu-1x"] +
    currentSummary["shared-cpu-2x"] +
    currentSummary["shared-cpu-4x"];
  const totalDesired =
    desiredSummary["shared-cpu-1x"] +
    desiredSummary["shared-cpu-2x"] +
    desiredSummary["shared-cpu-4x"];

  // Compute changes
  const toCreate: { size: MachineSize; count: number }[] = [];
  const toDestroy: { size: MachineSize; count: number }[] = [];

  for (const size of ["shared-cpu-1x", "shared-cpu-2x", "shared-cpu-4x"] as MachineSize[]) {
    const change = diff[size];
    if (change > 0) {
      toCreate.push({ size, count: change });
    } else if (change < 0) {
      toDestroy.push({ size, count: -change });
    }
  }

  if (toCreate.length === 0 && toDestroy.length === 0) {
    const out = createOutput(args.json, { name, changed: false, current: currentSummary });
    out.ok("Already at Desired Scale");
    out.print();
    return;
  }

  const out = createOutput(args.json, {
    name,
    changed: true,
    previous: currentSummary,
    current: desiredSummary,
    created: toCreate,
    destroyed: toDestroy,
  });

  out.blank()
    .header(`Scaling: ${name}`)
    .blank()
    .text(`Current:  ${formatMachineSizeSummary(currentSummary)} (${totalCurrent} total)`)
    .text(`Desired:  ${formatMachineSizeSummary(desiredSummary)} (${totalDesired} total)`)
    .blank()
    .text("Changes:");

  for (const { size, count } of toCreate) {
    out.text(green(`  + ${count}x ${size}`));
  }
  for (const { size, count } of toDestroy) {
    out.text(red(`  - ${count}x ${size}`));
  }
  out.blank();

  // Confirm if destroying
  if (toDestroy.length > 0 && !args.yes && !out.isJson()) {
    const shouldProceed = await confirm("Apply Changes?");
    if (!shouldProceed) {
      console.log("Cancelled.");
      return;
    }
    console.log();
  }

  // Destroy first
  for (const { size, count } of toDestroy) {
    const machinesOfSize = machines.filter((m) => m.size === size);
    const toDestroyMachines = machinesOfSize.slice(0, count);

    for (const machine of toDestroyMachines) {
      await fly.destroyMachine(app.Name, machine.id);
    }
  }

  // Then create
  for (const { size, count } of toCreate) {
    for (let i = 0; i < count; i++) {
      await fly.createMachine(app.Name, {
        size,
        region: config.fly.region,
        autoStopSeconds: config.defaults.autoStopSeconds,
      });
    }
  }

  out.blank().ok("Scaling Complete");
  out.print();
};

// =============================================================================
// Register Command
// =============================================================================

registerCommand({
  name: "scale",
  description: "Add or remove machines in a browser group",
  usage: "chromatic scale <name> [count] [--shared-cpu-Nx N]",
  run: scale,
});
