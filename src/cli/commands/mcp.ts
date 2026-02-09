// =============================================================================
// MCP Command - Configure MCP with CDP Endpoint
// =============================================================================

import { parseArgs } from "@std/cli";
import {
  statusOk,
  statusInfo,
  statusWarn,
  bold,
  dim,
  cyan,
  confirm,
  die,
} from "../../../lib/cli.ts";
import { findFileUp, getRelativePath } from "../../../lib/find.ts";
import { registerCommand } from "../mod.ts";
import { requireRouter } from "../../schemas/config.ts";
import { getCdpEndpoint } from "../../schemas/instance.ts";
import {
  McpConfigSchema,
  createPlaywrightMcpServer,
  mergeMcpConfig,
  hasServer,
  listServers,
  formatServerConfig,
  type McpConfig,
} from "../../schemas/mcp.ts";
import {
  createFlyProvider,
  isCdpApp,
  getInstanceNameFromApp,
} from "../../providers/fly.ts";

// =============================================================================
// Constants
// =============================================================================

const MCP_FILENAME = ".mcp.json";

// =============================================================================
// MCP Command
// =============================================================================

const mcp = async (argv: string[]): Promise<void> => {
  const args = parseArgs(argv, {
    string: ["name"],
    boolean: ["help", "create", "dry-run"],
    alias: { n: "name" },
  });

  if (args.help) {
    console.log(`
${bold("chromatic mcp")} - Configure MCP with CDP Endpoint

${bold("USAGE")}
  chromatic mcp <instance> [options]

${bold("OPTIONS")}
  -n, --name <name>   Server name in config (default: chromatic-<instance>)
  --create            Create ${MCP_FILENAME} in current directory if not found
  --dry-run           Preview changes without writing

${bold("DESCRIPTION")}
  Searches parent directories for ${MCP_FILENAME}, then adds a Playwright
  MCP server configured with the CDP endpoint for the specified instance.

${bold("EXAMPLES")}
  chromatic mcp my-browser
  chromatic mcp scrapers --name browser-pool
  chromatic mcp my-browser --dry-run
  chromatic mcp my-browser --create
`);
    return;
  }

  const instanceName = args._[0] as string | undefined;
  if (!instanceName) {
    return die("Instance Name Required");
  }

  // Load config and find instance
  const config = await requireRouter();
  const fly = createFlyProvider();

  const apps = await fly.listApps(config.fly.org);
  const app = apps.find((a) => {
    if (!isCdpApp(a.Name)) return false;
    return getInstanceNameFromApp(a.Name) === instanceName;
  });

  if (!app) {
    return die(`Instance '${instanceName}' Not Found`);
  }

  const cdpEndpoint = getCdpEndpoint(app.Name);
  const serverName = args.name ?? `chromatic-${instanceName}`;

  console.log();
  statusInfo(`Instance: ${instanceName}`);
  statusInfo(`Endpoint: ${cdpEndpoint}`);
  console.log();

  // Find .mcp.json in parent directories
  const foundPath = await findFileUp(MCP_FILENAME);

  let targetPath: string;
  let existingConfig: McpConfig = { mcpServers: {} };
  let isNewFile = false;

  if (!foundPath) {
    if (!args.create) {
      console.log(dim(`No ${MCP_FILENAME} Found in Parent Directories`));
      console.log();
      console.log(`Use ${cyan("--create")} to create one in the current directory.`);
      return;
    }

    targetPath = `${Deno.cwd()}/${MCP_FILENAME}`;
    isNewFile = true;
    statusInfo(`Creating ${MCP_FILENAME}`);
  } else {
    targetPath = foundPath;
    statusOk(`Found: ${getRelativePath(targetPath)}`);
  }

  // Parse existing config
  if (!isNewFile) {
    try {
      const content = await Deno.readTextFile(targetPath);
      const parsed = JSON.parse(content);
      const validated = McpConfigSchema.safeParse(parsed);

      if (!validated.success) {
        return die(`Invalid MCP Config: ${validated.error.message}`);
      }

      existingConfig = validated.data;
    } catch (error) {
      if (error instanceof SyntaxError) {
        return die(`Invalid JSON: ${error.message}`);
      }
      throw error;
    }
  }

  // Show existing servers
  const existingServers = listServers(existingConfig);
  if (existingServers.length > 0) {
    console.log();
    console.log(`Existing Servers: ${existingServers.map((s) => cyan(s)).join(", ")}`);
  }

  // Check for name conflict
  if (hasServer(existingConfig, serverName)) {
    console.log();
    statusWarn(`Server '${serverName}' Already Exists`);

    const overwrite = await confirm("Overwrite?");
    if (!overwrite) {
      console.log("Cancelled.");
      return;
    }
  }

  // Build new config
  const newServer = createPlaywrightMcpServer(cdpEndpoint);
  const newConfig = mergeMcpConfig(existingConfig, serverName, newServer);

  // Preview
  console.log();
  console.log(bold("Adding Server:"));
  console.log();
  const formatted = formatServerConfig(serverName, newServer);
  for (const line of formatted.split("\n")) {
    console.log(dim("  " + line));
  }
  console.log();

  // Dry run exits here
  if (args["dry-run"]) {
    statusInfo("Dry Run Complete");
    return;
  }

  // Confirm
  const shouldWrite = await confirm("Write Changes?");
  if (!shouldWrite) {
    console.log("Cancelled.");
    return;
  }

  // Write
  try {
    await Deno.writeTextFile(targetPath, JSON.stringify(newConfig, null, 2) + "\n");
  } catch (error) {
    if (error instanceof Deno.errors.PermissionDenied) {
      return die("Permission Denied");
    }
    throw error;
  }

  console.log();
  statusOk(`Added ${cyan(serverName)} to ${getRelativePath(targetPath)}`);
};

// =============================================================================
// Register Command
// =============================================================================

registerCommand({
  name: "mcp",
  description: "Add a browser instance to your .mcp.json for AI agents",
  usage: "chromatic mcp <instance> [--name NAME] [--create] [--dry-run]",
  run: mcp,
});
