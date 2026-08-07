# Persist the state file — design

**Date:** 2026-08-07
**Repo:** create-viterex
**Status:** approved (pending final spec review)

## Goal

Keep `.viterex-state.json` in the project after a successful install so a completed installation can be re-run without re-entering setup answers — and stop the file from being committed into the scaffolded repo.

## Bug fixed by this work

The state file is currently **committed into the scaffolded project**. It is written after every task, no `.gitignore` covers it, so `git add -A` in `gitInitialCommit` tracks it; the success-path `clearState` then deletes it from disk, leaving a tracked file containing the DB and Redaxo admin passwords in git history (pushed to the remote when the git-provider flow is used). Verified in a real install (`~/Herd/gastrozentrum`: `git ls-files` lists `.viterex-state.json`).

## Decisions

- Passwords stay in the file as-is (local-dev risk accepted by owner); the fix is keeping the file out of git, not stripping fields.
- No new CLI flags. `--resume` and `--config` keep their existing semantics.
- No deploy.php `clear_paths` entry — the scaffolded deploy uses git-clone strategy, so an untracked file never reaches a release.

## Changes

### 1. Keep the state file, always (`src/index.ts`, `src/state.ts`)

- Remove both `clearState` calls in `src/index.ts` (success path ~line 142, fresh-run stale-clear ~line 115).
- Delete the now-dead `clearState` function from `src/state.ts`.
- Mechanically safe: fresh (non-resume) runs never read `completedTasks`, and the first task completion's `saveState` overwrites the file wholesale.

### 2. Reuse saved answers on re-run (`src/prompts.ts`)

- In the interactive flow, when the resolved target project dir contains `.viterex-state.json`, offer a single confirm prompt: reuse the saved answers or answer prompts anew.
- Reuse path: take `state.config`, run the existing compatibility machinery already used by `--resume` (`massifSettings` migration, `backfillConfigDefaults`, `rederivePackageResolvedPaths`), then run the **full** pipeline (ignore `completedTasks` — this is a re-run, not a resume). Expose whatever small helper `state.ts` needs so this logic is not duplicated.
- The prompt is skipped when `--config` (bypasses prompts entirely) or `--resume` (existing flow) is used.
- Declining prompts as today; the state file is later overwritten by the new run's saves.

### 3. Gitignore the state file (`src/tasks/init-git.ts`)

- Inside `gitInitialCommit` (`src/tasks/init-git.ts:34`), immediately before the `git add .` at line 45, append `.viterex-state.json` to the project's `.gitignore` using the existing idempotent `src/utils/merge-gitignore.ts` (header: `# Added by create-viterex`). This covers fresh and augment installs alike, since both run `gitInitialCommit`.
- Works regardless of which `.gitignore` baseline (viterex_addon stubs, preset overlay) is present; creates the file if none exists.

## Out of scope

- Stripping or encrypting passwords in the state file.
- Migrating existing projects (one-time manual cleanup documented for the owner: `git rm --cached .viterex-state.json` + gitignore entry).
- New flags (`--rerun` etc.).

## Tests

- Unit: reuse-path helper (state config → runnable config, `completedTasks` ignored); merge-gitignore call is idempotent across two runs (existing util already tested — cover the new call site's pattern string).
- Existing `state-migration` tests keep passing; update any test that asserts `clearState` behavior.
- Manual/pipeline: `scripts/test-run.sh` still green.
