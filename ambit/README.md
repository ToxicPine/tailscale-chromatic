# Ambit

Ambit deploys a self-configuring Tailscale subnet router onto a Fly.io custom private network (6PN). The network name becomes a TLD on your tailnet, so any Flycast app on that network is directly addressable from any device in your tailnet — no per-app configuration, no VPN tunnels to manage, no port forwarding.

```
ambit create --network mynet
```

After creation, any app on the `mynet` network is reachable:

```
curl http://my-app.mynet
psql -h my-db.mynet
```

## Why

Fly.io private networks (6PN) are powerful but isolated — only machines within the same network can reach each other over their internal IPv6 addresses. If you want to reach those services from your laptop, CI runner, or another cloud, you need a bridge.

Ambit is that bridge. It advertises the network's `/48` subnet to your Tailscale tailnet and runs a DNS proxy that rewrites your custom TLD to `.flycast`, so standard DNS resolution works end-to-end. The result: your Fly.io private network becomes a seamless extension of your tailnet.

## How It Works

Ambit deploys a single lightweight container (~55MB) that does four things:

1. **Subnet routing.** Tailscale advertises the Fly 6PN's `/48` CIDR to your tailnet. Traffic from tailnet devices destined for that subnet is forwarded through the router into the Fly network.

2. **DNS rewriting.** [CoreDNS](https://coredns.io/) rewrites `*.mynet` queries to `*.flycast` before forwarding them to Fly's internal DNS (`fdaa::3`). This is transparent — clients query `my-app.mynet`, the proxy resolves `my-app.flycast`, and the response routes through the advertised subnet.

3. **Split DNS.** Tailscale split DNS is configured so that `*.mynet` queries are sent to the router's Tailscale IP. All other DNS remains unchanged.

4. **SOCKS5 proxy.** A [microsocks](https://github.com/rofl0r/microsocks) instance binds to the router's 6PN address on port 1080. Containers on the same network can use it to reach your tailnet — for Chrome/CDP this is a `--proxy-server` flag, for other containers it's the standard `ALL_PROXY` env var.

The container self-configures on first boot: it enables IP forwarding, starts `tailscaled`, extracts the network's `/48` from its own addresses, creates a short-lived auth key via the Tailscale API, authenticates, advertises routes, and optionally self-approves them. State is persisted to a Fly volume, so restarts reuse the existing Tailscale identity.

### Architecture

```mermaid
graph LR
    A[Your Laptop<br/>curl my-app.mynet] -->|tailnet| B[ambit<br/>subnet router +<br/>dns proxy]
    B --> C[my-app<br/>.flycast]
    B --> D[my-db<br/>.flycast]
    
    subgraph Fly.io Custom 6PN: "mynet"
        B
        C
        D
    end
```

## Prerequisites

- [Fly.io CLI](https://fly.io/docs/flyctl/install/) (`fly auth login`)
- [Tailscale](https://tailscale.com/download) running on your machine
- A Tailscale API access token (`tskey-api-...`) from [admin settings](https://login.tailscale.com/admin/settings/keys)

## Quick Start

```bash
# Create a router on a custom network called "infra"
ambit create --network infra

# Check that everything is healthy
ambit doctor

# Deploy any app to the same network
fly apps create my-service --network infra
fly deploy --flycast --no-public-ips

# Reach it from your tailnet
curl http://my-service.infra
```

## Commands

### `ambit create --network <name>`

Creates the router. Walks through Fly.io auth, Tailscale API validation, app creation on the custom 6PN, image deploy, tailnet join, split DNS setup, and local `--accept-routes` configuration. Saves config to `~/.config/ambit/config.json`.

| Flag | Description |
|------|-------------|
| `--network <name>` | Fly.io custom network name (becomes the TLD) |
| `--org <org>` | Fly.io organization slug |
| `--region <region>` | Fly.io region (default: `iad`) |
| `--api-key <key>` | Tailscale API access token |
| `--self-approve` | Approve subnet routes via API (when autoApprovers not configured) |
| `--yes` | Skip confirmation prompts |
| `--json` | Machine-readable JSON output |

### `ambit status`

Shows router state (machines, Tailscale device, advertised routes, split DNS, network TLD).

### `ambit destroy`

Tears down the router: clears split DNS, removes the Tailscale device, destroys the Fly app. Prints a reminder to clean up any ACL policy entries.

### `ambit doctor`

Runs health checks: Tailscale installed, connected, accept-routes enabled, config present, router running, router visible in tailnet.

## Access Control

Ambit does not modify your Tailscale ACL policy. The router is tagged as `tag:ambit-<network>` via its auth key, and after deploy the CLI prints the tag, subnet CIDR, and recommended policy entries.

Two ACL rules cover the two traffic paths:

```jsonc
{
  "tagOwners": {
    "tag:ambit-infra": ["autogroup:admin"]
  },
  "autoApprovers": {
    "routes": {
      "fdaa:X:XXXX::/48": ["tag:ambit-infra"]
    }
  },
  "acls": [
    // DNS queries go to the router's Tailscale IP
    {"action": "accept", "src": ["group:team"], "dst": ["tag:ambit-infra:53"]},
    // Data connections go to Flycast addresses inside the /48
    {"action": "accept", "src": ["group:team"], "dst": ["fdaa:X:XXXX::/48:*"]}
  ]
}
```

If you don't configure `autoApprovers`, use `--self-approve` and the router will approve its own routes via the Tailscale API.

## Router Container

The router image is ~55MB (Alpine + Tailscale + CoreDNS + microsocks). It runs on a `shared-cpu-1x` with 512MB RAM. Tailscale state is persisted to a Fly volume at `/var/lib/tailscale` so restarts don't create new tailnet devices.

| Component | Version | Purpose |
|-----------|---------|---------|
| Alpine | 3.23 | Base image |
| Tailscale | 1.94 | Subnet routing + tailnet auth |
| CoreDNS | 1.14 | DNS forwarding with TLD rewrite |
| microsocks | 1.0.5 | SOCKS5 proxy for bidirectional tailnet access |

## Using as a Library

Ambit exports its providers, schemas, and utilities as subpath imports for use by other Deno packages:

```typescript
import { createFlyProvider } from "@ambit/cli/providers/fly";
import { createTailscaleProvider } from "@ambit/cli/providers/tailscale";
import { createOutput } from "@ambit/cli/lib/output";
```

This is how [Chromatic](../README.md) builds Chrome CDP instance management on top of Ambit's infrastructure layer.
