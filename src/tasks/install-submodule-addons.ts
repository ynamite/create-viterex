import path from "node:path";
import fs from "node:fs/promises";
import { exec } from "../utils/exec.js";
import { consolePathFor } from "../utils/detect.js";
import { pathExists } from "../utils/fs.js";
import type { ViterexConfig } from "../types.js";

/**
 * Step 9: add preset-defined submodule addons (git submodule add + clone).
 *
 * Idempotent: skips entries already listed in .gitmodules. Activation runs
 * separately in `activateSubmoduleAddons` so it can re-run cleanly on re-runs.
 */
export async function addSubmoduleAddons(config: ViterexConfig): Promise<void> {
  const { projectDir, verbose, submoduleAddons } = config;
  if (!submoduleAddons?.length) return;

  const gitmodulesPath = path.join(projectDir, ".gitmodules");
  const existing = (await pathExists(gitmodulesPath))
    ? await fs.readFile(gitmodulesPath, "utf-8")
    : "";

  for (const addon of submoduleAddons) {
    const alreadyDeclared = existing.includes(`path = ${addon.path}`);
    if (alreadyDeclared) {
      await exec("git", ["submodule", "update", "--init", addon.path], { cwd: projectDir, verbose });
    } else {
      await exec("git", ["submodule", "add", addon.url, addon.path], { cwd: projectDir, verbose });
    }
  }

  await exec("git", ["submodule", "update", "--init", "--recursive"], {
    cwd: projectDir,
    verbose,
  });
}

/**
 * Step 10: composer-install each submodule's PHP deps and run package:install
 * + package:activate via the Redaxo CLI. Runs AFTER project-level composer
 * install so the parent project's `.tools/` autoload is available.
 *
 * Idempotent: package:install / package:activate are no-ops on already-active
 * packages; composer install is naturally idempotent.
 */
export async function activateSubmoduleAddons(config: ViterexConfig): Promise<void> {
  const { projectDir, layout, verbose, submoduleAddons } = config;
  if (!submoduleAddons?.length) return;

  const consolePath = consolePathFor(layout);

  for (const addon of submoduleAddons) {
    if (addon.hasComposerDeps) {
      await exec(
        "composer",
        [
          "install",
          `--working-dir=${addon.path}`,
          "--optimize-autoloader",
          "--no-interaction",
          "--quiet",
        ],
        { cwd: projectDir, verbose },
      );
    }
    await exec(
      "php",
      [consolePath, "package:install", addon.packageKey, "--no-interaction", "--quiet"],
      { cwd: projectDir, verbose },
    );
    await exec(
      "php",
      [consolePath, "package:activate", addon.packageKey, "--no-interaction", "--quiet"],
      { cwd: projectDir, verbose },
    );
  }
}
