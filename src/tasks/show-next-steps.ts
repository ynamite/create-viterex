import path from "node:path";
import * as p from "@clack/prompts";
import chalk from "chalk";
import type { ViterexConfig } from "../types.js";

/**
 * Final pipeline step — display only. Prints how to start the Vite dev server.
 *
 * The browserslist refresh used to live here; it now runs in the build-frontend
 * task (before the git initial commit) so its lockfile rewrite lands in the
 * commit instead of dirtying the freshly-scaffolded working tree.
 *
 * We intentionally do NOT spawn `<pm> run dev` from the installer: a detached
 * child running in the background can't be Ctrl-C'd from the terminal that
 * started it, which traps users.
 */
export async function showNextSteps(config: ViterexConfig): Promise<void> {
  const { projectDir, packageManager } = config;

  const cdLine =
    path.resolve(projectDir) !== path.resolve(process.cwd())
      ? `  cd ${projectDir}\n`
      : "";

  p.log.success(
    `Next step — start the Vite dev server:\n\n${cdLine}  ${chalk.bold.magentaBright(`${packageManager} run dev`)}\n`,
  );
}
