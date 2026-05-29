# Changelog

All notable changes to `create-viterex` are documented here. Format based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project aims to
follow [Semantic Versioning](https://semver.org/) once a stable release ships.
Alpha and beta versions live in their own version sections; in-progress work
lives under `[Unreleased]`.

## [Unreleased]

### Added (2026-05-29)

- **Presets can pre-fill — and thereby skip — any installer prompt.** A `preset.json` may now set any scalar installer field (`redaxoVersion`, `redaxoServerName`, `redaxoAdminUser`/`redaxoAdminPassword`/`redaxoAdminEmail`/`redaxoErrorEmail`, `redaxoLang`, `redaxoTimezone`, `skipDb`, `dbHost`/`dbPort`/`dbName`/`dbUser`/`dbPassword`, `packageManager`, `setupDeploy`, `skipGit`, `gitProvider`/`gitNamespace`/`gitRepoName`, `withTower`, `verbose`, `forcePush`). When the preset supplies a value the matching prompt is skipped and a one-line `Using values from preset '<name>': …` summary is logged. Previously these fields existed on `ViterexConfig` but were never read from a preset (only `redaxoLang`/`redaxoTimezone`/`layout`/`withTower`/`filesDir`/addons/seed/installer/deployer fields were), so e.g. a preset's `redaxoAdminEmail` was silently ignored and prompted for anyway. Precedence is **CLI flag > preset value > prompt/default**. New pure, unit-tested resolver `src/utils/resolve-preset-values.ts`; `PresetConfig` (`src/types.ts`) extended with the fields and `CliOptions` moved there for shared use; `src/prompts.ts` now loads the preset right after the project-name prompt so all later prompts can be skipped. Notes: the git remote resolves per field — empty `gitProvider` (`""`) = no remote; a non-empty `gitProvider` configures a remote with `gitNamespace` from the preset (else prompted) and `gitRepoName` **always prompted** (default: project name) unless the preset pins it; an omitted `gitProvider` runs the normal opt-in flow. `dbName` stays prompted (per-project) unless the preset sets it; a preset `redaxoAdminPassword` is honoured only if it meets Redaxo's 8–4096-char rule, else ignored with a warning and prompted. The `--config <path>` path is unchanged.

### Fixed (2026-05-29)

- **`git status` is clean immediately after install.** The *Git initial commit* task is now the **last** file-touching step in the pipeline (`src/pipeline.ts`). Previously *Build frontend* (Vite output) and the browserslist refresh ran *after* the commit, leaving the freshly-scaffolded working tree dirty. *Build frontend* now runs before the commit (and absorbs the `npx update-browserslist-db@latest` refresh that used to live in *Show next steps*, each step warn-and-continue); the remote push, browser open, and next-steps message run after the commit and touch no tracked files. `git init` still runs early (before *Add submodule addons*, which needs `.git`); only the commit moved. Task count unchanged (18); names unchanged, so `--resume` is unaffected. New ordering test: `src/__tests__/pipeline-order.test.ts`.

### Changed (2026-05-19)

- **A preset's frontend now installs through the generic `filesDir` overlay.** The short-lived dedicated `frontendDir` task was folded into *Apply preset files*: a preset directory whose tree mirrors the project (`src/…`, `public/…`) is copied verbatim, and a `package-deps.json` placed in it is merged into the project `package.json` (additive, higher-version-wins) before the dependency install instead of being copied. New helper `src/utils/merge-package-deps.ts`. Consumed by the external `viterex-massif-preset` repo (`"filesDir": "frontend"`).

## [3.0.0-alpha.1] - 2026-05-19

### Changed (2026-05-08)

- **Default `--pm` flipped from `yarn` → `pnpm`.** The interactive package-manager select also reorders `pnpm` to first position; existing `--pm yarn` invocations and existing configs pinning `"packageManager": "yarn"` continue to work — only the default for new installs changes.

### Fixed (2026-05-08)

- **`--preset <directory>` no longer crashes with `EISDIR`.** `loadPreset` (`src/preset.ts`) now accepts both a path to a `preset.json` file AND a path to a directory containing one; `dir` correctly anchors at the preset folder, so downstream relative paths (`filesDir`, `seedFile`, `installerConfig`, `deployerExtras`) resolve as intended. Four new tests in `src/__tests__/preset.test.ts` lock the file/directory/missing-preset.json/seed-anchor behaviours.
- **`--config <directory>` no longer crashes with `EISDIR`.** Same pattern applied to `loadConfigFile` (extracted to `src/utils/load-config.ts` so it can be tested in isolation; importing from `src/index.ts` would have triggered `program.parse()`) and `resolveTargetDir`. Three new tests in `src/utils/__tests__/load-config.test.ts`.

### Added (2026-05-08)

- **Per-option `hint` text in interactive prompts.** Package-manager, preset, and layout selects now show one-line hints next to each option (`@clack/prompts`'s `hint` field). Preset hints come from each `preset.json#description`; built-in preset descriptions were shortened to fit (the prior long-form text wasn't displayed anywhere).
- **`PresetSummary` type exported from `src/preset.ts`.** `discoverPresets()` returns `Promise<PresetSummary[]>` (was `Promise<string[]>`) so each entry can carry an optional description for hint UX. Single consumer (`src/prompts.ts`) updated atomically.
- **Clearer `--help` strings for `--pm`, `--preset`, `--config`, `--layout`** (`src/index.ts`). Each flag's purpose is now legible standalone — readers don't need the README to disambiguate `--config` from `--preset`.
- **README explainer paragraph** above the Options table distinguishing `--preset` ("starting point — pre-fills some answers") from `--config` ("pins every answer; for CI"). Flag-table description cells rewritten to match.

## [3.0.0-alpha.0] - 2026-05-07

### Added (2026-05-01)

- **Pipeline task: `Clear Redaxo cache`** (`src/tasks/clear-cache.ts`). Runs `php <console> cache:clear --no-interaction` between *Create remote git repository* (step 14) and *Open frontend and backend in browser* (step 16) so the just-opened browser doesn't show stale templates / modules / asset paths left behind by `setup:run`, addon install, `viterex:install-stubs`, or submodule activation. No skip predicate — `cache:clear` is idempotent and cheap; runs in both fresh and augment mode. Pipeline grew from 16 → 17 steps.
- **Pipeline task: `Build frontend`** (`src/tasks/build-frontend.ts`). Runs `<pm> run build` between *Sync developer + clear cache* (step 15) and *Open frontend and backend in browser* (step 17). Skip predicate: `!fs.existsSync(<projectDir>/package.json)`. Non-fatal — a failed build prints a warning and the pipeline continues to *Show next steps*. Without this, the just-opened browser would 404 on Vite prod assets (`/assets/addons/viterex_addon/*`) on first load. `<pm>` is the user's chosen package manager (`yarn` / `npm` / `pnpm`). Pipeline grew from 17 → 18 steps.
- **`withTower` preset key** (`PresetConfig.withTower?: boolean`). When `false`, suppresses the new "Add the repo to Git Tower?" prompt entirely. Default-preset value is `false`. The field was previously declared on `ViterexConfig` but never read from `PresetConfig` — `presets/default/preset.json` already shipped `"withTower": false` but was being silently ignored.
- **Tower opt-in prompt** in the Git block of `src/prompts.ts`. macOS-only; gated on `gittower` being on PATH AND `preset.withTower !== false` AND the user actually opting in to *Initialize a local git repository?*. Sits between the local-repo and remote-repo prompts. Default value mirrors the preset's `withTower` (true → pre-checked, unset → no by default). The legacy `--with-tower` CLI flag still composes — when set, it forces Tower regardless of the prompt outcome.

### Changed (2026-05-01)

- **`apply-preset-files` now overwrites individual files** (`src/tasks/apply-preset-files.ts:28` — `fs.copy(presetFilesDir, projectDir, { overwrite: true })`) instead of skipping. Folder structure is still merged: pre-existing siblings outside the preset's tree are preserved, only files that exist on both sides are replaced by the preset version. Closes the surprise where a preset shipping an updated `.env.example` would silently no-op on re-run if the file already existed. The corresponding test was renamed from *preserves existing destination files (skip-if-exists)* to *overwrites existing destination files*; a new *merges folder contents without removing pre-existing siblings* test pins the merge invariant.
- **`open-browser.ts` Tower invocation strictly gated on `withTower`.** The previous `withTower || (await commandExists("gittower"))` fallback at `open-browser.ts:18` opened Tower for any macOS user with the binary installed, regardless of intent. Strict gate closes the *Decouple from MASSIF* TODO item — Tower now opens only when the user explicitly opted in via the prompt, the `--with-tower` flag, or `preset.withTower === true`.
- **Step 15 renamed: `Clear Redaxo cache` → `Sync developer + clear cache`.** `clearCache` now runs `php <console> developer:sync --no-interaction` before `cache:clear` (idempotent; gated on the `developer` addon being active in `config.addons`; warn-and-continue on failure for `--augment` setups where the addon may be absent). Without `developer:sync`, freshly-scaffolded templates / modules / actions weren't picked up by the public frontend until something else triggered a sync — typically the user logging into the backend, which is non-obvious and made the *Open browser* step appear broken. `developer` is in `ALWAYS_INCLUDED`, so the sync runs in fresh mode by default.
- **`state.ts` strips package-resolved paths on save** (`presetDir`, `presetFilesDir`, `seedFile`, `installerConfig`, `deployerExtras`) and re-derives them on `loadState` by re-running `loadPreset(config.preset)` against the *current* installer location. Without this, an `npx create-viterex --resume` after the npx cache hash rotated would chase paths into a garbage-collected directory. As a side benefit, preset-side edits to `seed.sql.tpl` / `files/` between runs are now picked up on resume. The persisted `preset` field (a string like `"default"` or an absolute path to an external preset) is the single source of truth on resume; everything package-relative gets re-resolved. Three new tests in `state-migration.test.ts` lock the round-trip behaviour: built-in preset re-derivation, `preset === "custom"` no-op, missing-preset warn-and-continue.
- **Pipeline grew from 17 → 18 steps.**
- **`Sync developer + clear cache` moved from step 15 → step 13.** It now runs immediately after *Activate submodule addons* and before *Git initial commit*. `developer:sync` can write filesystem-side templates / modules pulled out of the DB, and they need to land in the initial commit instead of leaving the project with dirty working-tree state on first `git status`. Step indices shifted: *Git initial commit* 13→14, *Create remote git repository* 14→15.

### Added (2026-04-30)

- **Preset extension: `filesDir` and `layout`.** Presets can ship arbitrary files via a `files/` directory copied verbatim into the project root with skip-if-exists semantics — branding assets, sample workflow files, custom config, anything that should land somewhere in the user's project tree.
  - `filesDir` (`string`, relative to preset dir; defaults to `"files"`) — directory copied verbatim into `projectDir` with `overwrite: false`. Internal structure mirrors the project tree as the preset author intends it on disk (e.g. `files/src/assets/img/logo.svg` lands at `<projectDir>/src/assets/img/logo.svg`).
  - `layout` (`"modern" | "classic" | "classic+theme"`) — optional layout-lock. When set AND a `files/` dir exists, the new `apply-preset-files` task aborts with a clear error before any file is touched if the user's chosen layout disagrees. When set, the layout prompt is skipped (the preset's value is used unless `--layout` overrides).
  - New pipeline task `apply-preset-files` (`src/tasks/apply-preset-files.ts`) slotted between *Scaffold frontend* (step 6) and *Seed database* (now step 8). Skip predicate: `!c.presetFilesDir`. The task validates `presetLayout` against the resolved `layout` before running `fs.copy(presetFilesDir, projectDir, { overwrite: false })`.
  - Prompt order changed: preset selection now runs before layout selection so a preset's `layout` can suppress the layout prompt. CLI `--layout` still wins for assignment; mismatches surface at the apply-preset-files task with a hard error before any file is touched.
  - Wired in `src/types.ts` (new fields on `PresetConfig` and `ViterexConfig`), `src/prompts.ts` (preset block reordered above layout; `presetLayout` / `presetFilesDir` resolved after `loadPreset`), `src/tasks/apply-preset-files.ts` (new), `src/pipeline.ts` (task registered).
  - Test coverage in `src/tasks/__tests__/apply-preset-files.test.ts` (5 tests over the validation table: no-op, copy when layout unset, copy when layout matches, throw on mismatch, skip-if-exists).
- **Preset extension: `installerConfig` and `deployerExtras`.** Presets can now ship personal/site-specific files instead of leaking them into default templates.
  - `installerConfig` (`string`, relative to preset dir) — a `redaxo_installer_config.json` copied to `<dataDir>/addons/install/config.json`. Skips the new credentials prompt when set.
  - `deployerExtras` (`string[]`, relative to preset dir) — `.php` files copied to the project root, `require`'d in `deploy.php` (via the new `{{DEPLOYER_EXTRAS}}` placeholder) and added to its `clear_paths` (via `{{DEPLOYER_EXTRAS_CLEAR_PATHS}}`).
  - Wired in `src/types.ts` (PresetConfig + ViterexConfig), `src/prompts.ts` (resolved to absolute paths after `loadPreset`), and `src/tasks/scaffold-frontend.ts` (three-way installer-config decision; deploy-extras expansion + post-render `\n{3,}` collapse).
- **REDAXO Installer credentials prompt.** Fresh installs now ask `Configure REDAXO Installer API credentials? (no/yes)` (default: no) when no preset declares `installerConfig`. A confirmed answer collects username + API key and writes `{ backups: true, api_login, api_key }` to `<dataDir>/addons/install/config.json`. Augment mode skips the prompt entirely.
- **`--generate-config [path]` and `--force` flags.** Run the prompt flow, write `viterex.json` (or a custom path) excluding runtime-only fields (`verbose`, `forcePush`, `withTower`), then exit. Refuses to overwrite an existing file unless `--force` is passed. `--config` is ignored when `--generate-config` is set.
- **Build and test infrastructure.**
  - `tsup.config.ts` at the repo root replaces inline build args; `scripts.build` is now just `tsup`.
  - Vitest as a dev dep with three targeted unit tests:
    - `src/utils/__tests__/replace-placeholders.test.ts` — placeholder substitution, missing-key fallback, repeated occurrences.
    - `src/utils/__tests__/baseline.test.ts` — `mergeBaselineAddons` drops legacy `viterex` key, preserves user-customised baseline entries, keeps non-baseline extras in original order, idempotent.
    - `src/__tests__/state-migration.test.ts` — `loadState` backfills `layout`/`installMode`/`redaxoLang`/`redaxoTimezone`; legacy `massifSettings` migrates to `templateReplacements`.
  - `pnpm test` script (`vitest run`).
- **GitHub Actions CI** at `.github/workflows/ci.yml`. Triggers on push and PRs to `main`. Pipeline: checkout → pnpm 9 → Node 20 (with pnpm cache) → `pnpm install --frozen-lockfile` → `pnpm build` → `pnpm test` → `bash scripts/test-run.sh`. 10-minute job timeout.

### Changed (2026-04-30)

- Pipeline grew from 15 → 16 steps to accommodate the new *Apply preset files* task; the docblock count comment in `src/pipeline.ts` was generalized rather than re-counted.
- `templates/deploy/deploy.php.tpl` — line 31 (formerly the commented-out metanet require) is now `{{DEPLOYER_EXTRAS}}`; the hardcoded `'deployer.task.release.metanet.php',` clear_paths entry is replaced with `{{DEPLOYER_EXTRAS_CLEAR_PATHS}}`. Empty for the default preset; populated when a preset declares `deployerExtras`.
- `presets/massif/preset.json` adopts the new fields: `installerConfig: "redaxo_installer_config.json"` and `deployerExtras: ["deployer.task.release.metanet.php"]`. Both files live alongside the preset.
- `replacePlaceholders` extracted from `src/tasks/scaffold-frontend.ts` into `src/utils/replace-placeholders.ts` so it's importable from tests. Behaviour unchanged.

### Removed (2026-04-30)

- `templates/redaxo/redaxo_installer_config.json` (personal MASSIF API credentials previously installed by default into every fresh project). Now lives in `presets/massif/` and is opt-in via `installerConfig`.
- `templates/deploy/deployer.task.release.metanet.php` (Massif-specific Metanet release task). Now lives in `presets/massif/` and is opt-in via `deployerExtras`.

### Added (2026-04-29)

- **`Install viterex stubs (package.json, vite.config.js, ...)` pipeline task** (`src/tasks/install-viterex-stubs.ts`). Runs `php bin/console viterex:install-stubs --no-interaction` between *Install addons* (step 4) and *Scaffold frontend* (step 6). Triggers `Ynamite\ViteRex\StubsInstaller::run()` so `package.json`, `vite.config.js`, `.env.example`, `biome.jsonc`, `stylelint.config.js`, `.browserslistrc`, `.prettierrc`, `jsconfig.json`, plus `main.js` / `style.css` (under the configured `assets_source_dir`) land in the project root. Without this step, *Install dependencies* (step 8) would fail with `ERR_PNPM_NO_PKG_MANIFEST`. **Requires viterex_addon ≥ 3.2.0** (the `viterex:install-stubs` command was added there). Skip predicate: only runs when `viterex_addon` is in `addons[]` with `activate: true`. Idempotent — `StubsInstaller::run(false)` skips files that already exist.
- Pipeline grew from 14 → 15 steps to accommodate the stubs task.

### Removed (2026-04-29)

- Legacy utility scripts dropped from `templates/scripts/`: `quickstart`, `sync-config`, `sync-db`, `sync-media`. The `templates/scripts/` directory is gone. The corresponding copy block in `src/tasks/scaffold-frontend.ts` (the *5. Utility scripts* section that copied each into the project root with `+x`) has been removed.
- Step 15 no longer detaches a `<pm> run dev` background process. The old behaviour spawned an unkillable child that the user couldn't Ctrl-C from their terminal. Replaced by `src/tasks/show-next-steps.ts`: refreshes browserslist data (so the first manual `<pm> run dev` doesn't warn about stale browser tables) and prints a `Next step — start the Vite dev server: <pm> run dev` message. Filename `start-dev-server.ts` and helper `src/utils/log-file.ts` (only the dev-server log path) deleted; `.viterex-dev-server.log` removed from `init-git.ts` SAFETY_IGNORES.

### Added (2026-04-28)

- **Layout detection + augment mode** (`src/utils/detect.ts`). `detectInstallation(targetDir)` returns `{ mode, layout, present, consolePath }`. Three layouts: `modern`, `classic`, `classic+theme`. Modern is detected via `bin/console + src/path_provider.php`; classic via `redaxo/bin/console + no path_provider`; classic+theme adds `theme/` at root. When detection finds an existing Redaxo, the CLI switches to **augment mode** — skips download / `setup:run` / seed, prompts for which baseline addons to add on top of the existing install. Already-activated addons are pre-disabled in the checklist.
- **`ALWAYS_INCLUDED` baseline** in `src/types.ts`. Six addons installed in a fixed order regardless of preset choice: `structure (+history)`, `phpmailer`, `developer`, `yrewrite`, `ydeploy`, `viterex`. `viterex` is the **last** entry so consumer addons that subscribe to its `VITEREX_INSTALL_STUBS` extension point (chiefly `redaxo-massif`) see it as available when they activate. Presets contribute extras on top of the baseline (deduped by key).
- **`viterex` via `install:download`** — viterex_addon v3.1.0 is now published on the Redaxo installer registry, so it's installed via `php bin/console install:download viterex` like any other addon. No longer a git submodule. The `default` and `massif` presets drop their `viterex_addon` `submoduleAddons` entries; `src/preset.ts` filters legacy `packageKey: "viterex"` entries from old preset JSONs in the wild with a one-line warning.
- **`.tools/` Composer convention** (`src/tasks/configure-composer.ts`). New first-step pipeline task patches the project's `composer.json` to include `"config": { "vendor-dir": ".tools" }` and `"require": { "deployer/deployer": "^7.5" }`. Idempotent: parse-merge-write rather than overwrite. Matches the primobau convention.
- New CLI flags: `--layout <m|c|ct>`, `--fresh` (force fresh-install pipeline despite detection), `--force-push`, `--with-tower`, `--lang <locale>`, `--timezone <tz>`.
- `src/utils/log-file.ts` — opens the `.viterex-dev-server.log` append-mode fd used by `start-dev-server.ts` so subprocess errors are no longer swallowed.

### Changed (2026-04-28)

- **Pipeline reordered to 14 steps** (`src/pipeline.ts`). Configure-composer is now step 1. Submodule add/activate moved to *after* `Install dependencies (composer + pm)` (was previously between `Initialize git repo` and `Git initial commit`, which broke composer autoload). Submodule task split into two: `addSubmoduleAddons` (clone + register) and `activateSubmoduleAddons` (composer install per-submodule + Redaxo `package:install`/`activate`). Augment-mode skip set: steps 2 (Download Redaxo), 3 (Install Redaxo), 6 (Seed database).
- `download-redaxo.ts` — layout-aware. Modern path keeps the existing reorganisation. Classic / classic+theme unzip directly into project root with no file moves. Belt-and-braces idempotency: skip when the layout-specific console binary already exists.
- `install-redaxo.ts` — uses `consolePathFor(layout)` for the `bin/console` path. `--lang` and `--timezone` now sourced from `redaxoLang` / `redaxoTimezone` config fields (default `de_de` / `Europe/Berlin`, override via CLI flags). When `skipDb` is set, the inline DB drop block is skipped and `--db-createdb=no` is passed (the user is responsible for an empty DB at the given credentials). Idempotency: read `<dataDir>/core/config.yml` and skip when `setup: true`.
- `install-addons.ts`, `install-submodule-addons.ts`, `init-git.ts` — all use `consolePathFor(layout)` and `srcAddonsDirFor(layout)` (no more hard-coded `bin/console` / `src/addons/`). `init-git.ts` now skips `git init` when `.git/` exists and skips the initial commit when `HEAD` already exists; safety-ignores include `.tools` and `.viterex-dev-server.log`.
- `scaffold-frontend.ts` — uses `dataDirFor(layout)` and `srcAddonsDirFor(layout)`. The legacy `frontendAssetsRepo` clone-and-rsync block is **removed**: the MASSIF preset's frontend tree now arrives via `redaxo-massif`'s `install.php` (it calls `Ynamite\\ViteRex\\StubsInstaller::installFromDir()` once viterex activates). External preset authors who need that path can fork.
- `create-git-remote.ts` — silent `git push --force` fallback replaced with a hard error unless `--force-push` is set. Push target is the current branch via `git symbolic-ref --short HEAD`, no longer hardcoded to `main`.
- `open-browser.ts` — cross-platform: `start` on win32, `xdg-open` on Linux. Tower invocation gated on `--with-tower` OR `commandExists("gittower")` (added to `utils/exec.ts`).
- `start-dev-server.ts` — subprocess stdio writes to `<projectDir>/.viterex-dev-server.log` (or inherits when `--verbose`). Path printed via `p.log.info` after spawn.
- `state.ts:loadState` — accepts `--config` as the project-dir source (no positional name needed). Migration block backfills `layout` / `installMode` / `redaxoLang` / `redaxoTimezone` for older state files.
- `prompts.ts` — branched on `detection.mode`. Augment mode skips Redaxo / admin / DB prompts and runs the new augment-prompt checklist; fresh mode adds layout / lang / timezone selects. Final `addons` list assembled as `[...ALWAYS_INCLUDED, ...extras-deduped]`.
- `presets/default/preset.json` — emptied to `addons: []`, `submoduleAddons: []` (baseline now hard-coded). Just contributes the seed.
- `presets/massif/preset.json` — drops baseline addons (`structure`, `phpmailer`, `developer`, `yrewrite`, `ydeploy`), drops `viterex_addon` from `submoduleAddons`, drops `frontendAssetsRepo`. Keeps `redaxo_massif`, `massif_settings`, `massif_dnd_sorter` submodules and the 12 `customPrompts`.

### Removed (2026-04-28)

- Legacy `setup/` directory (bash `setup`, `setup.cfg`, `_htaccess`, `redaxo_massif_install.sql`, console / index stubs, deploy stubs). Reference-only since the TS port shipped; now gone.
- `src/tasks/setup-database.ts` — never imported (DB creation is inline in `setup:run --db-createdb=yes`).
- `frontendAssetsRepo` from `ViterexConfig` and `PresetConfig` (no longer used).

### Fixed (2026-04-28)

- `scripts/test-run.sh` — `CLI` path was `src/dist/index.js`; corrected to `dist/index.js`. Smoke-test scenarios updated for the 14-step pipeline + augment mode (7 scenarios: help/version, fresh modern, fresh classic, augment modern, augment classic, --resume + --config, legacy preset filter).

### Pipeline (current, 18 steps)

```
 1  Configure composer (.tools/, deployer)   — both modes
 2  Download Redaxo                          — skip when augment
 3  Install Redaxo                           — skip when augment OR setup_complete
 4  Install addons                           — both modes (idempotent)
 5  Install viterex stubs                    — requires viterex_addon ≥ 3.2.0
 6  Scaffold frontend                        — both modes
 7  Apply preset files                       — merge + overwrite; skip when no presetFilesDir
 8  Seed database                             — skip when augment OR --skip-db OR no seedFile
 9  Install dependencies (composer + pm)      — must run AFTER step 7 (preset can rewrite package.json)
10  Initialize git repo                       — skip if .git/ exists or --skip-git
11  Add submodule addons                      — runs AFTER deps
12  Activate submodule addons                 — composer install + package:install/activate
13  Sync developer + clear cache              — developer:sync (best-effort) → cache:clear; runs before the initial commit
14  Git initial commit                        — skip if HEAD exists or --skip-git
15  Create remote git repository              — skip if no provider or --skip-git
16  Build frontend                            — <pm> run build; skip if no package.json
17  Open frontend and backend in browser      — both
18  Show next steps                           — refresh browserslist + print next-step instructions
```

### Earlier work

- Preset system: `src/preset.ts` discovers `presets/*/preset.json`; external
  preset paths also accepted via `--preset <path>`. Ships two built-in
  presets: `default` (essential addon set + `viterex-addon` submodule) and
  `massif` (full MASSIF setup — 30 addons, four submodules including
  `redaxo_massif`, `massif_settings`, `massif_dnd_sorter`, twelve `MASSIF_*`
  custom prompts, and the `frontendAssetsRepo`). MASSIF-specific behaviour
  that used to live in the default flow is now isolated to the `massif`
  preset. (5fb8a37, 921cd90)
- `--resume` flag with `.viterex-state.json` — per-task recovery; state file
  is written after each task and removed on success. (`src/state.ts`)
- `--dry-run` flag — logs each task without executing it. (`src/pipeline.ts`)
- `--verbose` flag — pipes subprocess stdout/stderr to the terminal.
  (`src/utils/exec.ts`)
- `--config <path>` non-interactive mode, with automatic migration of old
  `massifSettings` config into the generic `templateReplacements` map.
- `--preset <name>` flag; external preset JSON paths accepted.
- Generic `{{PLACEHOLDER}}` token replacement in `scaffold-frontend.ts`,
  superseding the hard-coded `MASSIF_*` env vars from the bash setup.
- Interactive dependency upgrade step (`yarn upgrade-interactive`, `npm
  outdated`, `pnpm update --interactive --latest`) with TTY handoff via the
  `interactive` task flag. (9be07f2, `install-deps.ts`)
- Submodule-addon task: `git submodule add` for `viterex-addon` (and any
  additional entries a preset defines). (0488766, `install-submodule-addons.ts`)
- Frontend-assets repo merge: clone `frontendAssetsRepo`, strip `.git`, rsync
  into the project root without overwriting. (392d26f, end of
  `scaffold-frontend.ts`)
- Remote-repo creation for GitHub (`gh`) and GitLab (`glab`). (2ec4f29,
  `create-git-remote.ts`)
- Post-setup: open frontend + backend in the default browser; launch Tower
  on macOS if installed. (2e0742b, `open-browser.ts`)
- Start Vite dev server as the final pipeline step, detached so the CLI
  exits cleanly. (1f13b5a, `start-dev-server.ts`)
- 31-entry `ADDON_CATALOG` in `src/types.ts`, including plugin
  sub-selections (e.g. `ui_tools` → `jquery-minicolors`, `selectize`;
  `structure` → `history`). (cba7ea9)
- Admin email re-used as default for the Redaxo error email prompt.
  (2956e32)
- Rebranded banner in `src/utils/log.ts`. (bfb88c0)
- Basic smoke-test script at `scripts/test-run.sh` (currently broken — see
  Known issues).
- MySQL seed task (`import-sql.ts`) — runs post-scaffold, skipped when no
  `seedFile` is configured.

### Changed

- Full port of the 281-line bash `setup/setup` script to a TypeScript CLI
  with an ordered `Task` pipeline (`src/pipeline.ts`). Each task is
  idempotent and resumable.
- `massifSettings` config block replaced by generic `templateReplacements`
  map. `loadState` auto-migrates old state files written before the rename.
  (`src/state.ts`)
- Redaxo CLI PHP helpers (`bin/console`, `path_provider.php`,
  `index.frontend.php`, `index.backend.php`, `.htaccess`) are now copied in
  `download-redaxo.ts`, *before* `setup:run` runs — the previous order
  caused `setup:run` to fail. (f131e94)
- Config/template files moved to repo root; `dist/` added to `.gitignore`.
  (68a91a6)
- Default Redaxo version bumped to `5.20.2` in the interactive prompts.

### Fixed

- `install-redaxo.ts` now handles a pre-existing database on `--resume`:
  `mysqldump` to `backup_<db>_<ts>.sql`, then `DROP DATABASE`, so
  `setup:run` can re-create it cleanly.
- `create-git-remote.ts` tolerates an existing `origin` remote and an
  existing remote repo. (1749206, 4f0bb78)
- `.gitignore` from the frontend-assets repo is preserved during the rsync
  merge. (372002d)
- `tmp-assets/` cleanup runs in a `finally` block so it's removed even when
  the clone/rsync fails. (c617f5c)
- Dev-server subprocess is detached + unref'd so the parent CLI exits
  cleanly after launching it. (994c0d0)
- Dropped the Redaxo zip checksum check (upstream no longer publishes a
  stable SHA manifest). (1004357)
- Removed `fluid_tw` from the default catalog. (dd388c0)

### Pipeline (current)

```
1  Download Redaxo             (download-redaxo.ts)
2  Install Redaxo              (install-redaxo.ts) — drops + backs up DB if present
3  Install addons              (install-addons.ts)
4  Scaffold frontend           (scaffold-frontend.ts) — {{TOKEN}} replacement
5  Seed database               (import-sql.ts)        — skipped if no seedFile
6  Install dependencies        (install-deps.ts)      — composer + pm + upgrade
7  Initialize git repo         (init-git.ts)
8  Install submodule addons    (install-submodule-addons.ts)
9  Git initial commit          (init-git.ts)
10 Create remote git           (create-git-remote.ts)
11 Open browser                (open-browser.ts)
12 Start Vite dev server       (start-dev-server.ts)
```

### Known issues / not yet tracked elsewhere

See the `## TODO` section in `CLAUDE.md` for the full list. Highlights:

- `src/tasks/setup-database.ts` is dead code — never imported from the
  pipeline; DB creation is done inline by `setup:run --db-createdb=yes`.
- `scripts/test-run.sh` references `src/dist/index.js`; the build output
  lives at `dist/index.js`, so the smoke tests don't actually run.
- `README.md` addon table still lists `plyr`, `markitup`, `redactor`,
  `yform_quick_edit` (all removed) and documents the obsolete
  `massifSettings` config block.
- `--resume` requires the positional project-name argument; it can't infer
  the project dir from `--config`.
- `create-git-remote.ts` silently falls back to `git push --force` on any
  push failure.
- `install-redaxo.ts` ignores `skipDb` and hard-codes `--lang=de_de` /
  `--timezone=Europe/Berlin`.
- `open-browser.ts` has no Windows path and hard-codes the macOS-only
  `gittower` call.
- `start-dev-server.ts` uses `stdio: "ignore"`, hiding any startup errors.

### Migration from bash setup

The legacy `setup/` directory (bash `setup` script, `setup.cfg`,
`resetsetup`, `_htaccess`, `redaxo_massif_install.sql`, deploy stubs) is
kept for reference but is no longer used. Every command in the bash script
has an equivalent task in `src/tasks/`. Template files have moved to
`templates/` with `.tpl` suffixes and `{{PLACEHOLDER}}` tokens.