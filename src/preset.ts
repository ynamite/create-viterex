import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "fs-extra";
import * as p from "@clack/prompts";
import { ADDON_CATALOG, type AddonSelection, type PresetAddonInput, type PresetConfig } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const presetsDir = path.resolve(__dirname, "../presets");

export interface PresetSummary {
  name: string;
  description?: string;
}

/**
 * Scan the built-in presets/ directory for folders containing preset.json.
 * Always appends "custom" as a virtual option.
 */
export async function discoverPresets(): Promise<PresetSummary[]> {
  const presets: PresetSummary[] = [];

  if (await fs.pathExists(presetsDir)) {
    const entries = await fs.readdir(presetsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const configPath = path.join(presetsDir, entry.name, "preset.json");
        if (await fs.pathExists(configPath)) {
          let description: string | undefined;
          try {
            const cfg = (await fs.readJSON(configPath)) as { description?: string };
            description = cfg.description;
          } catch {
            // ignore — preset will still appear, just without a hint
          }
          presets.push({ name: entry.name, description });
        }
      }
    }
  }

  presets.push({ name: "custom" });
  return presets;
}

/**
 * Load a preset by ID.
 * - "custom" returns null (user configures everything manually)
 * - If presetId contains "/" or ends with ".json", treat as external file path
 * - Otherwise look up in built-in presets/ directory
 *
 * Filters out legacy `viterex` submodule entries with a warning — viterex is
 * now installed via `install:download` from redaxo.org and should not be
 * declared as a submodule.
 */
export async function loadPreset(
  presetId: string
): Promise<{ config: PresetConfig; dir: string } | null> {
  if (presetId === "custom") return null;

  let configPath: string;
  let dir: string;

  if (presetId.includes("/") || presetId.endsWith(".json")) {
    const resolved = path.resolve(presetId);
    const stat = await fs.stat(resolved).catch(() => null);
    if (stat?.isDirectory()) {
      dir = resolved;
      configPath = path.join(dir, "preset.json");
    } else {
      configPath = resolved;
      dir = path.dirname(configPath);
    }
  } else {
    dir = path.join(presetsDir, presetId);
    configPath = path.join(dir, "preset.json");
  }

  if (!(await fs.pathExists(configPath))) {
    throw new Error(`Preset not found: ${configPath}`);
  }

  const raw: PresetConfig = await fs.readJSON(configPath);
  const config: PresetConfig = {
    ...raw,
    addons: raw.addons?.map(normalizePresetAddon),
  };

  if (config.submoduleAddons?.length) {
    const before = config.submoduleAddons.length;
    config.submoduleAddons = config.submoduleAddons.filter(
      (s) => s.packageKey !== "viterex" && s.packageKey !== "viterex_addon",
    );
    if (config.submoduleAddons.length < before) {
      p.log.warn(
        `Preset "${presetId}" lists viterex_addon as a submodule. ` +
          `viterex_addon is now installed from redaxo.org via install:download — entry filtered.`,
      );
    }
  }

  return { config, dir };
}

/**
 * Resolve a seed file path relative to a preset directory.
 */
export function resolveSeedFile(seedFile: string, presetDir: string): string {
  return path.resolve(presetDir, seedFile);
}

function normalizePresetAddon(entry: PresetAddonInput): AddonSelection {
  if (typeof entry !== "string") return entry;
  const catalog = ADDON_CATALOG.find((a) => a.key === entry);
  return { key: entry, install: true, activate: true, plugins: catalog?.plugins };
}
