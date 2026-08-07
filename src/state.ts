import path from "node:path";
import fs from "node:fs/promises";
import * as p from "@clack/prompts";
import type { ViterexConfig } from "./types.js";
import { loadPreset, resolveSeedFile } from "./preset.js";
import { pathExists, readJSON, writeJSON } from "./utils/fs.js";
import { backfillConfigDefaults } from "./utils/load-config.js";

const STATE_FILE = ".viterex-state.json";

/**
 * Fields on `ViterexConfig` that are resolved at runtime from inside the
 * installer package (or an external preset path) and therefore must NOT
 * be persisted — when published as `npx create-viterex`, the package's
 * on-disk location varies between invocations (npx cache hash), and an
 * absolute path baked into the state file would point to a stale or
 * garbage-collected location on resume.
 *
 * These fields are stripped on save and re-derived on load by re-running
 * `loadPreset(config.preset)`.
 */
const PACKAGE_RESOLVED_FIELDS = [
  "presetDir",
  "presetFilesDir",
  "seedFile",
  "installerConfig",
  "deployerExtras",
] as const;

interface StateData {
  config: ViterexConfig;
  completedTasks: string[];
}

function resolveStatePath(projectDir: string): string {
  return path.join(projectDir, STATE_FILE);
}

/**
 * Load state for --resume. Resolves the project directory from either the
 * positional project-name argument or `--config <path>` (the config file's
 * own `projectDir` field).
 */
export async function loadState(
  projectNameArg: string | undefined,
  options: Record<string, unknown>
): Promise<StateData> {
  if (projectNameArg) {
    return loadStateFromDir(path.resolve(process.cwd(), projectNameArg), options);
  }

  if (options.config) {
    const cfg = await readJSON<{ projectDir?: string }>(options.config as string);
    if (!cfg.projectDir) {
      throw new Error(
        `--resume --config requires the config file to have a "projectDir" field.`,
      );
    }
    return loadStateFromDir(cfg.projectDir, options);
  }

  throw new Error(
    "--resume requires either a project name argument or --config <path> with a projectDir field.",
  );
}

/**
 * Read and migrate a state file's full contents. Returns null when the
 * project dir has no state file. Shared by --resume (which also needs
 * completedTasks) and the reuse-answers prompt (which only needs config).
 */
async function readStateData(projectDir: string): Promise<StateData | null> {
  const statePath = resolveStatePath(projectDir);
  if (!(await pathExists(statePath))) return null;

  const raw = await readJSON<Record<string, unknown>>(statePath);
  if (!raw?.config) return null;
  const rawConfig = raw.config as Partial<ViterexConfig> & Record<string, unknown>;

  // Migrate old massifSettings → templateReplacements
  if (rawConfig.massifSettings && !rawConfig.templateReplacements) {
    const ms = rawConfig.massifSettings as Record<string, string>;
    rawConfig.templateReplacements = Object.fromEntries(
      Object.entries(ms).map(([k, v]) => {
        const snake = k.replace(/([A-Z])/g, "_$1").toUpperCase();
        return [`MASSIF_${snake}`, v];
      }),
    );
    delete rawConfig.massifSettings;
  }

  // Backfill defaults for fields added in newer installer versions
  backfillConfigDefaults(rawConfig, "modern");

  const data = raw as unknown as StateData;

  // Re-derive package-resolved paths against the *current* installer location.
  // The persisted state intentionally omits these (see PACKAGE_RESOLVED_FIELDS)
  // because the npx cache hash, and therefore the on-disk path of the installed
  // package, can differ between the run that wrote the state and the resume run.
  await rederivePackageResolvedPaths(data.config);

  return data;
}

/**
 * Load only the saved config, for the reuse-answers prompt on re-runs of a
 * completed (or failed) install. Null when no state file exists.
 */
export async function loadSavedConfig(projectDir: string): Promise<ViterexConfig | null> {
  return (await readStateData(projectDir))?.config ?? null;
}

async function loadStateFromDir(
  projectDir: string,
  options: Record<string, unknown>,
): Promise<StateData> {
  const data = await readStateData(projectDir);
  if (!data) {
    throw new Error(
      `No state file found at ${resolveStatePath(projectDir)}. Cannot resume — run without --resume to start fresh.`,
    );
  }

  if (options.skipDb) data.config.skipDb = true;
  if (options.skipAddons) data.config.skipAddons = true;
  if (options.skipGit) data.config.skipGit = true;

  p.log.info(
    `Resuming from state file — ${data.completedTasks.length} task(s) already completed`,
  );

  return data;
}

async function rederivePackageResolvedPaths(config: ViterexConfig): Promise<void> {
  if (!config.preset || config.preset === "custom") return;

  let loaded: Awaited<ReturnType<typeof loadPreset>>;
  try {
    loaded = await loadPreset(config.preset);
  } catch (err) {
    p.log.warn(
      `Could not re-resolve preset "${config.preset}" on resume: ${(err as Error).message}. ` +
        `Tasks that depend on preset files (apply-preset-files, seed-database, deployer extras) will be skipped.`,
    );
    return;
  }
  if (!loaded) return;

  config.presetDir = loaded.dir;

  if (loaded.config.seedFile) {
    config.seedFile = resolveSeedFile(loaded.config.seedFile, loaded.dir);
  }
  if (loaded.config.installerConfig) {
    config.installerConfig = path.resolve(loaded.dir, loaded.config.installerConfig);
  }
  if (loaded.config.deployerExtras?.length) {
    config.deployerExtras = loaded.config.deployerExtras.map((f) =>
      path.resolve(loaded.dir, f),
    );
  }

  const filesDirName = loaded.config.filesDir ?? "files";
  const filesDirPath = path.resolve(loaded.dir, filesDirName);
  if (await pathExists(filesDirPath)) {
    config.presetFilesDir = filesDirPath;
  }
}

/**
 * Save state after a task completes.
 *
 * Package-resolved paths (see `PACKAGE_RESOLVED_FIELDS`) are stripped before
 * writing. They get re-derived on resume from the persisted `preset` field.
 */
export async function saveState(
  config: ViterexConfig,
  completedTasks: string[]
): Promise<void> {
  const statePath = resolveStatePath(config.projectDir);
  await fs.mkdir(path.dirname(statePath), { recursive: true });

  const persisted: Record<string, unknown> = { ...config };
  for (const key of PACKAGE_RESOLVED_FIELDS) {
    delete persisted[key];
  }

  const data = { config: persisted, completedTasks };
  await writeJSON(statePath, data);
}
