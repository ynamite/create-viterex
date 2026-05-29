# create-viterex

Create CLI tool to scaffold a ViteRex project (Redaxo CMS + Vite JS + Tailwind CSS). Published as `npx create-viterex`.
Analyse the current state of the codebase for an up-to-date overview of the current architecture (root directory, setup/). The new implementation will be in `src/`, which already contains some typescript files outlining the intended structure. Pay close attention to the current shell script in `setup/` for the actual commands being run, as these will need to be translated into the new TypeScript implementation.

## Architecture

Three-layer design:

1. **Config collection** (`src/prompts.ts`) — Interactive terminal prompts via `@clack/prompts`. Collects project name, Redaxo version, DB credentials, addon selection, package manager choice. Bypassable with `--config path/to/config.json` for CI/automated use.

2. **Task pipeline** (`src/pipeline.ts`) — Ordered array of `Task` objects, each with `name`, optional `skip` predicate, and async `run` function. Tasks execute sequentially with spinner feedback. Each task is idempotent — safe to re-run on failure.

3. **Individual tasks** (`src/tasks/`) — Each file does one thing via `execa` shell commands:
   - `download-redaxo.ts` — curl + unzip Redaxo release from GitHub
   - `setup-database.ts` — DROP IF EXISTS + CREATE via mysql CLI
   - `install-redaxo.ts` — `php redaxo/bin/console setup:run` with flags
   - `install-addons.ts` — Loop: download → install → activate per addon via Redaxo CLI
   - `scaffold-frontend.ts` — Copy template files and generate .env
   - `install-deps.ts` — composer install + yarn/npm/pnpm install
   - `init-git.ts` — `initGitRepo` (git init, early — `git submodule add` needs `.git`) + `gitInitialCommit` (the **last** file-touching task, so the user ends on a clean `git status`). Build + browserslist refresh run before the commit; push/browser/next-steps run after it and touch no tracked files.

## Tech stack

- TypeScript, ESM, built with `tsup`
- `@clack/prompts` — terminal UI (same lib as create-svelte, nuxi)
- `commander` — CLI arg parsing and --flags
- `execa` — shell command execution (no shell injection, proper error handling)
- `chalk` — colored output
- `fs-extra` — file operations
- `ora` — spinners (used in pipeline)

## Key types

- `ViterexConfig` (`src/types.ts`) — Single config object passed through entire pipeline
- `AddonSelection` — Per-addon install/activate state with optional plugins
- `ADDON_CATALOG` — Static list of available Redaxo addons with recommended defaults
- `Task` (`src/pipeline.ts`) — `{ name, skip?, run }` interface

## Preset `addons` format

A preset's `addons` field accepts two interchangeable forms — strings (`"adminer"`) or full `AddonSelection` objects (`{ key, install, activate, plugins? }`). Strings are normalized to objects at load time in `src/preset.ts#loadPreset` via `normalizePresetAddon`; for keys present in `ADDON_CATALOG`, the matching `plugins` are auto-applied (mirroring the multiselect path in `prompts.ts`). Mixed arrays work. See `presets/default/preset.json` for the shorthand form; the external `viterex-massif-preset` repo (consumed via `--preset <path>`) uses the verbose object form.

## Preset value resolution (skip prompts)

A `preset.json` may set **any** installer field declared on `PresetConfig` (`src/types.ts`) — Redaxo admin/error email, server name, version, admin user/password; DB host/port/name/user/password and `skipDb`; `packageManager`, `setupDeploy`; `skipGit`, the `gitProvider`/`gitNamespace`/`gitRepoName` remote trio, `withTower`; `verbose`, `forcePush`. **When the preset supplies a value, that prompt is skipped** (a one-line `Using values from preset '<name>': …` summary is logged); fields the preset omits are still prompted. Precedence is **CLI flag > preset value > prompt/default**, resolved in `src/utils/resolve-preset-values.ts` (pure, unit-tested) and consumed in `src/prompts.ts` (loaded right after the project-name prompt so all later prompts can be skipped). Notes: an empty `gitProvider` (`""`) means "explicitly no remote"; `dbName` stays prompted unless the preset sets it (it's per-project); a preset `redaxoAdminPassword` is honoured only if it satisfies Redaxo's 8–4096-char rule, else it's ignored with a warning and prompted. The `--config <path>` path is unaffected — it loads a full `ViterexConfig` and bypasses prompts entirely.

## Build & run

```bash
pnpm install
pnpm build            # tsup → dist/
node bin/cli.js       # dev run
pnpm dev              # same thing
pnpm test             # vitest
```

Published usage: `npx create-viterex [project-name] [--flags]`

Releases are tag-triggered: push a `v*` tag and `.github/workflows/release.yml` builds, tests, publishes to npm with provenance (via Trusted Publishers / OIDC — no `NPM_TOKEN`), and opens a GitHub Release. Pre-release versions (`-alpha.N` / `-beta.N` / `-rc.N`) auto-publish under the matching dist-tag; stable goes to `latest`. See the README "Releasing" section.

## CLI flags

- `--skip-db` — skip database creation
- `--skip-addons` — skip addon installation
- `--skip-git` — don't init git repo
- `--pm <yarn|npm|pnpm>` — package manager (default: pnpm)
- `--config <path>` — load config from JSON file, skip all prompts

## Templates

The `templates/` directory contains `.tpl` files that get copied/transformed into the project. Uses `{{PLACEHOLDER}}` token replacement. Needs to be populated with:

- `base/` — static files copied as-is (LocalValetDriver.php, etc.)

## Redaxo-specific notes

- Redaxo releases download from `https://github.com/redaxo/redaxo/releases/download/{version}/redaxo_{version}.zip`
- CLI commands: `php redaxo/bin/console setup:run`, `package:download`, `package:install`, `package:activate`
- Plugin keys use slash notation: `addonname/pluginname`
- The exact CLI flags for `setup:run` need to be verified against the targeted Redaxo version — they may vary

## TODO

Shipped work has moved to `CHANGELOG.md`. Remaining open items are grouped by theme.

### Product / roadmap

- [x] Publish to npm as `create-viterex`
- [x] Publish `viterex_addon` to the Redaxo installer (separate repo)
- [x] Swap `install-submodule-addons.ts` for a Redaxo-installer install once `viterex_addon` is published — it's the shared frontend logic and should be installed by default
- [x] Ship default `templates/base/package.json.tpl` with Vite + Tailwind deps and scripts (token replacement for project name) – Update: ships with `viterex_addon` stubs instead.
- [x] Ship default `templates/base/vite.config.js.tpl`, `tailwind.config.js.tpl`, `index.js`, `.gitignore.tpl` – same as above re: `viterex_addon` stubs
- [x] `--generate-config` flag: run prompts, write JSON, exit (for CI)
- [x] Prompt for `redaxo_installer_config.json` contents instead of copying the hard-coded `templates/redaxo/redaxo_installer_config.json`; skip the step entirely when the user provides nothing — preset can also supply the file via `installerConfig`

### Decouple from MASSIF

- [x] Support a user-level `~/.viterex/addons.json` that adds extra entries to `ADDON_CATALOG` for interactive selection across projects — presets already cover per-project submodule-addons and template replacements
- [x] Remove `gittower` call from `open-browser.ts` (or gate behind a preset/flag) — currently hard-wired for the MASSIF workflow

### Bugs / cleanup (found during the current review)

- [x] Task "Install dependencies (composer + packages)" failed: Command failed with exit code 1: pnpm install
      \u2009ERR_PNPM_NO_PKG_MANIFEST\u2009 No package.json found in /Users/yvestorres/Herd/viterex-setup-test/my-viterex-project
       ERR_PNPM_NO_PKG_MANIFEST  No package.json found in /Users/yvestorres/Herd/viterex-setup-test/my-viterex-project
- [x] Delete unused `src/tasks/setup-database.ts` — never imported; DB is created inline by `setup:run --db-createdb=yes`
- [x] Fix `scripts/test-run.sh`: `CLI` points to `src/dist/index.js`, should be `dist/index.js`
- [x] Update `README.md` addon table to match `ADDON_CATALOG` (drop `plyr`, `markitup`, `redactor`, `yform_quick_edit`); replace `massifSettings` docs with `templateReplacements`
- [x] Allow `--resume` with `--config` (derive project dir from the config file, not only from the positional arg) in `src/state.ts#loadState`
- [x] Stop silent `git push --force` fallback in `create-git-remote.ts` — prompt or require an explicit `--force` flag
- [x] Honour `skipDb` in `install-redaxo.ts` (currently still passes DB creds and `--db-createdb=yes`)
- [x] Make `install-redaxo.ts` locale/timezone configurable (prompt defaults: `de_de` / `Europe/Berlin`)
- [x] Surface dev-server failures: `start-dev-server.ts` uses `stdio: "ignore"` — write to a log file or inherit when `--verbose` — superseded: dev server is no longer started by the installer; "Show next steps" prints the run command instead
- [x] Handle Windows in `open-browser.ts` (`start` command) or gracefully skip
- [x] before finishing up and showing next steps, we should clear Redaxo cache again using `php redaxo/bin/console cache:clear` to prevent stale content/templates/modules etc.

### Tooling

- [x] Add `tsup.config.ts` so the build is declarative
- [x] Rename `pnpm run dev` → `pnpm dev`
- [x] Add a minimal Vitest unit test for `replacePlaceholders` (in `scaffold-frontend.ts`) and the `loadState` migration logic
- [x] Add CI (GitHub Actions) running `pnpm build` + `scripts/test-run.sh`
