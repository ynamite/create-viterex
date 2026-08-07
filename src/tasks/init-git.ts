import path from "node:path";
import fs from "node:fs/promises";
import { exec } from "../utils/exec.js";
import { pathExists } from "../utils/fs.js";
import { mergeGitignore } from "../utils/merge-gitignore.js";
import type { ViterexConfig } from "../types.js";

const SAFETY_IGNORES = [
  "node_modules",
  "vendor",
  ".tools",
  "/var/cache/*",
  "/var/log/*",
];

export async function initGitRepo(config: ViterexConfig): Promise<void> {
  const { projectDir, verbose } = config;

  if (!(await pathExists(path.join(projectDir, ".git")))) {
    await exec("git", ["init"], { cwd: projectDir, verbose });
  }

  const gitignorePath = path.join(projectDir, ".gitignore");
  if (await pathExists(gitignorePath)) {
    const existing = await fs.readFile(gitignorePath, "utf-8");
    const missing = SAFETY_IGNORES.filter((entry) => !existing.includes(entry));
    if (missing.length > 0) {
      await fs.appendFile(gitignorePath, "\n" + missing.join("\n") + "\n");
    }
  } else {
    await fs.writeFile(gitignorePath, SAFETY_IGNORES.join("\n") + "\n");
  }

  await ensureStateIgnored(projectDir);
}

/**
 * Make sure the persistent .viterex-state.json (it holds DB and admin
 * credentials) never enters the repo. Called from `initGitRepo`, which runs
 * unconditionally (fresh repo or pre-existing one) before any commit step;
 * the merge is idempotent so re-runs add nothing.
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

export async function gitInitialCommit(config: ViterexConfig): Promise<void> {
  const { projectDir, layout, verbose } = config;

  // Skip when a HEAD already exists (a previous run committed).
  try {
    await exec("git", ["rev-parse", "--verify", "HEAD"], { cwd: projectDir });
    return;
  } catch {
    // No HEAD yet; continue.
  }

  await exec("git", ["add", "."], { cwd: projectDir, verbose });

  // Ensure the layout-specific console binary is tracked with +x.
  const consoleRel = layout === "modern" ? "bin/console" : "redaxo/bin/console";
  if (await pathExists(path.join(projectDir, consoleRel))) {
    try {
      await exec("git", ["update-index", "--chmod=+x", consoleRel], { cwd: projectDir, verbose });
    } catch {
      // index lookup may fail on first commit before tree is realised; non-fatal
    }
  }

  await exec("git", ["commit", "-m", "initial commit"], { cwd: projectDir, verbose });
}
