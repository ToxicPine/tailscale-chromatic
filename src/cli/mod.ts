// =============================================================================
// CLI Framework - Command Parser and Router
// =============================================================================

import { parseArgs } from "@std/cli";
import { bold, dim, die } from "../../lib/cli.ts";

// =============================================================================
// Command Interface
// =============================================================================

export interface Command {
  name: string;
  description: string;
  usage: string;
  run: (args: string[]) => Promise<void>;
}

// =============================================================================
// Commands Registry
// =============================================================================

const commands: Map<string, Command> = new Map();

export const registerCommand = (command: Command): void => {
  commands.set(command.name, command);
};

export const getCommand = (name: string): Command | undefined => {
  return commands.get(name);
};

export const getAllCommands = (): Command[] => {
  return Array.from(commands.values());
};

// =============================================================================
// Help Text
// =============================================================================

const VERSION = "0.1.0";

export const showHelp = (): void => {
  console.log(`
${bold("chromatic")} - CDP Instance Manager for Fly.io + Tailscale

${bold("USAGE")}
  chromatic <command> [options]

${bold("COMMANDS")}
  setup      One-time setup: connect Fly.io and Tailscale, deploy router
  create     Create a new remote browser instance on Fly.io
  list       List all browser instances and their status
  status     Show browser instance details including machines and endpoints
  scale      Add or remove machines in a browser instance
  destroy    Delete a browser instance and all its machines
  mcp        Add a browser instance to your .mcp.json for AI agents
  router     Manage the Tailscale subnet router (status, redeploy, destroy)
  doctor     Check that Tailscale and the router are working correctly

${bold("OPTIONS")}
  --help     Show help for a command
  --version  Show version

${bold("EXAMPLES")}
  chromatic setup
  chromatic create my-browser
  chromatic list
  chromatic status my-browser
  chromatic scale my-browser --shared-cpu-1x 3
  chromatic mcp my-browser
  chromatic destroy my-browser
  chromatic router redeploy

${dim("Run 'chromatic <command> --help' for command-specific help.")}
`);
};

export const showVersion = (): void => {
  console.log(`chromatic ${VERSION}`);
};

// =============================================================================
// Main CLI Runner
// =============================================================================

export const runCli = async (argv: string[]): Promise<void> => {
  const args = parseArgs(argv, {
    boolean: ["help", "version"],
    stopEarly: true,
  });

  if (args.version) {
    showVersion();
    return;
  }

  const commandName = args._[0] as string | undefined;

  if (!commandName || args.help) {
    if (commandName) {
      const command = getCommand(commandName);
      if (command) {
        console.log(`
${bold(command.name)} - ${command.description}

${bold("USAGE")}
  ${command.usage}
`);
        return;
      }
    }
    showHelp();
    return;
  }

  const command = getCommand(commandName);
  if (!command) {
    console.log(`Unknown command: ${commandName}`);
    console.log(`Run 'chromatic --help' for usage.`);
    Deno.exit(1);
  }

  const commandArgs = argv.slice(1);
  await command.run(commandArgs);
};
