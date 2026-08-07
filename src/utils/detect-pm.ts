import type { ViterexConfig } from "../types.js";
import { commandExists } from "./exec.js";

export type PackageManager = ViterexConfig["packageManager"];

/** Selection/display order: detected default first. */
export const PACKAGE_MANAGERS: PackageManager[] = ["bun", "pnpm", "yarn", "npm"];

/**
 * Default package manager for new projects: bun when it's on PATH, else pnpm.
 * The installer runs via `npx`, so only Node/npm are guaranteed — a hard bun
 * default would break machines without it. `has` is injectable for tests.
 */
export async function detectDefaultPm(
  has: (cmd: string) => Promise<boolean> = commandExists,
): Promise<PackageManager> {
  return (await has("bun")) ? "bun" : "pnpm";
}
