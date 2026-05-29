import type { CliOptions, PresetConfig, ViterexConfig } from "../types.js";

export interface ResolvedGitRemote {
  provider: string;
  namespace: string;
  repoName: string;
}

/**
 * Resolution of preset/CLI values for the interactive `--preset` flow.
 *
 * For every prompt-backed field, a concrete value means "use it and SKIP the
 * prompt"; `undefined` means "prompt as usual". `skipDb`/`verbose`/`forcePush`
 * have no prompt, so they always carry a final boolean. Precedence per field is
 * **CLI flag > preset value > undefined**.
 */
export interface ResolvedPresetValues {
  // Prompt-backed — value ⇒ skip prompt; undefined ⇒ prompt.
  packageManager?: ViterexConfig["packageManager"];
  redaxoVersion?: string;
  redaxoServerName?: string;
  redaxoAdminUser?: string;
  redaxoAdminPassword?: string;
  redaxoAdminEmail?: string;
  redaxoErrorEmail?: string;
  redaxoLang?: string;
  redaxoTimezone?: string;
  dbHost?: string;
  dbPort?: number;
  dbName?: string;
  dbUser?: string;
  dbPassword?: string;
  setupDeploy?: boolean;
  skipGit?: boolean;
  withTower?: boolean;
  /**
   * Present ⇒ the preset specified the git remote, so skip the remote prompts.
   * An empty `provider` means "explicitly no remote" (createGitRemote skips on
   * falsy provider). Undefined ⇒ prompt for a remote as usual.
   */
  gitRemote?: ResolvedGitRemote;

  // No prompt — always a final value.
  skipDb: boolean;
  verbose: boolean;
  forcePush: boolean;

  /** PresetConfig keys whose value was taken from the preset (for a summary log line). */
  fromPreset: string[];
  /** Non-fatal notes for the caller to surface (e.g. an ignored bad password). */
  warnings: string[];
}

const PASSWORD_MIN = 8;
const PASSWORD_MAX = 4096;

/**
 * Pure resolution of preset + CLI flags into per-field values. No I/O, no
 * prompts — so it can be unit-tested in isolation. The caller (`prompts.ts`)
 * prompts only for fields that come back `undefined`.
 */
export function resolvePresetValues(
  preset: PresetConfig | undefined,
  options: CliOptions,
): ResolvedPresetValues {
  const fromPreset: string[] = [];
  const warnings: string[] = [];

  /** CLI flag wins; else preset (recorded); else undefined ⇒ prompt. */
  const pick = <T>(key: string, cli: T | undefined, presetVal: T | undefined): T | undefined => {
    if (cli !== undefined) return cli;
    if (presetVal !== undefined) {
      fromPreset.push(key);
      return presetVal;
    }
    return undefined;
  };

  // Admin password: only honour a preset value that satisfies Redaxo's rule;
  // otherwise ignore it (with a note) so the prompt + retry path handles it.
  let redaxoAdminPassword: string | undefined;
  if (preset?.redaxoAdminPassword !== undefined) {
    const pw = preset.redaxoAdminPassword;
    if (pw.length >= PASSWORD_MIN && pw.length <= PASSWORD_MAX) {
      redaxoAdminPassword = pw;
      fromPreset.push("redaxoAdminPassword");
    } else {
      warnings.push(
        `Preset admin password ignored (Redaxo rule: ${PASSWORD_MIN}–${PASSWORD_MAX} chars) — you'll be prompted.`,
      );
    }
  }

  // Git remote: the preset declaring `gitProvider` (even as "") fully specifies
  // the remote, so we skip all three remote prompts.
  let gitRemote: ResolvedGitRemote | undefined;
  if (preset?.gitProvider !== undefined) {
    gitRemote = {
      provider: preset.gitProvider,
      namespace: preset.gitNamespace ?? "",
      repoName: preset.gitRepoName ?? "",
    };
    fromPreset.push("gitProvider");
  }

  // No-prompt booleans — resolve to a final value, record when preset-sourced.
  const skipDb = options.skipDb ?? preset?.skipDb ?? false;
  if (options.skipDb === undefined && preset?.skipDb !== undefined) fromPreset.push("skipDb");

  const verbose = preset?.verbose ?? false;
  if (preset?.verbose !== undefined) fromPreset.push("verbose");

  const forcePush = options.forcePush ?? preset?.forcePush ?? false;
  if (options.forcePush === undefined && preset?.forcePush !== undefined) fromPreset.push("forcePush");

  return {
    packageManager: pick(
      "packageManager",
      options.pm as ViterexConfig["packageManager"] | undefined,
      preset?.packageManager,
    ),
    redaxoVersion: pick("redaxoVersion", undefined, preset?.redaxoVersion),
    redaxoServerName: pick("redaxoServerName", undefined, preset?.redaxoServerName),
    redaxoAdminUser: pick("redaxoAdminUser", undefined, preset?.redaxoAdminUser),
    redaxoAdminPassword,
    redaxoAdminEmail: pick("redaxoAdminEmail", undefined, preset?.redaxoAdminEmail),
    redaxoErrorEmail: pick("redaxoErrorEmail", undefined, preset?.redaxoErrorEmail),
    redaxoLang: pick("redaxoLang", options.lang, preset?.redaxoLang),
    redaxoTimezone: pick("redaxoTimezone", options.timezone, preset?.redaxoTimezone),
    dbHost: pick("dbHost", undefined, preset?.dbHost),
    dbPort: pick("dbPort", undefined, preset?.dbPort),
    dbName: pick("dbName", undefined, preset?.dbName),
    dbUser: pick("dbUser", undefined, preset?.dbUser),
    dbPassword: pick("dbPassword", undefined, preset?.dbPassword),
    setupDeploy: pick("setupDeploy", undefined, preset?.setupDeploy),
    skipGit: pick("skipGit", options.skipGit, preset?.skipGit),
    withTower: pick("withTower", options.withTower, preset?.withTower),
    gitRemote,
    skipDb,
    verbose,
    forcePush,
    fromPreset,
    warnings,
  };
}
