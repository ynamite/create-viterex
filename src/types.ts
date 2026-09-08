export type Layout = "modern" | "classic" | "classic+theme";
export type InstallMode = "fresh" | "augment";

export interface ViterexConfig {
  projectName: string;
  projectDir: string;

  // Detection
  layout: Layout;
  installMode: InstallMode;

  // Redaxo
  redaxoVersion: string;
  redaxoAdminUser: string;
  redaxoAdminPassword: string;
  redaxoAdminEmail: string;
  redaxoErrorEmail: string;
  redaxoServerName: string;
  redaxoLang: string;
  redaxoTimezone: string;

  // Database
  skipDb: boolean;
  dbHost: string;
  dbPort: number;
  dbName: string;
  dbUser: string;
  dbPassword: string;

  // Addons & Plugins
  skipAddons: boolean;
  addons: AddonSelection[];

  // Vite / Frontend
  packageManager: "bun" | "yarn" | "npm" | "pnpm";

  // Preset
  preset: string;
  presetDir?: string;
  presetLayout?: Layout;        // pass-through of preset.config.layout (when set)
  presetFilesDir?: string;      // absolute path to <presetDir>/<filesDir>; only set if dir exists
  seedFile?: string;
  submoduleAddons?: SubmoduleAddon[];
  templateReplacements: Record<string, string>;

  // Deployment
  setupDeploy: boolean;

  // Git
  skipGit: boolean;
  gitProvider: string;
  gitNamespace: string;
  gitRepoName: string;

  // Runtime flags (not persisted to config files)
  verbose: boolean;
  forcePush?: boolean;
  withTower?: boolean;

  // Preset-derived (resolved to absolute paths in prompts.ts)
  installerConfig?: string;     // absolute path to a redaxo_installer_config.json
  deployerExtras?: string[];    // absolute paths to .php files included in deploy.php

  // Prompt-derived (set only when no preset.installerConfig)
  installerApiLogin?: string;
  installerApiKey?: string;
}

export interface AddonSelection {
  key: string; // e.g. "yrewrite"
  install: boolean;
  activate: boolean;
  plugins?: string[]; // optional plugin keys to activate
  version?: string; // optional version pin for install:download
}

/**
 * Input form of a preset addon. Strings are shorthand for
 * `{ key, install: true, activate: true, plugins: <from ADDON_CATALOG> }`
 * and are normalized to full `AddonSelection` objects at load time
 * (`src/preset.ts#loadPreset`). Both forms can be mixed in the same array.
 */
export type PresetAddonInput = string | AddonSelection;

/**
 * A preset's installer configuration.
 *
 * Any scalar field below that maps to an interactive prompt follows one rule:
 * **when the preset sets it, that value is used and the prompt is skipped**
 * (a CLI flag still wins over the preset). Fields the preset omits are
 * prompted as usual. The resolution lives in `src/utils/resolve-preset-values.ts`.
 */
export interface PresetConfig {
  name: string;
  description: string;
  addons?: PresetAddonInput[];
  submoduleAddons?: SubmoduleAddon[];
  seedFile?: string; // relative to preset dir
  templateReplacements?: Record<string, string>;
  customPrompts?: CustomPromptDef[];
  installerConfig?: string; // relative to preset dir
  deployerExtras?: string[]; // .php paths relative to preset dir; required'd at deploy.php line 31 + added to clear_paths
  layout?: Layout; // when set AND files/ exists, validated against the user's chosen layout
  filesDir?: string; // relative to preset dir; defaults to "files"; contents copied into projectDir — a package-deps.json inside is merged into package.json instead of copied

  // Redaxo (each skips its prompt when set)
  redaxoVersion?: string;
  redaxoServerName?: string; // local vhost URL
  redaxoAdminUser?: string;
  /**
   * Admin password. Discouraged — a password in a committed preset is a
   * security smell. Omit it to be prompted (the recommended default). When
   * set it must satisfy Redaxo's 8–4096-char rule, else it's ignored and
   * the prompt runs instead.
   */
  redaxoAdminPassword?: string;
  redaxoAdminEmail?: string;
  redaxoErrorEmail?: string;
  redaxoLang?: string; // e.g. "de_de"
  redaxoTimezone?: string; // e.g. "Europe/Berlin"

  // Database (each skips its prompt when set; dbName stays prompted unless given)
  skipDb?: boolean;
  dbHost?: string;
  dbPort?: number;
  dbName?: string;
  dbUser?: string;
  dbPassword?: string;

  // Frontend / deploy
  packageManager?: "bun" | "yarn" | "npm" | "pnpm";
  setupDeploy?: boolean;

  // Git
  skipGit?: boolean;
  gitProvider?: string; // ""  = explicitly no remote; non-empty = remote host, skips the remote prompts
  gitNamespace?: string;
  gitRepoName?: string;
  withTower?: boolean; // when set, replaces the "Add to Git Tower?" prompt (still macOS + gittower-gated)

  // Runtime flags
  verbose?: boolean;
  forcePush?: boolean;
}

/**
 * Parsed CLI flags. A flag, when present, takes precedence over the preset
 * value for the same field.
 */
export interface CliOptions {
  pm?: string;
  preset?: string;
  layout?: string;
  skipDb?: boolean;
  skipAddons?: boolean;
  skipGit?: boolean;
  fresh?: boolean;
  forcePush?: boolean;
  withTower?: boolean;
  lang?: string;
  timezone?: string;
  generateConfig?: boolean | string;
}

export interface SubmoduleAddon {
  url: string;
  path: string;
  packageKey: string;
  /** Branch to track (`git submodule add -b`). Defaults to the remote HEAD. */
  branch?: string;
  hasComposerDeps?: boolean;
}

export interface CustomPromptDef {
  key: string;
  message: string;
  placeholder?: string;
  initialValue?: string;
  required?: boolean;
}

/**
 * Baseline addons installed regardless of preset choice.
 *
 * Order matters — addons earlier in the list must be activated before later
 * ones so dependencies resolve:
 *   - structure: no addon deps (core only)
 *   - phpmailer: no addon deps
 *   - developer: no addon deps
 *   - yform:     no addon deps; required by yrewrite
 *   - yrewrite:  requires structure + yform (both above)
 *   - ydeploy:   no hard deps on the others; placed before viterex
 *   - viterex_addon: LAST so consumer addons that activate later (e.g. redaxo-massif)
 *                    see it as available when their install.php fires. Installed
 *                    via `install:download viterex_addon` from redaxo.org.
 */
export const ALWAYS_INCLUDED: AddonSelection[] = [
  { key: "structure", install: true, activate: true, plugins: ["history"] },
  { key: "phpmailer", install: true, activate: true },
  { key: "developer", install: true, activate: true },
  { key: "yform", install: true, activate: true },
  { key: "yrewrite", install: true, activate: true },
  { key: "ydeploy", install: true, activate: true },
  { key: "viterex_addon", install: true, activate: true },
];

// Addons NOT in ALWAYS_INCLUDED but offered as recommended extras.
// Baseline keys are intentionally excluded so the multiselect doesn't double-list them.
export const ADDON_CATALOG: AddonEntry[] = [
  { key: "be_tools", label: "BE Tools (backend enhancements)", recommended: true },
  { key: "sprog", label: "Sprog (i18n / variables)", recommended: true },
  { key: "url", label: "URL (custom URL profiles)", recommended: true },
  { key: "adminer", label: "Adminer (DB management)", recommended: true },
  { key: "bloecks", label: "Bloecks (block editor)", recommended: true },
  { key: "focuspoint", label: "Focuspoint (image focal point)", recommended: true },
  { key: "mblock", label: "MBlock (repeatable fields)", recommended: true },
  { key: "mform", label: "MForm (module form builder)", recommended: true },
  { key: "quick_navigation", label: "Quick Navigation", recommended: true },
  { key: "cropper", label: "Cropper (image cropping)", recommended: true },
  { key: "hyphenator", label: "Hyphenator (auto-hyphenation)", recommended: true },
  { key: "emailobfuscator", label: "Email Obfuscator", recommended: true },
  { key: "structure_tweaks", label: "Structure Tweaks", recommended: true },
  { key: "cke5", label: "CKEditor 5 (WYSIWYG editor)", recommended: true },
  { key: "ui_tools", label: "UI Tools", recommended: true, plugins: ["jquery-minicolors", "selectize"] },
  { key: "uploader", label: "Uploader (media upload)", recommended: true },
  { key: "useragent", label: "Useragent (device detection)", recommended: true },
  { key: "yform_adminer", label: "YForm Adminer", recommended: true },
  { key: "yform_spam_protection", label: "YForm Spam Protection", recommended: true },
  { key: "yform_usability", label: "YForm Usability", recommended: true },
  { key: "media_negotiator", label: "Media Negotiator (WebP/AVIF)", recommended: true },
  { key: "statistics", label: "Statistics", recommended: true },
  { key: "be_password", label: "BE Password (password policy)", recommended: true },
  { key: "block_peek", label: "Block Peek (slice preview)", recommended: true },
];

export interface AddonEntry {
  key: string;
  label: string;
  recommended: boolean;
  plugins?: string[];
}
