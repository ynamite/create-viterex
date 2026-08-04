import path from "node:path";
import fs from "node:fs/promises";
import type { Layout, InstallMode } from "../types.js";
import { pathExists } from "./fs.js";

export interface DetectionResult {
  mode: InstallMode;
  layout: Layout;
  present: {
    redaxo: boolean;
    viterex: boolean;
    ydeploy: boolean;
    addons: string[];
  };
  consolePath: string;
}

export function consolePathFor(layout: Layout): string {
  return layout === "modern" ? "bin/console" : "redaxo/bin/console";
}

export function dataDirFor(layout: Layout): string {
  return layout === "modern" ? "var/data" : "redaxo/data";
}

export function srcAddonsDirFor(layout: Layout): string {
  return layout === "modern" ? "src/addons" : "redaxo/src/addons";
}

/**
 * Reads `<dataDir>/core/config.yml` to detect a completed Redaxo setup.
 * Returns true when `setup: true` is found in the file. Falsy on any
 * failure (file missing, parse error) — caller treats that as "not set up".
 */
export async function isSetupComplete(targetDir: string, layout: Layout): Promise<boolean> {
  const configPath = path.join(targetDir, dataDirFor(layout), "core", "config.yml");
  if (!(await pathExists(configPath))) return false;
  const content = await fs.readFile(configPath, "utf-8");
  return /^setup:\s*true\s*$/m.test(content);
}

/**
 * Walk the addons directory of a Redaxo install and return the list of
 * package keys present (subdirectories that contain a package.yml).
 */
async function listInstalledAddons(targetDir: string, layout: Layout): Promise<string[]> {
  const addonsRoot = path.join(targetDir, srcAddonsDirFor(layout));
  if (!(await pathExists(addonsRoot))) return [];

  const entries = await fs.readdir(addonsRoot, { withFileTypes: true });
  const keys: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (await pathExists(path.join(addonsRoot, entry.name, "package.yml"))) {
      keys.push(entry.name);
    }
  }
  return keys;
}

/**
 * Detect the layout and install mode of a target directory.
 *
 * - `modern`: bin/console AND src/path_provider.php both exist
 * - `classic+theme`: redaxo/bin/console exists, src/path_provider.php does not, theme/ exists
 * - `classic`: redaxo/bin/console exists, src/path_provider.php does not, theme/ does not
 * - otherwise: fresh install (mode='fresh', layout defaults to 'modern')
 */
export async function detectInstallation(targetDir: string): Promise<DetectionResult> {
  const exists = (p: string) => pathExists(path.join(targetDir, p));

  const hasModern = (await exists("bin/console")) && (await exists("src/path_provider.php"));
  const hasClassic = (await exists("redaxo/bin/console")) && !(await exists("src/path_provider.php"));
  const hasTheme = await exists("theme");

  let layout: Layout = "modern";
  let mode: InstallMode = "fresh";

  if (hasModern) {
    layout = "modern";
    mode = "augment";
  } else if (hasClassic) {
    layout = hasTheme ? "classic+theme" : "classic";
    mode = "augment";
  }

  const addons = mode === "augment" ? await listInstalledAddons(targetDir, layout) : [];

  return {
    mode,
    layout,
    present: {
      redaxo: mode === "augment",
      viterex: addons.includes("viterex_addon"),
      ydeploy: addons.includes("ydeploy"),
      addons,
    },
    consolePath: consolePathFor(layout),
  };
}
