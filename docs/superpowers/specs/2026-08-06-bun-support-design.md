# Bun support with detected default — design

**Date:** 2026-08-06
**Repo:** create-viterex
**Status:** approved (pending final spec review)

## Goal

Add `bun` as a fourth package manager next to `pnpm`, `yarn`, `npm`, and make it the default when it is installed on the user's machine. Cover the full installation routine, presets, and the ydeploy/Deployer deployment template.

## Decisions

- **Default:** auto-detect — `bun` on PATH → default `bun`, otherwise `pnpm`. The installer runs via `npx`, so only Node/npm are guaranteed; a hard bun default would break the zero-setup experience.
- **deploy.php:** pin the chosen PM as the first `commandExist` check, keep the existing chain (plus bun) as fallback with a Deployer `warning()`. Safe because ydeploy runs the asset build on `host('local')` (verified in `ydeploy/deployer/tasks/deploy.php`: `on(host('local'), fn () => invoke('build'))`), where the chosen PM is guaranteed present.

## Bug fix (in scope)

`--pm` currently has a commander hard default of `"pnpm"` (`src/index.ts:32`). Because CLI flags beat presets in `src/utils/resolve-preset-values.ts`, `resolved.packageManager` is never `undefined`, so:

- the package-manager select prompt (`src/prompts.ts:143`) is dead code, and
- a preset's `packageManager` value can never take effect.

Fix: remove the commander default so `options.pm` is only defined when the user passes the flag. Documented precedence (flag > preset > prompt) then actually holds. Add a regression test.

## Changes

### 1. Types & CLI flag

- `src/types.ts` — add `"bun"` to the `packageManager` union on both `ViterexConfig` (line ~35) and `PresetConfig` (line ~131).
- `src/index.ts` — `--pm <manager>`: drop the `"pnpm"` default, update help text to `bun | pnpm | yarn | npm (default: bun if installed, else pnpm)`.

### 2. Detection & prompt (`src/prompts.ts`)

- New helper `detectDefaultPm()`: `bun` on PATH → `"bun"`, else `"pnpm"` (PATH check via a `which`-style lookup, e.g. execa).
- Select options list `bun` first, then `pnpm`, `yarn`, `npm`; any PM not on PATH gets a `(not installed)` hint. Initial value: `options.pm ?? detectDefaultPm()`.
- Fail fast: if the resolved PM (from `--pm` or a preset) is not installed, error out with a clear message before the pipeline starts, instead of failing mid-run in `install-deps`.

### 3. Task changes

- `src/tasks/install-deps.ts`
  - `<pm> install` already works for bun — no change to the install call.
  - Upgrade map gains `bun: ["update", "--interactive", "--latest"]`. Verify the `--interactive` flag against the current bun release during implementation; fall back to `["outdated"]` if unsupported.
  - **Stamp `packageManager` field:** before running `<pm> install`, write `"packageManager": "<pm>@<version>"` into the project `package.json`, with `<version>` from `<pm> --version`. Runs before the dep install so the lockfile and initial git commit both include it. Applies to all four PMs. Note: corepack does not recognize `bun` — that is acceptable and even useful: corepack-shimmed pnpm/yarn will refuse to run in a bun project instead of silently installing with the wrong PM.
- `src/tasks/build-frontend.ts` — replace the hardcoded `npx update-browserslist-db@latest` with the chosen PM's dlx runner:
  - bun → `bunx update-browserslist-db@latest`
  - pnpm → `pnpm dlx update-browserslist-db@latest`
  - npm → `npx update-browserslist-db@latest`
  - yarn (1.x) → `npx update-browserslist-db@latest` (yarn classic has no dlx)
- `src/tasks/show-next-steps.ts`, `src/tasks/patch-dev-script.ts` — no changes; `bun run dev` works as-is.

### 4. Deployment template (`templates/deploy/deploy.php.tpl`)

- New `{{PACKAGE_MANAGER}}` token, wired in `src/tasks/scaffold-frontend.ts` next to the existing `DEPLOYER_EXTRAS` replacements.
- `assets_install`: first check `commandExist('{{PACKAGE_MANAGER}}')` → `'{{PACKAGE_MANAGER}} install'`; then the existing chain extended with bun as fallback, emitting a Deployer `warning()` when the fallback is used.
- `assets_build`: same pattern with `'{{PACKAGE_MANAGER}} run build'` (`<pm> run build` is valid for all four PMs).
- `clear_paths` (`$removeOnRelease`): add `bun.lock`, `bun.lockb`, `yarn.lock`, `package-lock.json` alongside `pnpm-lock.yaml` — removing absent files is harmless.

### 5. Presets & docs

- Preset `"packageManager": "bun"` works via the type change plus the `--pm` bugfix (preset values now actually apply).
- `presets/massif/preset.json` stays pinned to `pnpm` for now (owner flips it when ready).
- README: `--pm` flag row, preset docs (`"yarn" | "npm" | "pnpm" | "bun"`), default description "bun if installed, else pnpm". CLAUDE.md CLI-flags section updated to match.

### 6. Tests & verification

- Unit (vitest):
  - `resolve-preset-values`: preset `packageManager: "bun"` passes through; **regression:** with no `--pm` flag, `options.pm` is `undefined` and a preset PM wins.
  - `detectDefaultPm()` behavior (mock PATH lookup).
- Smoke: one scaffold run with bun verifying `bun install` and `bun run build` succeed (esbuild is on bun's default trusted-dependencies list, so Vite's postinstall should run; the smoke run proves it).

## Out of scope

- Yarn 2+ (Berry) support — yarn stays 1.x as today.
- Installing bun for the user.
- Remote-host PM provisioning — deploy builds run locally by design.
