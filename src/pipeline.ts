import { existsSync } from "node:fs";
import path from "node:path";
import * as p from "@clack/prompts";
import type { ViterexConfig } from "./types.js";
import { saveState } from "./state.js";
import { mergeBaselineAddons } from "./utils/baseline.js";
import { configureComposer } from "./tasks/configure-composer.js";
import { downloadRedaxo } from "./tasks/download-redaxo.js";
import { installRedaxo } from "./tasks/install-redaxo.js";
import { installAddons } from "./tasks/install-addons.js";
import { scaffoldFrontend } from "./tasks/scaffold-frontend.js";
import { applyPresetFiles } from "./tasks/apply-preset-files.js";
import { patchDevScript } from "./tasks/patch-dev-script.js";
import { buildFrontend } from "./tasks/build-frontend.js";
import { clearCache } from "./tasks/clear-cache.js";
import { importSql } from "./tasks/import-sql.js";
import { installDependencies } from "./tasks/install-deps.js";
import { initGitRepo, gitInitialCommit } from "./tasks/init-git.js";
import { addSubmoduleAddons, activateSubmoduleAddons } from "./tasks/install-submodule-addons.js";
import { installViterexStubs } from "./tasks/install-viterex-stubs.js";
import { createGitRemote } from "./tasks/create-git-remote.js";
import { openBrowser } from "./tasks/open-browser.js";
import { showNextSteps } from "./tasks/show-next-steps.js";
import { PasswordRuleError } from "./tasks/install-redaxo.js";

const MAX_PASSWORD_RETRIES = 3;

export interface Task {
  name: string;
  skip?: (config: ViterexConfig) => boolean;
  /** When true, the spinner is stopped before running so the task gets full TTY control. */
  interactive?: boolean;
  run: (config: ViterexConfig) => Promise<void>;
}

const isAugment = (c: ViterexConfig) => c.installMode === "augment";

/**
 * The ordered installation pipeline. Each task is idempotent —
 * if it fails, fix the issue and re-run with --resume (or just re-run).
 *
 * Exported so the ordering can be asserted in tests.
 */
export const tasks: Task[] = [
  {
    name: "Configure composer (.tools/, deployer)",
    run: configureComposer,
  },
  {
    name: "Download Redaxo",
    skip: (c) => isAugment(c),
    run: downloadRedaxo,
  },
  {
    name: "Install Redaxo",
    skip: (c) => isAugment(c),
    run: installRedaxo,
  },
  {
    name: "Install addons",
    skip: (c) => c.skipAddons || c.addons.length === 0,
    run: installAddons,
  },
  {
    name: "Install viterex stubs (package.json, vite.config.js, ...)",
    skip: (c) => !c.addons.some((a) => a.key === "viterex_addon" && a.activate),
    run: installViterexStubs,
  },
  {
    name: "Scaffold frontend (Vite, configs)",
    run: scaffoldFrontend,
  },
  // INVARIANT: "Apply preset files" must come BEFORE "Install dependencies".
  // The preset's files/ tree can overwrite package.json (and similar), so the
  // dep install/upgrade must run against the post-merge version.
  {
    name: "Apply preset files",
    skip: (c) => !c.presetFilesDir,
    run: applyPresetFiles,
  },
  // Must come AFTER "Apply preset files" — the default preset overwrites the
  // stub package.json verbatim, so the dev-script patch has to land on the
  // final file. No-ops unless ydeploy is installed (checked on disk).
  {
    name: "Patch dev script for ydeploy",
    run: patchDevScript,
  },
  {
    name: "Seed database",
    skip: (c) => isAugment(c) || c.skipDb || !c.seedFile,
    run: importSql,
  },
  {
    name: "Install dependencies (composer + packages)",
    interactive: true,
    run: installDependencies,
  },
  {
    name: "Initialize git repo",
    skip: (c) => c.skipGit,
    run: initGitRepo,
  },
  {
    name: "Add submodule addons (preset extras)",
    skip: (c) => c.skipGit || !c.submoduleAddons?.length,
    run: addSubmoduleAddons,
  },
  {
    name: "Activate submodule addons",
    skip: (c) => !c.submoduleAddons?.length,
    run: activateSubmoduleAddons,
  },
  // Everything that writes to the working tree must run BEFORE the git initial
  // commit so the user ends on a clean `git status`:
  //  - developer:sync pulls templates/modules out of the DB onto disk;
  //  - build-frontend writes Vite output and refreshes the browserslist DB
  //    (which rewrites the lockfile).
  // The commit is therefore the LAST file-touching task; the remote push,
  // browser open, and next-steps message run after it and touch no tracked files.
  {
    name: "Sync developer + clear cache",
    run: clearCache,
  },
  {
    name: "Build frontend",
    skip: (c) => !existsSync(path.join(c.projectDir, "package.json")),
    run: buildFrontend,
  },
  {
    name: "Git initial commit",
    skip: (c) => c.skipGit,
    run: gitInitialCommit,
  },
  {
    name: "Create remote git repository",
    skip: (c) => c.skipGit || !c.gitProvider,
    run: createGitRemote,
  },
  {
    name: "Open frontend and backend in browser",
    run: openBrowser,
  },
  {
    name: "Show next steps",
    interactive: true,
    run: showNextSteps,
  },
];

export interface PipelineOptions {
  completedTasks?: string[];
  dryRun?: boolean;
}

export async function runPipeline(
  config: ViterexConfig,
  options: PipelineOptions = {},
): Promise<void> {
  const { completedTasks = [], dryRun = false } = options;
  const total = tasks.length;
  const done = new Set(completedTasks);
  let passwordRetries = 0;

  // Enforce the baseline regardless of how the config was loaded — covers
  // --resume from older state files (which may pre-date a new baseline addon)
  // and --config from users who hand-rolled their addons list.
  const beforeKeys = new Set(config.addons.map((a) => a.key));
  config.addons = mergeBaselineAddons(config.addons);
  const added = config.addons
    .map((a) => a.key)
    .filter((k) => !beforeKeys.has(k));
  if (added.length > 0) {
    p.log.info(`Merged missing baseline addons into config: ${added.join(", ")}`);
  }

  if (dryRun) {
    p.log.info("Dry run — no tasks will be executed\n");
  }

  for (let i = 0; i < total; i++) {
    const task = tasks[i];
    const label = `[${i + 1}/${total}] ${task.name}`;

    if (done.has(task.name)) {
      p.log.info(`Already done: ${task.name}`);
      continue;
    }

    if (task.skip?.(config)) {
      p.log.info(`${dryRun ? "Would skip" : "Skipping"}: ${task.name}`);
      continue;
    }

    if (dryRun) {
      p.log.step(`Would run: ${task.name}`);
      continue;
    }

    if (task.interactive) {
      p.log.step(label);
      try {
        await task.run(config);
        p.log.step(`${label} ✓`);
        done.add(task.name);
        await saveState(config, [...done]);
      } catch (err) {
        throw taskError(task, err);
      }
    } else {
      const s = p.spinner();
      s.start(label);
      try {
        await task.run(config);
        s.stop(`${label} ✓`);
        done.add(task.name);
        await saveState(config, [...done]);
      } catch (err) {
        s.stop(`${label} ✗`);

        // Specific recovery: Redaxo rejected the admin password (rule: 8–4096 chars).
        // Prompt for a new one, update config in place, retry this task.
        if (err instanceof PasswordRuleError && passwordRetries < MAX_PASSWORD_RETRIES) {
          passwordRetries++;
          p.log.warn(err.message);
          const newPassword = await p.password({
            message: `Admin password (Redaxo rule: 8–4096 chars) — retry ${passwordRetries}/${MAX_PASSWORD_RETRIES}`,
            validate: (v) => {
              if (v.length < 8) return "Must be at least 8 characters.";
              if (v.length > 4096) return "Must be at most 4096 characters.";
            },
          });
          if (p.isCancel(newPassword)) process.exit(0);
          config.redaxoAdminPassword = newPassword as string;
          await saveState(config, [...done]);
          i--; // re-run the same task with the updated password
          continue;
        }

        throw taskError(task, err);
      }
    }
  }
}

function taskError(task: Task, err: unknown): Error {
  const e = err as Error & { stderr?: unknown; stdout?: unknown };
  const stderr = e.stderr ? `\n${e.stderr}` : "";
  const stdout = e.stdout ? `\n${e.stdout}` : "";
  return new Error(`Task "${task.name}" failed: ${e.message}${stderr}${stdout}`);
}
