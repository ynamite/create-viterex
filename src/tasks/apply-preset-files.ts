import path from "node:path";
import fs from "fs-extra";
import * as p from "@clack/prompts";
import { mergePackageDeps, type PackageDeps } from "../utils/merge-package-deps.js";
import type { ViterexConfig } from "../types.js";

/**
 * Copy a preset's `files/` directory into projectDir, merging folders and
 * overwriting individual files. Pre-existing destination files outside the
 * preset's source tree are left untouched; files that exist on both sides
 * are replaced by the preset version.
 *
 * The `files/` tree mirrors the project layout — e.g. `files/public/` lands at
 * `<projectDir>/public/`, `files/src/templates/` at `<projectDir>/src/templates/`.
 * Two filenames get special handling and are NOT copied verbatim:
 *   - `.DS_Store` — skipped (macOS cruft).
 *   - `package-deps.json` — its npm deps are merged into the project
 *     `package.json` (additive, higher-version-wins) instead of being copied.
 *     This lets a preset add dependencies on top of viterex_addon's stub
 *     `package.json` without clobbering it.
 *
 * `presetFilesDir` and `presetLayout` are pre-resolved in prompts.ts. The
 * pipeline `skip` predicate already short-circuits when no preset files dir is
 * present; the early-return here is defensive belt-and-braces.
 */
export async function applyPresetFiles(config: ViterexConfig): Promise<void> {
  const { presetFilesDir, presetLayout, projectDir, layout, preset } = config;
  if (!presetFilesDir) return;

  if (presetLayout && presetLayout !== layout) {
    throw new Error(
      `Preset '${preset}' targets layout '${presetLayout}', but '${layout}' was selected. ` +
      `Either choose a matching layout or pick a different preset.`,
    );
  }

  // Copy everything verbatim except .DS_Store (cruft) and package-deps.json
  // (merged into package.json below, not copied).
  await fs.copy(presetFilesDir, projectDir, {
    overwrite: true,
    filter: (src) => {
      const base = path.basename(src);
      return base !== ".DS_Store" && base !== "package-deps.json";
    },
  });

  // Merge a preset-supplied package-deps.json into the project package.json.
  const depsPath = path.join(presetFilesDir, "package-deps.json");
  const pkgPath = path.join(projectDir, "package.json");
  let depsNote = "";
  if (await fs.pathExists(depsPath)) {
    if (await fs.pathExists(pkgPath)) {
      const incoming = (await fs.readJSON(depsPath)) as PackageDeps;
      const pkg = (await fs.readJSON(pkgPath)) as Record<string, unknown>;
      const { pkg: merged, added } = mergePackageDeps(pkg, incoming);
      if (added > 0) {
        await fs.writeFile(pkgPath, `${JSON.stringify(merged, null, 2)}\n`);
      }
      depsNote = `, merged ${added} npm dep(s)`;
    } else {
      p.log.warn(
        "Preset ships package-deps.json but the project package.json is missing — skipping dependency merge.",
      );
    }
  }

  p.log.info(
    `Applied preset files from ${path.relative(process.cwd(), presetFilesDir)}${depsNote}`,
  );
}
