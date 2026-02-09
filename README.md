# Chromatic

Remote browsers on your tailnet. Offload Chrome somewhere else.

## What This Enables

Headless browsers eat RAM. Chromatic runs them on Fly.io instead, but keeps them accessible through Tailscale, a private mesh network that connects your devices. Since your dev server, your AI agent, and the remote browser are all on the same tailnet, they can reach each other as if they were on the same local network.

```mermaid
graph LR
    A[Dev Server<br/>localhost:3000] <-->|Tailscale| B[Browser<br/>Fly.io]
    C[AI Agent] <-->|Tailscale| B
    C <-->|Tailscale| A
```

All three can live on the same machine or anywhere on your tailnet. Browsers sleep when idle and wake on connect in about two seconds, so you only pay for what you use.

## Usage

```bash
# Setup (one-time)
nix run github:ToxicPine/chromatic -- setup

# Create a browser
nix run github:ToxicPine/chromatic -- create my-browser

# Configure MCP to use it
nix run github:ToxicPine/chromatic -- mcp my-browser
```

The `mcp` command finds your `.mcp.json` and adds a Playwright server pointing at your browser's CDP endpoint. Your AI agent can now browse the web through a real Chrome instance.

## Commands

```
chromatic setup            One-time setup: connect Fly.io and Tailscale, deploy router
chromatic create <name>    Create a new remote browser instance on Fly.io
chromatic list             List all browser instances and their status
chromatic mcp <instance>   Add a browser to your .mcp.json for AI agents
chromatic destroy <name>   Delete a browser instance and all its machines
chromatic doctor           Check that Tailscale and the router are working correctly
```

## Cost

The router runs continuously at about $2.50/mo. Browser instances cost roughly $0.01/hr while running and nothing while frozen.

## Requirements

- [Fly.io](https://fly.io) account
- [Tailscale](https://tailscale.com) account
