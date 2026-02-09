# Chromatic Architecture

## Overview

Remote Chrome browsers on Fly.io, accessible via Tailscale private network.

## Components

### Subnet Router
- Runs on Fly.io with Tailscale
- Advertises Fly's private network (`fdaa::/48`) to tailnet
- Provides DNS forwarding for `.internal` and `.flycast` domains via dnsproxy

### CDP Instances
- Chrome headless containers on Fly.io
- Private-only networking via Flycast (no public IPs)
- Auto-stop when idle, auto-start on connection (~7s wake time)

## Network Flow

```
graph TD
    A[Your Device<br/>tailnet] -->|Tailscale| B[Subnet Router<br/>Fly.io]
    B -->|fdaa::/48 routes| C[Flycast Proxy]
    C -->|auto-start| D[CDP Instance<br/>Chrome]
```

## Key Configuration

### Deploy Flags
```bash
fly deploy --flycast --no-public-ips
```

### fly.toml Services
```toml
[[services]]
  internal_port = 9222
  protocol = "tcp"
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0

  [[services.ports]]
    port = 9222
```

### Chrome Flags
```bash
--remote-debugging-address=0.0.0.0
--remote-debugging-port=9222
--remote-allow-origins=*
```

## Connecting

Use `.flycast` domains for reliable DNS resolution (works even when machines are stopped):

```javascript
const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://app-name.flycast:9222/devtools/browser/<uuid>'
});
```

Get the WebSocket URL via `chromatic status <name>`.
