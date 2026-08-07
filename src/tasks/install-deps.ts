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
