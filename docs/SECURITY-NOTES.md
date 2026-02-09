# Security Notes

## Chrome Remote Debugging Origin Policy

Chrome runs with `--remote-allow-origins=*` to accept WebSocket connections from Flycast IPs and `.flycast` domains, which don't match Chrome's default localhost patterns.

**Risk**: Any client reaching port 9222 can control the browser.

**Mitigation**: CDP instances have no public IPs. Traffic routes through Fly's private Flycast network, then requires Tailscale authentication via the subnet router.

**Threat Model**:
- Compromised tailnet device → can access CDP
- Misconfigured route approval → broader access than intended
- Other apps in your Fly org → can reach Flycast IPs

**Recommendations**: Audit tailnet access regularly. Use ephemeral keys. Separate Fly orgs for sensitive workloads.

## Software Versions

**Router**: Alpine 3.23.3, Tailscale 1.94.1, dnsproxy 0.78.2  
**CDP**: zenika/alpine-chrome:124, Chromium 124.0.6367.78

All versions pinned. Check for updates regularly.

## Network Architecture

All apps deployed with `--flycast --no-public-ips`:
- No public IPs allocated
- Only accessible via Flycast private IPv6
- Must route through Tailscale subnet router

Machines auto-stop when idle (~5 min), auto-start on connect (~7 sec). Pay only for active usage.

**Connect from tailnet**:
