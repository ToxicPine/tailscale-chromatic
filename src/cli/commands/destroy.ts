// =============================================================================
// Destroy Command - Remove an Instance
// =============================================================================

import { parseArgs } from "@std/cli";
import {
  bold,
  confirm,
  die,
  red,
  Spinner,
} from "../../../lib/cli.ts";
import { createOutput } from "../../../lib/output.ts";
import { registerCommand } from "../mod.ts";
import { requireRouter } from "../../schemas/config.ts";
import { getInstanceStateSummary } from "../../schemas/instance.ts";
import {
  createFlyProvider,
  isCdpApp,
  getInstanceNameFromApp,
} from "../../providers/fly.ts";

// =============================================================================
// Destroy Command
// =============================================================================

const destroy = async (argv: string[]): Promise<void> => {
  const args = parseArgs(argv, {
    boolean: ["help", "force", "yes", "json"],
    alias: { f: "force", y: "yes" },
  });

  if (args.help) {
    console.log(`
${bold("chromatic destroy")} - Remove an Instance

${bold("USAGE")}
  chromatic destroy <name> [options]

${bold("OPTIONS")}
  -f, --force   Destroy without confirmation
  -y, --yes     Same as --force
  --json        Output as JSON

${bold("EXAMPLES")}
  chromatic destroy my-browser
  chromatic destroy scrapers --force
  chromatic destroy scrapers --yes --json
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
  const summary = getInstanceStateSummary({
    name,
    flyAppName: app.Name,
    machines,
  });

  const out = createOutput(args.json, {
    destroyed: true,
    name,
    flyAppName: app.Name,
    machinesDestroyed: summary.total,
  });

  out.blank()
    .header(`Instance: ${name}`)
    .text(`App:      ${app.Name}`)
    .text(`Machines: ${summary.total}`)
    .blank();

  if (!args.force && !args.yes && !out.isJson()) {
    console.log(red("This Will Permanently Delete the Instance and All Machines"));
    console.log();

    const shouldProceed = await confirm("Destroy This Instance?");
    if (!shouldProceed) {
      console.log("Cancelled.");
      return;
    }
    console.log();
  }

  const spinner = new Spinner();
  if (!out.isJson()) spinner.start(`Destroying ${name}`);
  await fly.deleteApp(app.Name);
  if (!out.isJson()) spinner.success(`Destroyed ${name}`);

  out.blank().ok("Instance Destroyed");
  out.print();
};

// =============================================================================
// Register Command
// =============================================================================

registerCommand({
  name: "destroy",
  description: "Delete a browser group and all its machines",
  usage: "chromatic destroy <name> [--force]",
  run: destroy,
});
