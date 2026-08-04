import path from "node:path";
import fs from "node:fs/promises";
import type { Layout, ViterexConfig } from "../types.js";
import { readJSON } from "./fs.js";

/**
 * Load a viterex config JSON, accepting either a file path or a directory
 * containing `viterex.json`. Backfills defaults for fields added in newer
 * installer versions (`templateReplacements`, `preset`, `layout`,
 * `installMode`, `redaxoLang`, `redaxoTimezone`, `addons`).
 */
export async function loadConfigFile(
  configPath: string,
  defaultLayout: Layout,
): Promise<ViterexConfig> {
  const resolved = path.resolve(configPath);
  const stat = await fs.stat(resolved).catch(() => null);
  const file = stat?.isDirectory()
    ? path.join(resolved, "viterex.json")
    : resolved;

  const config = await readJSON<Partial<ViterexConfig> & Record<string, unknown>>(file);

  // Backfill defaults for fields added in newer installer versions
  backfillConfigDefaults(config, defaultLayout);
  if (!config.addons) config.addons = [];

  return config as ViterexConfig;
}

export function backfillConfigDefaults(
  config: Partial<ViterexConfig> & Record<string, unknown>,
  defaultLayout: Layout,
): void {
  if (!config.templateReplacements) config.templateReplacements = {};
  if (!config.preset) config.preset = "custom";
  if (!config.layout) config.layout = defaultLayout;
  if (!config.installMode) config.installMode = "fresh";
  if (!config.redaxoLang) config.redaxoLang = "de_de";
  if (!config.redaxoTimezone) config.redaxoTimezone = "Europe/Berlin";
}
