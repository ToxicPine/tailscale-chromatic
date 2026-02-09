// =============================================================================
// File Finder - Parent Directory Search
// =============================================================================

import { join, dirname, resolve } from "@std/path";

// =============================================================================
// Find File in Parent Directories
// =============================================================================

/**
 * Search for a file by walking up parent directories.
 * Similar to how git finds .git directory.
 *
 * @param filename - Name of file to find
 * @param startDir - Directory to start from (defaults to cwd)
 * @returns Absolute path to file, or null if not found
 */
export const findFileUp = async (
  filename: string,
  startDir?: string
): Promise<string | null> => {
  let current = resolve(startDir ?? Deno.cwd());
  const root = Deno.build.os === "windows" ? current.split(":")[0] + ":\\" : "/";

  while (current !== root) {
    const candidate = join(current, filename);
    try {
      const stat = await Deno.stat(candidate);
      if (stat.isFile) {
        return candidate;
      }
    } catch {
      // Continue up
    }

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  // Check root directory as final attempt
  try {
    const rootCandidate = join(root, filename);
    const stat = await Deno.stat(rootCandidate);
    if (stat.isFile) {
      return rootCandidate;
    }
  } catch {
    // Not found
  }

  return null;
};

// =============================================================================
// Relative Path for Display
// =============================================================================

/**
 * Get a human-readable relative path for display.
 *
 * @param absolutePath - Absolute path to convert
 * @param from - Base directory (defaults to cwd)
 * @returns Relative path string
 */
export const getRelativePath = (absolutePath: string, from?: string): string => {
  const base = resolve(from ?? Deno.cwd());

  if (absolutePath.startsWith(base)) {
    const relative = absolutePath.slice(base.length);
    if (relative === "") return ".";
    return relative.startsWith("/") ? "." + relative : "./" + relative;
  }

  // For parent directories, compute relative with ../
  const baseParts = base.split("/").filter((p) => p);
  const pathParts = absolutePath.split("/").filter((p) => p);

  let common = 0;
  while (
    common < baseParts.length &&
    common < pathParts.length &&
    baseParts[common] === pathParts[common]
  ) {
    common++;
  }

  const ups = baseParts.length - common;
  const remaining = pathParts.slice(common);

  if (ups === 0 && remaining.length === 0) return ".";

  return [...Array(ups).fill(".."), ...remaining].join("/");
};
