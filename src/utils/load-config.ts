import path from "node:path";
import fs from "fs-extra";
import type { Layout, ViterexConfig } from "../types.js";

export async function loadConfigFile(
  configPath: string,
  defaultLayout: Layout,
): Promise<ViterexConfig> {
  const resolved = path.resolve(configPath);
  const stat = await fs.stat(resolved).catch(() => null);
  const file = stat?.isDirectory()
    ? path.join(resolved, "viterex.json")
    : resolved;

  const config = (await fs.readJSON(file)) as Partial<ViterexConfig> &
    Record<string, unknown>;

  // Backfill defaults for fields added in newer installer versions
  if (!config.templateReplacements) config.templateReplacements = {};
  if (!config.preset) config.preset = "custom";
  if (!config.layout) config.layout = defaultLayout;
  if (!config.installMode) config.installMode = "fresh";
  if (!config.redaxoLang) config.redaxoLang = "de_de";
  if (!config.redaxoTimezone) config.redaxoTimezone = "Europe/Berlin";
  if (!config.addons) config.addons = [];

  return config as ViterexConfig;
}
