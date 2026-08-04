import path from "node:path";
import fs from "node:fs/promises";
import * as p from "@clack/prompts";
import { pathExists, readJSON, writeJSON } from "../utils/fs.js";
import type { ViterexConfig } from "../types.js";

const DEPLOYER_REQUIREMENT = "^7.5";

/**
 * Idempotently ensure the project's composer.json:
 * - has `config.vendor-dir = ".tools"` so deps go to .tools/ instead of vendor/
 * - has `require.deployer/deployer = "^7.5"` for ydeploy's deployment runner
 *
 * If the project already has a composer.json, this merges into it; otherwise
 * it creates a minimal one. Existing values in unrelated keys are preserved.
 *
 * Warns when an existing composer.json had `vendor-dir` set to something other
 * than ".tools" — files installed at the previous location are not moved.
 */
export async function configureComposer(config: ViterexConfig): Promise<void> {
  const composerPath = path.join(config.projectDir, "composer.json");
  await fs.mkdir(config.projectDir, { recursive: true });

  let manifest: Record<string, unknown> = {};
  if (await pathExists(composerPath)) {
    manifest = await readJSON<Record<string, unknown>>(composerPath);
  }

  const cfg = ((manifest.config ?? {}) as Record<string, unknown>);
  const previousVendorDir = cfg["vendor-dir"];
  if (previousVendorDir && previousVendorDir !== ".tools") {
    p.log.warn(
      `composer.json has vendor-dir="${previousVendorDir}"; switching to ".tools". ` +
        `Existing dependencies in "${previousVendorDir}/" are not moved automatically — ` +
        `delete that directory and re-run \`composer install\` to converge.`,
    );
  }
  cfg["vendor-dir"] = ".tools";
  manifest.config = cfg;

  const require = ((manifest.require ?? {}) as Record<string, string>);
  if (!require["deployer/deployer"]) {
    require["deployer/deployer"] = DEPLOYER_REQUIREMENT;
  }
  manifest.require = require;

  await writeJSON(composerPath, manifest);
}
