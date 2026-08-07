# Persist State File Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep `.viterex-state.json` after successful installs, offer to reuse its answers on re-run, and gitignore it so credentials stop landing in the scaffolded repo's git history.

**Architecture:** Three touch points: `src/state.ts` gains a `loadSavedConfig` helper and loses `clearState` (with `src/index.ts` dropping both call sites in the same change); `src/prompts.ts` offers a reuse-answers confirm early in `collectConfig`; `src/tasks/init-git.ts` merges the state filename into the project `.gitignore` right before the initial `git add .` via the existing `mergeGitignore` util.

**Tech Stack:** TypeScript ESM, @clack/prompts, vitest. Spec: `docs/superpowers/specs/2026-08-07-persist-state-file-design.md`.

## Global Constraints

- State filename is exactly `.viterex-state.json` (existing `STATE_FILE` const in `src/state.ts:9`); gitignore header is exactly `Added by create-viterex`.
- `--resume` and `--config` semantics are unchanged; neither reaches `collectConfig`, so the reuse prompt cannot interfere with them.
- Reuse runs the FULL pipeline: `completedTasks` stays `[]` on the reuse path (it is a re-run, not a resume).
- Passwords stay in the state file — no stripping, no encryption (owner decision).
- Run tests with `pnpm exec vitest run <file>`; full suite `pnpm test`; typecheck with `pnpm exec tsc --noEmit` (vitest does NOT typecheck). Never run dev servers.
- Commit after each task; end commit messages with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Persist state — `loadSavedConfig`, delete `clearState`, drop its call sites

**Files:**
- Modify: `src/state.ts` (refactor `loadStateFromDir`, add `loadSavedConfig`, delete `clearState` at lines 174-181)
- Modify: `src/index.ts` (remove the `clearState` import at line 8 and both calls at ~lines 115 and 142)
- Test: `src/__tests__/state-migration.test.ts` (extend)

**Interfaces:**
- Consumes: existing `readJSON`/`pathExists` from `src/utils/fs.ts`, `backfillConfigDefaults` from `src/utils/load-config.js`.
- Produces: `loadSavedConfig(projectDir: string): Promise<ViterexConfig | null>` exported from `src/state.ts` — returns the fully-migrated saved config (massifSettings migration + backfill + re-derived preset paths applied), or `null` when no state file exists. `clearState` no longer exists anywhere. Task 2 imports `loadSavedConfig` in `prompts.ts`.

- [ ] **Step 1: Write the failing tests** — append to `src/__tests__/state-migration.test.ts` (the file already has `tmpDir` beforeEach/afterEach and imports `loadState, saveState` from `../state.js`; extend that import to include `loadSavedConfig`):

```ts
describe("loadSavedConfig — persistent state reuse", () => {
  it("returns null when no state file exists", async () => {
    expect(await loadSavedConfig(tmpDir)).toBeNull();
  });

  it("returns the saved config with backfilled defaults", async () => {
    const stateFile = path.join(tmpDir, ".viterex-state.json");
    await writeJSON(stateFile, {
      config: {
        projectName: "kept",
        projectDir: tmpDir,
        redaxoVersion: "5.20.2",
        redaxoAdminUser: "admin",
        redaxoAdminPassword: "x",
        redaxoAdminEmail: "a@b.test",
        // no layout/installMode — backfill must supply them
      },
      completedTasks: ["Download Redaxo"],
    });

    const config = await loadSavedConfig(tmpDir);
    expect(config).not.toBeNull();
    expect(config?.projectName).toBe("kept");
    expect(config?.layout).toBe("modern"); // backfillConfigDefaults default
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/__tests__/state-migration.test.ts`
Expected: FAIL — `loadSavedConfig` is not exported from `../state.js`.

- [ ] **Step 3: Refactor `src/state.ts`**

Extract the read-and-migrate core of `loadStateFromDir` (lines 71-103: exists-check, `readJSON`, massifSettings migration, `backfillConfigDefaults`, `rederivePackageResolvedPaths`) into a private helper, and build both public functions on it:

```ts
/**
 * Read and migrate a state file's full contents. Returns null when the
 * project dir has no state file. Shared by --resume (which also needs
 * completedTasks) and the reuse-answers prompt (which only needs config).
 */
async function readStateData(projectDir: string): Promise<StateData | null> {
  const statePath = resolveStatePath(projectDir);
  if (!(await pathExists(statePath))) return null;

  const raw = await readJSON<Record<string, unknown>>(statePath);
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
```

`loadStateFromDir` shrinks to:

```ts
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
```

Delete the `clearState` function (lines 174-181) and its doc comment entirely. `fs` may become an unused import if `saveState`'s `fs.mkdir` is the only remaining use — it is used there, so the import stays.

- [ ] **Step 4: Drop the call sites in `src/index.ts`**

Line 8: change `import { loadState, clearState } from "./state.js";` to `import { loadState } from "./state.js";`

Remove the fresh-run clear (the `else` branch keeps only the config assignment):

```ts
      } else {
        config = options.config
          ? await loadConfigFile(options.config, detection.layout)
          : await collectConfig(projectName, options, detection);
      }
```

Remove the success-path line `await clearState(config.projectDir);` between `runPipeline(...)` and `printSuccess(...)` — those two calls become adjacent.

- [ ] **Step 5: Verify green — types and tests**

Run: `pnpm exec tsc --noEmit && pnpm exec vitest run src/__tests__/state-migration.test.ts`
Expected: tsc clean; all tests in the file pass (existing migration tests unaffected — `loadState` behavior is unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/state.ts src/index.ts src/__tests__/state-migration.test.ts
git commit -m "feat: persist .viterex-state.json across runs; add loadSavedConfig

The state file is no longer deleted on success or on fresh-run start.
loadSavedConfig exposes the migrated saved config for the upcoming
reuse-answers prompt.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Reuse-answers prompt in `collectConfig`

**Files:**
- Modify: `src/prompts.ts` (insert one block after the project-name prompt, ~line 51; add one import)

**Interfaces:**
- Consumes: `loadSavedConfig(projectDir): Promise<ViterexConfig | null>` from Task 1; `PACKAGE_MANAGERS` and `commandExists` (already imported in `prompts.ts`).
- Produces: nothing new — `collectConfig` may now return a saved config early. `completedTasks` handling is untouched (`src/index.ts` passes `[]` for non-resume runs, so reuse re-runs the full pipeline).

- [ ] **Step 1: Add the import**

In the imports at the top of `src/prompts.ts`:

```ts
import { loadSavedConfig } from "./state.js";
```

- [ ] **Step 2: Insert the reuse block**

Directly after the project-name prompt block (after `if (p.isCancel(projectName)) process.exit(0);`, before the `// ─── Preset selection ───` section):

```ts
  // ─── Reuse saved answers ──────────────────────────────────────────
  // Any run leaves a persistent .viterex-state.json in the project dir.
  // Offer to reuse its answers and re-run the full pipeline — this is a
  // re-run, not a resume (--resume and --config never reach collectConfig).
  const candidateDir =
    isAugment || useCurrentDir
      ? process.cwd()
      : path.resolve(process.cwd(), projectName as string);
  const saved = await loadSavedConfig(candidateDir);
  if (saved) {
    const reuse = await p.confirm({
      message:
        "Found saved answers from a previous run (.viterex-state.json) — reuse them and re-run the installation?",
      initialValue: true,
    });
    if (p.isCancel(reuse)) process.exit(0);
    if (reuse) {
      if (
        !PACKAGE_MANAGERS.includes(saved.packageManager) ||
        !(await commandExists(saved.packageManager))
      ) {
        p.log.warn(
          `Saved package manager '${saved.packageManager}' is unknown or not installed — continuing with prompts instead.`,
        );
      } else {
        saved.projectDir = candidateDir; // survive a moved project dir
        p.outro("Using saved answers — starting installation...");
        return saved;
      }
    }
  }
```

Notes for the implementer: `path` is already imported in this file; `candidateDir` mirrors the `projectDir` expression from `collectConfig`'s return object (`src/prompts.ts:532-535`), so the reuse path targets the same directory a fresh run would. The PM check degrades to normal prompts (warn, fall through) rather than exiting — the user is already in an interactive session.

- [ ] **Step 3: Verify — types and full suite**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: both clean. (The block is interactive-only; no unit test — the underlying `loadSavedConfig` is covered by Task 1, and `collectConfig` has no existing test harness. Manual verification happens in Task 4.)

- [ ] **Step 4: Commit**

```bash
git add src/prompts.ts
git commit -m "feat: offer to reuse saved answers when a state file exists

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Gitignore the state file before the initial commit

**Files:**
- Modify: `src/tasks/init-git.ts` (new exported helper + one call inside `gitInitialCommit`)
- Test: `src/tasks/__tests__/ensure-state-ignored.test.ts` (create)

**Interfaces:**
- Consumes: `mergeGitignore(existing: string, incoming: string, header?: string): { content: string; added: number }` from `src/utils/merge-gitignore.ts` (pure, no I/O); `pathExists` and `fs` (already imported in `init-git.ts`).
- Produces: `ensureStateIgnored(projectDir: string): Promise<void>` exported from `src/tasks/init-git.ts`.

- [ ] **Step 1: Write the failing tests** — create `src/tasks/__tests__/ensure-state-ignored.test.ts`:

```ts
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureStateIgnored } from "../init-git.js";

async function tmpProject(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "viterex-ignore-"));
}

describe("ensureStateIgnored", () => {
  it("creates .gitignore with the state entry when none exists", async () => {
    const dir = await tmpProject();
    await ensureStateIgnored(dir);
    const content = await readFile(path.join(dir, ".gitignore"), "utf-8");
    expect(content).toContain("# Added by create-viterex");
    expect(content).toContain(".viterex-state.json");
  });

  it("appends to an existing .gitignore without touching its content", async () => {
    const dir = await tmpProject();
    await writeFile(path.join(dir, ".gitignore"), "node_modules\ndist\n");
    await ensureStateIgnored(dir);
    const content = await readFile(path.join(dir, ".gitignore"), "utf-8");
    expect(content).toContain("node_modules");
    expect(content).toContain("dist");
    expect(content).toContain(".viterex-state.json");
  });

  it("is idempotent — a second run changes nothing", async () => {
    const dir = await tmpProject();
    await ensureStateIgnored(dir);
    const first = await readFile(path.join(dir, ".gitignore"), "utf-8");
    await ensureStateIgnored(dir);
    const second = await readFile(path.join(dir, ".gitignore"), "utf-8");
    expect(second).toBe(first);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/tasks/__tests__/ensure-state-ignored.test.ts`
Expected: FAIL — `ensureStateIgnored` is not exported.

- [ ] **Step 3: Implement in `src/tasks/init-git.ts`**

Add the import:

```ts
import { mergeGitignore } from "../utils/merge-gitignore.js";
```

Add the helper (above `gitInitialCommit`):

```ts
/**
 * Make sure the persistent .viterex-state.json (it holds DB and admin
 * credentials) never enters the repo. Runs right before the initial
 * `git add .`; the merge is idempotent so re-runs add nothing.
 */
export async function ensureStateIgnored(projectDir: string): Promise<void> {
  const gitignorePath = path.join(projectDir, ".gitignore");
  const existing = (await pathExists(gitignorePath))
    ? await fs.readFile(gitignorePath, "utf-8")
    : "";
  const { content, added } = mergeGitignore(
    existing,
    ".viterex-state.json\n",
    "Added by create-viterex",
  );
  if (added > 0) {
    await fs.writeFile(gitignorePath, content);
  }
}
```

Call it inside `gitInitialCommit`, after the HEAD early-return and before `git add .` (`src/tasks/init-git.ts:45`):

```ts
  await ensureStateIgnored(projectDir);

  await exec("git", ["add", "."], { cwd: projectDir, verbose });
```

(Placement after the HEAD check is deliberate: when a previous run already committed, `gitInitialCommit` returns without touching files, so re-runs never leave an uncommitted `.gitignore` edit behind.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run src/tasks/__tests__/ensure-state-ignored.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tasks/init-git.ts src/tasks/__tests__/ensure-state-ignored.test.ts
git commit -m "fix: gitignore .viterex-state.json before the initial commit

The state file holds DB/admin credentials and was being committed into
every scaffolded repo by git add -A.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Docs + full verification

**Files:**
- Modify: `README.md:84` (the `--resume` section paragraph)
- Modify: `CLAUDE.md` (the `init-git.ts` architecture bullet, ~line 21)

**Interfaces:** none — docs + verification only.

- [ ] **Step 1: Update `README.md`**

Replace the paragraph at line 84:

```markdown
If a task fails mid-run, fix the issue and resume. State is tracked in `.viterex-state.json` inside the project directory. The state file is automatically deleted on success.
```

with:

```markdown
If a task fails mid-run, fix the issue and resume. State is tracked in `.viterex-state.json` inside the project directory. The state file is kept after a successful run and excluded from the repo via `.gitignore` (it contains your DB and admin passwords). Re-running `npx create-viterex <project-name>` on an existing project detects it and offers to reuse the saved answers for a full re-run — no re-entering setup values.
```

- [ ] **Step 2: Update `CLAUDE.md`**

In the architecture bullet for `init-git.ts` (~line 21), after "the **last** file-touching task, so the user ends on a clean `git status`", append to the same bullet:

```markdown
 `gitInitialCommit` also merges `.viterex-state.json` into the project `.gitignore` first — the state file persists across runs (it powers the reuse-answers prompt) and must never be committed.
```

- [ ] **Step 3: Full verification**

Run: `pnpm exec tsc --noEmit && pnpm test && pnpm build && bash scripts/test-run.sh`
Expected: tsc clean; full suite passes (94+ tests: baseline 91 plus the new state and gitignore tests); build clean; smoke script all PASS.

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: document persistent state file and reuse-answers re-run

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
