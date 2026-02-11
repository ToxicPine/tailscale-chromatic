# Ambit MCP

**Stop writing login pages. Your VPN is the auth.**

Ambit is an MCP server that helps you deploy internal tools, AI agents, and dashboards that are **private by default**. It bridges Fly.io and Tailscale so your apps are only accessible to you.

- **Zero Auth Code**: If your device is on Tailscale, you're authenticated.
- **Invisible**: Apps have no public IP addresses.
- **Magic DNS**: Access everything at `*.internal` (or your custom network name).

It manages the `fly` CLI for you in two modes:

- **Safe** (default) — enforces private networking, Flycast-only exposure, router management
- **Unsafe** — full `flyctl` surface, no restrictions

## Quick Start

Add the MCP server to your project:

```sh
nix run .#setup -- --create --yes
```

This creates a `.mcp.json` in the current directory with the ambit server configured. Your MCP client (Claude Code, Cursor, etc.) picks it up automatically.

For unsafe mode:

```sh
nix run .#setup -- --create --yes --unsafe
```

### Setup Options

```
--create          Create .mcp.json if none exists
--unsafe          Configure for unsafe mode
--name <name>     Server name (default: ambit)
--flake <path>    Custom flake path
--dry-run         Preview without writing
--yes             Skip prompts
```

## Running the Server Directly

```sh
nix run .                    # safe mode
nix run . -- --unsafe        # unsafe mode
```

## Prerequisites

- `flyctl` installed and authenticated (`fly auth login`)
- For safe mode: a ambit network (`ambit deploy`)

## What Each Mode Provides

### Safe Mode

- `fly deploy` always passes `--no-public-ips --flycast`
- IP allocation limited to Flycast on an explicit network
- Post-deploy audit releases any public IPs
- `ambit-*` apps are protected from modification
- Router tools available (`router_list`, `router_status`, `router_doctor`, etc.)

### Unsafe Mode

30 tools. No enforcement — you control everything:

- Public IPv4/IPv6 allocation
- TLS certificate management
- Deploy flags are optional
- No router tools (use `ambit` CLI directly)

### Tool Reference

**Apps & Deploy** — `fly_auth_status`, `fly_app_list`, `fly_app_status`, `fly_app_create`, `fly_app_destroy`, `fly_deploy`

**Machines** — `fly_machine_list`, `fly_machine_start`, `fly_machine_stop`, `fly_machine_destroy`, `fly_machine_exec`

**Networking** — `fly_ip_list`, `fly_ip_release`, `fly_ip_allocate_flycast` (safe) or `fly_ip_allocate_v4`, `fly_ip_allocate_v6`, `fly_ip_allocate` (unsafe)

**Secrets** — `fly_secrets_list`, `fly_secrets_set`, `fly_secrets_unset`

**Scale** — `fly_scale_show`, `fly_scale_count`, `fly_scale_vm`

**Volumes** — `fly_volumes_list`, `fly_volumes_create`, `fly_volumes_destroy`

**Config & Logs** — `fly_config_show`, `fly_logs`

**Routers** (safe only) — `router_list`, `router_status`, `router_deploy`, `router_destroy`, `router_doctor`, `router_logs`

**Certs** (unsafe only) — `fly_certs_list`, `fly_certs_add`, `fly_certs_remove`

## Configuration

Safe mode reads `~/.config/ambit/config.json` for defaults:

```json
{
  "network": "browsers",
  "fly": { "org": "my-org", "region": "iad" }
}
```

Created automatically by `ambit deploy`.

## Development

```sh
nix develop              # shell with deno + flyctl
deno task dev            # watch mode
deno task test           # run tests
deno task check          # type-check
nix build .#ambit-mcp   # compiled binary
```
