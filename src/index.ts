import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { styleText } from "node:util";
import { Command } from "commander";
import { collectConfig } from "./prompts.js";
import { runPipeline } from "./pipeline.js";
import { loadState, clearState } from "./state.js";
import { detectInstallation } from "./utils/detect.js";
import { pathExists, writeJSON } from "./utils/fs.js";
import { loadConfigFile } from "./utils/load-config.js";
import { printBanner, printSuccess, printError } from "./utils/log.js";
import { PACKAGE_MANAGERS } from "./utils/detect-pm.js";
import { commandExists } from "./utils/exec.js";
import type { ViterexConfig } from "./types.js";

const pkgVersion = (() => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return (JSON.parse(readFileSync(path.join(here, "..", "package.json"), "utf-8")) as {
    version: string;
  }).version;
})();

const program = new Command();

program
  .name("create-viterex")
  .description("Scaffold a ViteRex (Redaxo + Vite) project, or augment an existing Redaxo install")
  .version(pkgVersion)
  .argument("[project-name]", "Name of the project directory (or '.' to augment current dir)")
  .option("--skip-db", "Skip database creation")
  .option("--skip-addons", "Skip addon installation")
  .option("--skip-git", "Don't initialize a git repo")
  .option("--pm <manager>", "Package manager for JS deps after Redaxo install: bun | pnpm | yarn | npm (default: bun if installed, else pnpm)")
  .option("--preset <name>", "Preset that drives addon selection, layout, seed.sql and template files. Built-in id (default, massif), or path to a preset directory or preset.json")
  .option("--config <path>", "Path to a previously-generated viterex.json (or a directory containing one). Pins all answers and skips prompts. Different from --preset, which only pre-fills some")
  .option("--resume", "Resume a previously failed run, skipping completed tasks")
  .option("--dry-run", "Log each task without executing")
  .option("--verbose", "Pipe task stdout/stderr to the terminal")
  .option("--layout <m|c|ct>", "Directory layout: modern (ydeploy, recommended) | classic (Redaxo defaults) | classic+theme (FriendsOfREDAXO/theme)")
  .option("--fresh", "Force fresh-install pipeline even when an existing Redaxo install is detected")
  .option("--force-push", "Allow force-push when the git remote already has commits")
  .option("--with-tower", "Open Tower (macOS) after a successful run")
  .option("--lang <locale>", "Redaxo language (e.g. de_de)")
  .option("--timezone <tz>", "Redaxo timezone (e.g. Europe/Berlin)")
  .option("--generate-config [path]", "Run prompts and write config JSON to <path> (default: viterex.json), then exit")
  .option("--force", "Allow --generate-config to overwrite an existing file")
  .action(async (projectName, options) => {
    printBanner();

    if (/-(alpha|beta|rc)/.test(pkgVersion)) {
      console.log(
        styleText("yellow", `⚠ This is a ${pkgVersion} pre-release.`) +
          styleText("dim", ` Report issues at https://github.com/ynamite/viterex/issues`)
      );
      console.log("");
    }

    try {
      // --generate-config: run prompts, write JSON, exit. Never enters the pipeline.
      if (options.generateConfig) {
        if (options.config) {
          console.warn(styleText("yellow", "--config is ignored when --generate-config is set"));
        }
        const targetPath = path.resolve(
          typeof options.generateConfig === "string"
            ? options.generateConfig
            : "viterex.json",
        );
        if ((await pathExists(targetPath)) && !options.force) {
          throw new Error(
            `${targetPath} already exists. Re-run with --force to overwrite.`,
          );
        }

        // Force fresh mode regardless of cwd contents — generating a config
        // for an augment install is non-sensical (augment derives values from
        // the existing Redaxo install, not from a config file).
        const detection = await detectInstallation(process.cwd());
        detection.mode = "fresh";

        const generated = await collectConfig(projectName, options, detection);
        // Strip runtime-only fields the user shouldn't pin in a config file.
        const { verbose: _v, forcePush: _fp, withTower: _wt, ...persisted } = generated;
        await writeJSON(targetPath, persisted);

        console.log(
          styleText(
            "green",
            `\n✓ Wrote ${targetPath} — re-run with --config ${JSON.stringify(targetPath)} to install.\n`,
          ),
        );
        return;
      }

      const targetDir = resolveTargetDir(projectName, options.config);
      const detection = await detectInstallation(targetDir);

      if (options.fresh) {
        detection.mode = "fresh";
      }

      let config: ViterexConfig;
      let completedTasks: string[] = [];

      if (options.resume) {
        const state = await loadState(projectName, options);
        config = state.config;
        completedTasks = state.completedTasks;
      } else {
        config = options.config
          ? await loadConfigFile(options.config, detection.layout)
          : await collectConfig(projectName, options, detection);

        await clearState(config.projectDir);
      }

      // Fail fast for the --config/--resume paths, which bypass collectConfig's
      // interactive PM prompt (and its own validation) entirely — a stale state
      // file or a hand-edited config could carry an unknown or no-longer-installed
      // package manager that would otherwise die mid-pipeline in install-deps.
      if (options.resume || options.config) {
        const source = options.resume ? "state file" : "config file";
        if (!PACKAGE_MANAGERS.includes(config.packageManager)) {
          throw new Error(
            `Unknown package manager '${config.packageManager}' in ${source} — use one of: ${PACKAGE_MANAGERS.join(", ")}.`,
          );
        }
        if (!(await commandExists(config.packageManager))) {
          throw new Error(
            `Package manager '${config.packageManager}' from ${source} is not installed (not found on PATH).`,
          );
        }
      }

      config.verbose = !!options.verbose;
      config.forcePush = config.forcePush || !!options.forcePush;
      config.withTower = config.withTower || !!options.withTower;

      await runPipeline(config, { completedTasks, dryRun: !!options.dryRun });

      await clearState(config.projectDir);

      printSuccess(config.projectName);
    } catch (err) {
      printError(err as Error);
      process.exit(1);
    }
  });

program.parse();

function resolveTargetDir(projectName: string | undefined, configPath: string | undefined): string {
  if (projectName) {
    return path.resolve(process.cwd(), projectName);
  }
  if (configPath) {
    try {
      const resolved = path.resolve(configPath);
      let isDir = false;
      try { isDir = statSync(resolved).isDirectory(); } catch { /* missing path */ }
      const file = isDir ? path.join(resolved, "viterex.json") : resolved;
      const cfg = JSON.parse(readFileSync(file, "utf-8")) as { projectDir?: string };
      if (cfg.projectDir) return path.resolve(cfg.projectDir);
    } catch {
      // fall through to cwd
    }
  }
  return process.cwd();
}
