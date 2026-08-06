# Bun Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `bun` as a fourth package manager (default when installed, else `pnpm`) across the installer, presets, and the ydeploy/Deployer template — and fix the `--pm` commander-default bug that made the PM prompt dead code.

**Architecture:** `packageManager` is a single union type threaded through `ViterexConfig`. Changes are: widen the union, remove the commander default (so flag > preset > prompt actually holds), detect bun on PATH for the prompt default, stamp `"packageManager"` into the scaffolded `package.json`, use per-PM dlx runners, and template the chosen PM into `deploy.php` with a fallback chain.

**Tech Stack:** TypeScript ESM, commander, @clack/prompts, execa, vitest. Spec: `docs/superpowers/specs/2026-08-06-bun-support-design.md`.

## Global Constraints

- Package-manager union everywhere is exactly: `"bun" | "yarn" | "npm" | "pnpm"` (extend the two existing unions in `src/types.ts`; do not reorder existing members).
- Default resolution: `--pm` flag > preset `packageManager` > prompt; prompt default is `bun` when on PATH, else `pnpm`.
- `deploy.php` asset commands run on `host('local')` (verified in ydeploy) — the chosen PM is pinned first, the `bun → pnpm → yarn → npm` chain is fallback only.
- Deployer's own `{{release_path}}` placeholders in `deploy.php.tpl` must survive rendering (`replacePlaceholders` only substitutes provided keys — never add a catch-all).
- Run tests with `pnpm exec vitest run <file>`; full suite with `pnpm test`; typecheck with `pnpm exec tsc --noEmit` (vitest does NOT typecheck — esbuild strips types). Never start dev servers.
- Commit after each task; end commit messages with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Widen the type union + fix the `--pm` commander-default bug

**Files:**
- Modify: `src/types.ts:35` and `src/types.ts:131`
- Modify: `src/index.ts:32`
- Test: `src/utils/__tests__/resolve-preset-values.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ViterexConfig["packageManager"]` = `"bun" | "yarn" | "npm" | "pnpm"` (same on `PresetConfig`); `CliOptions.pm` stays `string | undefined` but is now genuinely `undefined` unless the user passes `--pm`.

**Background for the implementer:** `--pm` currently has a commander hard default `"pnpm"`. Because CLI flags beat presets in `resolvePresetValues` (`src/utils/resolve-preset-values.ts:104-108`), `resolved.packageManager` is never `undefined`, so the PM prompt in `prompts.ts` never fires and a preset's `packageManager` can never win. Removing the default fixes both.

- [ ] **Step 1: Write the failing tests** — append to the `describe("resolvePresetValues", …)` block in `src/utils/__tests__/resolve-preset-values.test.ts`:

```ts
  it("passes a preset packageManager 'bun' through when no --pm flag is set", () => {
    const preset: PresetConfig = { ...base, packageManager: "bun" };
    const r = resolvePresetValues(preset, NO_OPTS);

    expect(r.packageManager).toBe("bun");
    expect(r.fromPreset).toContain("packageManager");
  });

  it("lets an explicit --pm flag beat the preset packageManager", () => {
    const preset: PresetConfig = { ...base, packageManager: "pnpm" };
    const r = resolvePresetValues(preset, { pm: "bun" });

    expect(r.packageManager).toBe("bun");
    expect(r.fromPreset).not.toContain("packageManager");
  });
```

- [ ] **Step 2: Verify the red state via the type checker**

Vitest strips types with esbuild, so these tests already PASS at runtime (`resolvePresetValues` is an untyped passthrough for this field) — the failing state lives in the type system:

Run: `pnpm exec tsc --noEmit`
Expected: FAIL — `Type '"bun"' is not assignable to type '"yarn" | "npm" | "pnpm"'` in the test file. (Baseline: `tsc --noEmit` is clean before this task.)

- [ ] **Step 3: Widen both unions in `src/types.ts`**

Line 35 (in `ViterexConfig`):

```ts
  packageManager: "bun" | "yarn" | "npm" | "pnpm";
```

Line 131 (in `PresetConfig`):

```ts
  packageManager?: "bun" | "yarn" | "npm" | "pnpm";
```

- [ ] **Step 4: Remove the commander default in `src/index.ts:32`**

Replace:

```ts
  .option("--pm <manager>", "Package manager for JS deps after Redaxo install: pnpm | yarn | npm", "pnpm")
```

with (note: no third argument):

```ts
  .option("--pm <manager>", "Package manager for JS deps after Redaxo install: bun | pnpm | yarn | npm (default: bun if installed, else pnpm)")
```

- [ ] **Step 5: Verify green — types and tests**

Run: `pnpm exec tsc --noEmit && pnpm exec vitest run src/utils/__tests__/resolve-preset-values.test.ts`
Expected: tsc clean; all tests in the file PASS.

- [ ] **Step 6: Verify the flag no longer advertises a default**

Run: `pnpm build && node bin/cli.js --help | grep -A1 -- '--pm'`
Expected: the `--pm` line does NOT contain `(default: "pnpm")`.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/index.ts src/utils/__tests__/resolve-preset-values.test.ts
git commit -m "feat: add bun to package-manager union; drop --pm commander default

The hard default made options.pm always defined, so the PM prompt was
dead code and a preset packageManager could never apply. Precedence is
now genuinely flag > preset > prompt.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `detectDefaultPm` helper + prompt options + fail-fast validation

**Files:**
- Create: `src/utils/detect-pm.ts`
- Modify: `src/prompts.ts:141-154` (the `packageManager` block)
- Test: `src/utils/__tests__/detect-pm.test.ts`

**Interfaces:**
- Consumes: `commandExists(cmd: string): Promise<boolean>` from `src/utils/exec.ts` (already exists, already imported in `prompts.ts`).
- Produces: `detectDefaultPm(has?: (cmd: string) => Promise<boolean>): Promise<PackageManager>` and `PACKAGE_MANAGERS: PackageManager[]` (= `["bun", "pnpm", "yarn", "npm"]`) from `src/utils/detect-pm.ts`; `PackageManager` is an alias of `ViterexConfig["packageManager"]`.

- [ ] **Step 1: Write the failing test** — create `src/utils/__tests__/detect-pm.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { detectDefaultPm, PACKAGE_MANAGERS } from "../detect-pm.js";

describe("detectDefaultPm", () => {
  it("returns bun when bun is on PATH", async () => {
    expect(await detectDefaultPm(async (cmd) => cmd === "bun")).toBe("bun");
  });

  it("falls back to pnpm when bun is missing", async () => {
    expect(await detectDefaultPm(async () => false)).toBe("pnpm");
  });

  it("lists all four package managers, bun first", () => {
    expect(PACKAGE_MANAGERS).toEqual(["bun", "pnpm", "yarn", "npm"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/utils/__tests__/detect-pm.test.ts`
Expected: FAIL — cannot resolve `../detect-pm.js`.

- [ ] **Step 3: Create `src/utils/detect-pm.ts`**

```ts
import type { ViterexConfig } from "../types.js";
import { commandExists } from "./exec.js";

export type PackageManager = ViterexConfig["packageManager"];

/** Selection/display order: detected default first. */
export const PACKAGE_MANAGERS: PackageManager[] = ["bun", "pnpm", "yarn", "npm"];

/**
 * Default package manager for new projects: bun when it's on PATH, else pnpm.
 * The installer runs via `npx`, so only Node/npm are guaranteed — a hard bun
 * default would break machines without it. `has` is injectable for tests.
 */
export async function detectDefaultPm(
  has: (cmd: string) => Promise<boolean> = commandExists,
): Promise<PackageManager> {
  return (await has("bun")) ? "bun" : "pnpm";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/utils/__tests__/detect-pm.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite the PM block in `src/prompts.ts`**

Add to the imports at the top of the file:

```ts
import { detectDefaultPm, PACKAGE_MANAGERS, type PackageManager } from "./utils/detect-pm.js";
```

Replace the existing block (lines 141–154):

```ts
  let packageManager = resolved.packageManager;
  if (packageManager === undefined) {
    const answer = await p.select({
      message: "Package manager",
      initialValue: (options.pm as ViterexConfig["packageManager"]) ?? "pnpm",
      options: [
        { value: "pnpm", label: "pnpm", hint: "fast, strict, content-addressable store (default)" },
        { value: "yarn", label: "Yarn", hint: "Yarn 1.x — wide ecosystem compatibility" },
        { value: "npm",  label: "npm",  hint: "bundled with Node — slowest install" },
      ],
    });
    if (p.isCancel(answer)) process.exit(0);
    packageManager = answer as ViterexConfig["packageManager"];
  }
```

with:

```ts
  let packageManager = resolved.packageManager;
  if (packageManager === undefined) {
    const installed = new Set<PackageManager>();
    for (const pm of PACKAGE_MANAGERS) {
      if (await commandExists(pm)) installed.add(pm);
    }
    const hint = (pm: PackageManager, base: string) =>
      installed.has(pm) ? base : `${base} — not installed`;
    const answer = await p.select({
      message: "Package manager",
      initialValue: await detectDefaultPm(),
      options: [
        { value: "bun",  label: "bun",  hint: hint("bun", "fastest — default when installed") },
        { value: "pnpm", label: "pnpm", hint: hint("pnpm", "fast, strict, content-addressable store") },
        { value: "yarn", label: "Yarn", hint: hint("yarn", "Yarn 1.x — wide ecosystem compatibility") },
        { value: "npm",  label: "npm",  hint: hint("npm", "bundled with Node — slowest install") },
      ],
    });
    if (p.isCancel(answer)) process.exit(0);
    packageManager = answer as ViterexConfig["packageManager"];
  }

  // Fail fast: an unknown or not-installed PM (from --pm, a preset, or the
  // select above) would otherwise die mid-pipeline in install-deps.
  if (!PACKAGE_MANAGERS.includes(packageManager)) {
    p.log.error(
      `Unknown package manager '${packageManager}' — use one of: ${PACKAGE_MANAGERS.join(", ")}.`,
    );
    process.exit(1);
  }
  if (!(await commandExists(packageManager))) {
    p.log.error(
      `Package manager '${packageManager}' is not installed (not found on PATH).`,
    );
    process.exit(1);
  }
```

Note: `--pm` no longer feeds `initialValue` — with the Task 1 fix, a passed `--pm` makes `resolved.packageManager` defined, so the prompt is skipped entirely (that's the documented behavior).

- [ ] **Step 6: Build to typecheck**

Run: `pnpm build`
Expected: clean tsup build, no TS errors.

- [ ] **Step 7: Commit**

```bash
git add src/utils/detect-pm.ts src/utils/__tests__/detect-pm.test.ts src/prompts.ts
git commit -m "feat: detect bun as default PM, add bun to prompt, fail fast on missing PM

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: install-deps — bun upgrade entry + `packageManager` stamp

**Files:**
- Modify: `src/tasks/install-deps.ts`
- Test: `src/tasks/__tests__/stamp-package-manager.test.ts` (create)

**Interfaces:**
- Consumes: `exec` from `src/utils/exec.ts`, `pathExists` from `src/utils/fs.ts`.
- Produces: `stampPackageManagerField(projectDir: string, spec: string): Promise<void>` exported from `src/tasks/install-deps.ts` (spec is e.g. `"bun@1.2.20"`).

- [ ] **Step 1: Write the failing test** — create `src/tasks/__tests__/stamp-package-manager.test.ts`:

```ts
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stampPackageManagerField } from "../install-deps.js";

async function tmpProject(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "viterex-stamp-"));
}

describe("stampPackageManagerField", () => {
  it("adds the packageManager field and preserves tab indentation", async () => {
    const dir = await tmpProject();
    await writeFile(
      path.join(dir, "package.json"),
      '{\n\t"name": "x",\n\t"scripts": {\n\t\t"dev": "vite"\n\t}\n}\n',
    );

    await stampPackageManagerField(dir, "bun@1.2.20");

    const raw = await readFile(path.join(dir, "package.json"), "utf-8");
    const pkg = JSON.parse(raw);
    expect(pkg.packageManager).toBe("bun@1.2.20");
    expect(pkg.scripts.dev).toBe("vite");
    expect(raw).toContain('\t"name"'); // indentation style kept
    expect(raw.endsWith("\n")).toBe(true);
  });

  it("is a no-op when package.json is missing", async () => {
    const dir = await tmpProject();
    await expect(stampPackageManagerField(dir, "bun@1.2.20")).resolves.toBeUndefined();
  });

  it("overwrites an existing packageManager field (idempotent re-run)", async () => {
    const dir = await tmpProject();
    await writeFile(path.join(dir, "package.json"), '{\n  "packageManager": "pnpm@9.0.0"\n}\n');

    await stampPackageManagerField(dir, "pnpm@10.0.0");

    const pkg = JSON.parse(await readFile(path.join(dir, "package.json"), "utf-8"));
    expect(pkg.packageManager).toBe("pnpm@10.0.0");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/tasks/__tests__/stamp-package-manager.test.ts`
Expected: FAIL — `stampPackageManagerField` is not exported.

- [ ] **Step 3: Implement in `src/tasks/install-deps.ts`** — full new file content:

```ts
import path from "node:path";
import fs from "node:fs/promises";
import { exec } from "../utils/exec.js";
import { pathExists } from "../utils/fs.js";
import type { ViterexConfig } from "../types.js";

/**
 * Pin the chosen package manager in package.json, e.g.
 * `"packageManager": "pnpm@10.12.1"`. Corepack enforces the field for
 * pnpm/yarn/npm; for bun it's informational — but corepack-shimmed PMs refuse
 * to run in a bun project, which guards against wrong-PM installs. Runs before
 * the dep install so the field lands in the lockfile and the initial commit.
 * Keeps the file's existing indentation style (viterex_addon stubs use tabs).
 */
export async function stampPackageManagerField(
  projectDir: string,
  spec: string,
): Promise<void> {
  const pkgPath = path.join(projectDir, "package.json");
  if (!(await pathExists(pkgPath))) return;
  const raw = await fs.readFile(pkgPath, "utf-8");
  const indent = raw.match(/^[ \t]+/m)?.[0] ?? "\t";
  const pkg = JSON.parse(raw);
  pkg.packageManager = spec;
  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, indent) + "\n");
}

export async function installDependencies(config: ViterexConfig): Promise<void> {
  const { projectDir, packageManager, verbose } = config;

  // Run composer install
  await exec("composer", ["install", "--no-interaction", "--quiet"], {
    cwd: projectDir,
    verbose,
  });

  const { stdout } = await exec(packageManager, ["--version"], { cwd: projectDir });
  await stampPackageManagerField(projectDir, `${packageManager}@${String(stdout).trim()}`);

  // Run JS package manager install
  await exec(packageManager, ["install"], {
    cwd: projectDir,
    verbose,
  });

  // Upgrade dependencies — these commands are interactive and need a TTY
  const upgradeCmd: Record<string, string[]> = {
    yarn: ["upgrade-interactive"],
    npm: ["outdated"], // npm has no built-in interactive upgrade
    pnpm: ["update", "--interactive", "--latest"],
    bun: ["update", "--interactive", "--latest"],
  };

  const args = upgradeCmd[packageManager];
  if (args) {
    await exec(packageManager, args, {
      cwd: projectDir,
      stdio: "inherit",
    });
  }
}
```

- [ ] **Step 4: Verify bun's `--interactive` flag exists on the installed bun**

Run: `bun update --help 2>&1 | grep -e '--interactive' || echo "NO INTERACTIVE FLAG"`
Expected: a line describing `-i, --interactive`. If it prints `NO INTERACTIVE FLAG`, change the bun entry to `bun: ["outdated"]` (same pattern as npm) and note it in the commit message.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run src/tasks/__tests__/stamp-package-manager.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/tasks/install-deps.ts src/tasks/__tests__/stamp-package-manager.test.ts
git commit -m "feat: stamp packageManager field into project package.json; bun upgrade cmd

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: build-frontend — per-PM dlx runner for browserslist

**Files:**
- Modify: `src/tasks/build-frontend.ts:17-23`

**Interfaces:**
- Consumes: `ViterexConfig["packageManager"]` (now includes `"bun"`).
- Produces: nothing new (internal change only).

- [ ] **Step 1: Replace the hardcoded `npx` call**

In `src/tasks/build-frontend.ts`, replace:

```ts
  try {
    await exec("npx", ["update-browserslist-db@latest"], { cwd: projectDir, verbose });
  } catch (err) {
```

with:

```ts
  // Refresh browserslist via the chosen PM's package runner. yarn 1.x has no
  // dlx equivalent, so it uses npx — Node is always present (the installer
  // itself runs on it).
  const dlx: Record<ViterexConfig["packageManager"], [string, string[]]> = {
    bun: ["bunx", ["update-browserslist-db@latest"]],
    pnpm: ["pnpm", ["dlx", "update-browserslist-db@latest"]],
    yarn: ["npx", ["update-browserslist-db@latest"]],
    npm: ["npx", ["update-browserslist-db@latest"]],
  };
  try {
    const [cmd, args] = dlx[packageManager];
    await exec(cmd, args, { cwd: projectDir, verbose });
  } catch (err) {
```

(The rest of the function is unchanged — both steps stay best-effort warn-and-continue.)

- [ ] **Step 2: Build to typecheck**

Run: `pnpm build`
Expected: clean build. The `Record` over the union also proves exhaustiveness — a missing PM key is a compile error.

- [ ] **Step 3: Commit**

```bash
git add src/tasks/build-frontend.ts
git commit -m "feat: use per-PM dlx runner for update-browserslist-db

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: deploy.php.tpl — pin chosen PM, add bun + all lockfiles; wire the token

**Files:**
- Modify: `templates/deploy/deploy.php.tpl` (lines 47-52 area for `$removeOnRelease`; lines 70-107 for the assets blocks)
- Modify: `src/tasks/scaffold-frontend.ts:127-135` (the deploy `processTemplate` call)
- Test: `src/__tests__/deploy-template.test.ts` (create)

**Interfaces:**
- Consumes: `replacePlaceholders(content: string, map: Record<string, string>): string` from `src/utils/replace-placeholders.ts` — substitutes ONLY provided keys; Deployer's own `{{release_path}}` tokens must remain untouched.
- Produces: `deploy.php.tpl` now requires a `PACKAGE_MANAGER` key at render time (supplied by `scaffold-frontend.ts`).

- [ ] **Step 1: Write the failing test** — create `src/__tests__/deploy-template.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { replacePlaceholders } from "../utils/replace-placeholders.js";

const TPL_URL = new URL("../../templates/deploy/deploy.php.tpl", import.meta.url);

describe("deploy.php.tpl", () => {
  it("pins the chosen PM, keeps Deployer placeholders, clears all lockfiles", async () => {
    const tpl = await readFile(TPL_URL, "utf-8");
    const out = replacePlaceholders(tpl, {
      PROJECT_NAME: "demo",
      PACKAGE_MANAGER: "bun",
      DEPLOYER_EXTRAS: "",
      DEPLOYER_EXTRAS_CLEAR_PATHS: "",
    });

    // Chosen PM is checked first and used verbatim.
    expect(out).toContain("commandExist('bun')");
    expect(out).toContain("'bun install'");
    expect(out).toContain("'bun run build'");
    expect(out).not.toContain("{{PACKAGE_MANAGER}}");

    // Deployer's own runtime placeholders must survive rendering.
    expect(out).toContain("{{release_path}}");

    // Every PM's lockfile is removed from releases.
    for (const lock of [
      "bun.lock",
      "bun.lockb",
      "package-lock.json",
      "pnpm-lock.yaml",
      "yarn.lock",
    ]) {
      expect(out).toContain(`'${lock}',`);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/__tests__/deploy-template.test.ts`
Expected: FAIL — `commandExist('bun')` / lockfile assertions unmet (template not yet changed).

- [ ] **Step 3: Update `$removeOnRelease` in `templates/deploy/deploy.php.tpl`**

Insert `'bun.lock',` and `'bun.lockb',` after `'biome.jsonc',`; insert `'package-lock.json',` after `'package.json',`; insert `'yarn.lock',` after `'vite.config.js',`. The affected region becomes:

```php
    'biome.jsonc',
    'bun.lock',
    'bun.lockb',
    'CLAUDE.md',
```

```php
    'package.json',
    'package-lock.json',
    'pnpm-lock.yaml',
```

```php
    'vite.config.js',
    'yarn.lock',
    '.yarn',
```

- [ ] **Step 4: Replace the `assets_install` / `assets_build` blocks in the template**

Replace lines 70–107 (both `set(...)` blocks) with:

```php
// The build runs on host('local') (see ydeploy's deploy task), so the package
// manager chosen at scaffold time is normally present. The chain below is a
// fallback only — e.g. when a teammate without that PM deploys.
set('assets_install', static function () {
    if (!test('[ -f {{release_path}}/package.json ]')) {
        return false;
    }
    if (commandExist('{{PACKAGE_MANAGER}}')) {
        return '{{PACKAGE_MANAGER}} install';
    }
    warning('{{PACKAGE_MANAGER}} not found — falling back to the first available package manager');
    foreach (['bun', 'pnpm', 'yarn', 'npm'] as $pm) {
        if (commandExist($pm)) {
            return $pm . ' install';
        }
    }

    return false;
});

set('assets_build', static function () {
    if (!get('assets_install')) {
        return false;
    }

    if (!test('[ -f {{release_path}}/webpack.config.js ]') && test('[ -d {{release_path}}/gulpfile.js ]')) {
        return 'APP_ENV=prod node_modules/.bin/gulp build';
    }

    if (commandExist('{{PACKAGE_MANAGER}}')) {
        return '{{PACKAGE_MANAGER}} run build';
    }
    foreach (['bun', 'pnpm', 'yarn', 'npm'] as $pm) {
        if (commandExist($pm)) {
            return $pm . ' run build';
        }
    }

    return false;
});
```

(`<pm> install` and `<pm> run build` are valid for all four PMs, so plain token interpolation works. `warning()` is a Deployer 7 built-in.)

- [ ] **Step 5: Wire the token in `src/tasks/scaffold-frontend.ts`**

In the deploy `processTemplate` call (~line 127), add `PACKAGE_MANAGER`:

```ts
    await processTemplate(
      path.join(deployDir, "deploy.php.tpl"),
      path.join(projectDir, "deploy.php"),
      {
        ...replacements,
        PACKAGE_MANAGER: config.packageManager,
        DEPLOYER_EXTRAS: requiresBlock,
        DEPLOYER_EXTRAS_CLEAR_PATHS: clearPathsBlock,
      },
    );
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm exec vitest run src/__tests__/deploy-template.test.ts`
Expected: PASS.

- [ ] **Step 7: Sanity-check the rendered PHP parses**

Run: `php -l <(sed -e "s/{{PACKAGE_MANAGER}}/bun/g" -e "s/{{PROJECT_NAME}}/demo/g" -e "s/{{DEPLOYER_EXTRAS}}//" -e "s/{{DEPLOYER_EXTRAS_CLEAR_PATHS}}//" templates/deploy/deploy.php.tpl)`
Expected: `No syntax errors detected`.

- [ ] **Step 8: Commit**

```bash
git add templates/deploy/deploy.php.tpl src/tasks/scaffold-frontend.ts src/__tests__/deploy-template.test.ts
git commit -m "feat: pin chosen package manager in deploy.php, add bun + all lockfiles

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Documentation (README + CLAUDE.md)

**Files:**
- Modify: `README.md:65` (flag table), `README.md:138` (config JSON docs), plus the preset-docs mention of `packageManager` if present
- Modify: `CLAUDE.md` ("CLI flags" section: `--pm <yarn|npm|pnpm>` line)

**Interfaces:** none — docs only.

- [ ] **Step 1: Update `README.md`**

Flag table row (line 65) — replace with:

```markdown
| `--pm <manager>`     | Package manager for JS deps: `bun` \| `pnpm` \| `yarn` \| `npm`      | `bun` if installed, else `pnpm` |
```

Config docs (line 138) — replace with:

```markdown
  "packageManager": "pnpm",          // "bun" | "yarn" | "npm" | "pnpm"
```

Search for other `"yarn" | "npm" | "pnpm"` mentions in README preset docs (`grep -n '"yarn"' README.md`) and add `"bun"` consistently.

- [ ] **Step 2: Update `CLAUDE.md`**

In "CLI flags", replace:

```markdown
- `--pm <yarn|npm|pnpm>` — package manager (default: pnpm)
```

with:

```markdown
- `--pm <bun|pnpm|yarn|npm>` — package manager (default: bun if installed, else pnpm)
```

- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: document bun package-manager support and detected default

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Full verification + bun smoke

**Files:** none (verification only).

- [ ] **Step 1: Full unit-test suite**

Run: `pnpm test`
Expected: all tests pass (including the new detect-pm, stamp, deploy-template, and resolve-preset-values tests).

- [ ] **Step 2: Build + smoke script**

Run: `pnpm build && bash scripts/test-run.sh`
Expected: all smoke tests PASS.

- [ ] **Step 3: bun install/build smoke against the real stubs**

The viterex_addon stubs are the actual `package.json` a scaffolded project gets. Verify bun handles them (esbuild postinstall is on bun's default trusted list — this proves it):

```bash
SMOKE=$(mktemp -d)
cp ~/Repositories/viterex/viterex_addon/stubs/package.json ~/Repositories/viterex/viterex_addon/stubs/vite.config.js ~/Repositories/viterex/viterex_addon/stubs/main.js ~/Repositories/viterex/viterex_addon/stubs/style.css "$SMOKE"/
cd "$SMOKE" && bun install && bun run build; cd -; rm -rf "$SMOKE"
```

Expected: `bun install` succeeds and `bun run build` produces a Vite build (or fails only on project-specific paths — an esbuild/postinstall failure is the thing this step must NOT show). If `vite build` needs more stub context (e.g. `.env`), a successful `bun install` + vite binary starting is sufficient; note the result.

- [ ] **Step 4: Report**

No commit. Report test/smoke output to the user; a full end-to-end `create-viterex --pm bun` scaffold against a real MySQL/Herd environment remains a manual user step (documented here deliberately — it needs local DB credentials).
