// =============================================================================
// Instance and Machine Types
// =============================================================================

import { z } from "zod";
import { MachineSizeEnum } from "./config.ts";

// =============================================================================
// Machine State
// =============================================================================

export const MachineStateEnum = z.enum(["creating", "running", "frozen", "failed"]);

export type MachineState = z.infer<typeof MachineStateEnum>;

// =============================================================================
// Machine Schema
// =============================================================================

export const MachineSchema = z.object({
  id: z.string(),
  state: MachineStateEnum,
  size: MachineSizeEnum,
  region: z.string(),
  privateIp: z.string().optional(),
});

export type Machine = z.infer<typeof MachineSchema>;

// =============================================================================
// Instance Schema
// =============================================================================

export const InstanceSchema = z.object({
  name: z.string(),
  flyAppName: z.string(),
  machines: z.array(MachineSchema),
  region: z.string().optional(),
});

export type Instance = z.infer<typeof InstanceSchema>;

// =============================================================================
// Instance State Summary
// =============================================================================

export interface InstanceStateSummary {
  total: number;
  running: number;
  frozen: number;
  creating: number;
  failed: number;
}

export const getInstanceStateSummary = (instance: Instance): InstanceStateSummary => {
  const summary: InstanceStateSummary = {
    total: instance.machines.length,
    running: 0,
    frozen: 0,
    creating: 0,
    failed: 0,
  };

  for (const machine of instance.machines) {
    switch (machine.state) {
      case "running":
        summary.running++;
        break;
      case "frozen":
        summary.frozen++;
        break;
      case "creating":
        summary.creating++;
        break;
      case "failed":
        summary.failed++;
        break;
    }
  }

  return summary;
};

export const formatInstanceState = (summary: InstanceStateSummary): string => {
  if (summary.total === 0) return "no machines";
  if (summary.total === 1) {
    if (summary.running === 1) return "running";
    if (summary.frozen === 1) return "frozen";
    if (summary.creating === 1) return "creating";
    return "failed";
  }

  const parts: string[] = [];
  if (summary.frozen > 0) parts.push(`${summary.frozen} frozen`);
  if (summary.running > 0) parts.push(`${summary.running} running`);
  if (summary.creating > 0) parts.push(`${summary.creating} creating`);
  if (summary.failed > 0) parts.push(`${summary.failed} failed`);

  return parts.join("/");
};

// =============================================================================
// Machine Size Summary
// =============================================================================

export interface MachineSizeSummary {
  "shared-cpu-1x": number;
  "shared-cpu-2x": number;
  "shared-cpu-4x": number;
}

export const getMachineSizeSummary = (instance: Instance): MachineSizeSummary => {
  const summary: MachineSizeSummary = {
    "shared-cpu-1x": 0,
    "shared-cpu-2x": 0,
    "shared-cpu-4x": 0,
  };

  for (const machine of instance.machines) {
    summary[machine.size]++;
  }

  return summary;
};

export const formatMachineSizeSummary = (summary: MachineSizeSummary): string => {
  const parts: string[] = [];
  if (summary["shared-cpu-1x"] > 0) {
    parts.push(`${summary["shared-cpu-1x"]}x shared-cpu-1x`);
  }
  if (summary["shared-cpu-2x"] > 0) {
    parts.push(`${summary["shared-cpu-2x"]}x shared-cpu-2x`);
  }
  if (summary["shared-cpu-4x"] > 0) {
    parts.push(`${summary["shared-cpu-4x"]}x shared-cpu-4x`);
  }
  return parts.join(", ") || "none";
};

// =============================================================================
// Instance Name Validation
// =============================================================================

export const validateInstanceName = (name: string): { valid: boolean; error?: string } => {
  if (name.length < 3) {
    return { valid: false, error: "Name must be at least 3 characters" };
  }
  if (name.length > 30) {
    return { valid: false, error: "Name must be at most 30 characters" };
  }
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name) && name.length > 2) {
    return {
      valid: false,
      error: "Name must start and end with alphanumeric, contain only lowercase letters, numbers, and hyphens",
    };
  }
  if (!/^[a-z0-9-]+$/.test(name)) {
    return {
      valid: false,
      error: "Name must contain only lowercase letters, numbers, and hyphens",
    };
  }
  return { valid: true };
};

// =============================================================================
// CDP Endpoint
// =============================================================================

export const getCdpEndpoint = (flyAppName: string): string => {
  // Use .flycast domain for reliable DNS resolution even when machines are stopped.
  // .internal only resolves when machines are running.
  return `ws://${flyAppName}.flycast:9222`;
};

export const getCdpMachineEndpoint = (privateIp: string): string => {
  return `ws://[${privateIp}]:9222`;
};

// =============================================================================
// Fetch Live CDP Info
// =============================================================================

export interface CdpVersionInfo {
  browser: string;
  protocolVersion: string;
  userAgent: string;
  webSocketDebuggerUrl: string;
}

/**
 * Fetches live CDP version info from a running Chrome instance.
 * Uses the private IP to bypass Chrome's Host header check.
 */
export const fetchCdpVersionInfo = async (
  privateIp: string
): Promise<CdpVersionInfo | null> => {
  try {
    const response = await fetch(`http://[${privateIp}]:9222/json/version`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return {
      browser: data.Browser,
      protocolVersion: data["Protocol-Version"],
      userAgent: data["User-Agent"],
      webSocketDebuggerUrl: data.webSocketDebuggerUrl,
    };
  } catch {
    return null;
  }
};

/**
 * Converts a WebSocket URL from IP-based to hostname-based.
 * Puppeteer works with hostname-based WebSocket URLs.
 */
export const convertWsUrlToHostname = (
  wsUrl: string,
  hostname: string
): string => {
  // wsUrl format: ws://[fdaa:...]:9222/devtools/browser/uuid
  // We want: ws://hostname.flycast:9222/devtools/browser/uuid
  // Using .flycast for reliable DNS even when machines are stopped
  const match = wsUrl.match(/ws:\/\/\[.*?\]:9222(\/.*)/);
  if (match) {
    return `ws://${hostname}.flycast:9222${match[1]}`;
  }
  return wsUrl;
};
