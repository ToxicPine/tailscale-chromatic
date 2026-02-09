// =============================================================================
// List Command - List All CDP Instances
// =============================================================================

import { parseArgs } from "@std/cli";
import { bold, dim } from "../../../lib/cli.ts";
import { registerCommand } from "../mod.ts";
import { requireRouter } from "../../schemas/config.ts";
import {
  getInstanceStateSummary,
  formatInstanceState,
  getCdpEndpoint,
  type Instance,
} from "../../schemas/instance.ts";
import {
  createFlyProvider,
  isCdpApp,
  getInstanceNameFromApp,
} from "../../providers/fly.ts";

// =============================================================================
// List Command
// =============================================================================

const list = async (argv: string[]): Promise<void> => {
  const args = parseArgs(argv, {
    boolean: ["help", "json"],
  });

  if (args.help) {
    console.log(`
${bold("chromatic list")} - List All CDP Instances

${bold("USAGE")}
  chromatic list [options]

${bold("OPTIONS")}
  --json    Output as JSON

${bold("EXAMPLES")}
  chromatic list
  chromatic list --json
`);
    return;
  }

  const config = await requireRouter();
  const fly = createFlyProvider();

  const apps = await fly.listApps(config.fly.org);
  const cdpApps = apps.filter((app) => isCdpApp(app.Name));

  if (cdpApps.length === 0) {
    console.log();
    console.log(dim("No CDP Instances Found"));
    console.log(dim("Create one with: chromatic create <name>"));
    console.log();
    return;
  }

  const instances: Instance[] = [];

  for (const app of cdpApps) {
    const machines = await fly.listMachines(app.Name);
    const instanceName = getInstanceNameFromApp(app.Name) ?? app.Name;

    instances.push({
      name: instanceName,
      flyAppName: app.Name,
      machines,
    });
  }

  if (args.json) {
    console.log(JSON.stringify(instances, null, 2));
    return;
  }

  console.log();

  const nameWidth = 20;
  const machinesWidth = 10;
  const stateWidth = 20;

  console.log(
    bold(
      "INSTANCE".padEnd(nameWidth) +
      "MACHINES".padEnd(machinesWidth) +
      "STATE".padEnd(stateWidth) +
      "ENDPOINT"
    )
  );

  for (const instance of instances) {
    const summary = getInstanceStateSummary(instance);
    const stateStr = formatInstanceState(summary);
    const endpoint = getCdpEndpoint(instance.flyAppName);

    console.log(
      instance.name.padEnd(nameWidth) +
      String(summary.total).padEnd(machinesWidth) +
      stateStr.padEnd(stateWidth) +
      endpoint
    );
  }

  console.log();
};

// =============================================================================
// Register Command
// =============================================================================

registerCommand({
  name: "list",
  description: "List all browser instances and their status",
  usage: "chromatic list [--json]",
  run: list,
});
