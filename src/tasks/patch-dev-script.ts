import path from "node:path";
import fs from "fs-extra";
import * as p from "@clack/prompts";
import { consolePathFor, srcAddonsDirFor } from "../utils/detect.js";
import { patchDevScriptForYdeploy } from "../utils/patch-dev-script.js";
import type { ViterexConfig } from "../types.js";

/**
 * When ydeploy is installed, rewrite the project's `dev` npm script so that
 * `pnpm dev` brackets the Vite dev server with `ydeploy:diff` calls:
 *
 *   <console> ydeploy:diff && cross-env NODE_ENV=development vite && <console> ydeploy:diff
 *
 * "ydeploy installed" is read from the filesystem (the addon directory holds a
 * package.yml) so it covers both a fresh install — where ydeploy is part of the
 * always-included baseline — and an augmented existing install where ydeploy
 * was already present.
 *
 * Runs AFTER "Apply preset files" so it patches the final package.json (the
 * default preset overwrites the stub package.json verbatim), and BEFORE the
 * initial commit so the change is committed on a clean tree.
 *
 * Idempotent: only the exact stub/preset `"dev": "vite"` value is rewritten;
 * an already-patched or customised script is left untouched.
 */
export async function patchDevScript(config: ViterexConfig): Promise<void> {
  const { projectDir, layout, verbose } = config;

  const ydeployManifest = path.join(
    projectDir,
    srcAddonsDirFor(layout),
    "ydeploy",
    "package.yml",
  );
  if (!(await fs.pathExists(ydeployManifest))) {
    if (verbose) p.log.info("ydeploy not installed — leaving dev script unchanged.");
    return;
  }

  const pkgPath = path.join(projectDir, "package.json");
  if (!(await fs.pathExists(pkgPath))) return;

  const pkg = (await fs.readJSON(pkgPath)) as Record<string, unknown>;
  const { pkg: patched, changed } = patchDevScriptForYdeploy(pkg, consolePathFor(layout));

  if (changed) {
    await fs.writeFile(pkgPath, `${JSON.stringify(patched, null, 2)}\n`);
    p.log.info("Patched dev script to run ydeploy:diff around the Vite dev server.");
  }
}
