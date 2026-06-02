/**
 * Rewrite the `dev` npm script so that running it diffs ydeploy migrations
 * before and after the Vite dev server.
 *
 * When ydeploy is installed, `pnpm dev` should bracket the dev server with
 * `ydeploy:diff` so schema changes made during development are surfaced as
 * migrations (once before starting Vite, once after it exits):
 *
 *   <console> ydeploy:diff && cross-env NODE_ENV=development vite && <console> ydeploy:diff
 *
 * `<console>` is the layout-aware console binary (`bin/console` in modern,
 * `redaxo/bin/console` in classic / classic+theme). `cross-env` already ships
 * as a devDependency in viterex_addon's stub package.json.
 *
 * Only the exact stub/preset value `"vite"` is rewritten — a customised dev
 * script is left untouched, which also makes the patch idempotent (the
 * rewritten value is no longer `"vite"`, so a second run is a no-op).
 *
 * Pure — does no I/O. The caller reads and writes package.json.
 */
export function patchDevScriptForYdeploy(
  pkg: Record<string, unknown>,
  consolePath: string,
): { pkg: Record<string, unknown>; changed: boolean } {
  const scripts = pkg.scripts;
  if (typeof scripts !== "object" || scripts === null) {
    return { pkg, changed: false };
  }

  const current = (scripts as Record<string, unknown>).dev;
  if (current !== "vite") {
    return { pkg, changed: false };
  }

  const dev = `${consolePath} ydeploy:diff && cross-env NODE_ENV=development vite && ${consolePath} ydeploy:diff`;

  return {
    pkg: {
      ...pkg,
      scripts: { ...(scripts as Record<string, string>), dev },
    },
    changed: true,
  };
}
