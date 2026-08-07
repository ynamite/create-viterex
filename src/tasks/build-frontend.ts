import * as p from "@clack/prompts";
import { exec } from "../utils/exec.js";
import type { ViterexConfig } from "../types.js";

/**
 * Refresh the browserslist DB (so Vite / Tailwind / autoprefixer build against
 * the latest browser-support tables) and run the production build.
 *
 * Both steps write files, so this task runs BEFORE the git initial commit —
 * the output is committed and the working tree ends clean. Each step is
 * best-effort (warn + continue) so an offline machine or a broken build script
 * doesn't abort the installer.
 */
export async function buildFrontend(config: ViterexConfig): Promise<void> {
  const { projectDir, packageManager, verbose } = config;

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
    p.log.warn(
      `Could not refresh browserslist DB — continuing. (${(err as Error).message})`,
    );
  }

  try {
    await exec(packageManager, ["run", "build"], { cwd: projectDir, verbose });
  } catch (err) {
    p.log.warn(
      `Frontend build failed — continuing. Run \`${packageManager} run build\` manually after install. (${(err as Error).message})`,
    );
  }
}
