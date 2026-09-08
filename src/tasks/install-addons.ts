import path from "node:path";
import * as p from "@clack/prompts";
import { pathExists } from "../utils/fs.js";
import { exec } from "../utils/exec.js";
import { consolePathFor, srcAddonsDirFor } from "../utils/detect.js";
import type { ViterexConfig } from "../types.js";

export async function installAddons(config: ViterexConfig): Promise<void> {
  const { projectDir, layout, addons, verbose } = config;
  const consolePath = consolePathFor(layout);
  const addonsDir = srcAddonsDirFor(layout);

  // We deliberately do NOT pass --quiet to package:install / package:activate
  // / install:download. Symfony Console's --quiet suppresses error output too,
  // so a failing addon install would surface as an empty stderr — useless for
  // debugging. The pipeline captures stdout/stderr and appends them to the
  // thrown error message when a task fails, which gives the user something to
  // act on.

  // A failed download (redaxo.org hiccup, broken package entry) shouldn't
  // abort the whole loop — skip that addon, keep going, report at the end.
  const failedDownloads: string[] = [];

  for (const addon of addons) {
    const isPlugin = addon.key.includes("/");

    if (!isPlugin && addon.install) {
      const addonDir = path.join(projectDir, addonsDir, addon.key);
      if (!(await pathExists(addonDir))) {
        const downloadArgs = [
          consolePath,
          "install:download",
          addon.key,
          ...(addon.version ? [addon.version] : []),
          "--no-interaction",
        ];
        try {
          await runWithContext("install:download", addon.key, "php", downloadArgs, projectDir, verbose);
        } catch (err) {
          failedDownloads.push(`${addon.key}: ${(err as Error).message.replace(/\s+/g, " ").trim()}`);
          continue;
        }
      }
    }

    if (addon.install) {
      await runWithContext(
        "package:install",
        addon.key,
        "php",
        [consolePath, "package:install", addon.key, "--no-interaction"],
        projectDir,
        verbose,
      );
    }

    if (addon.activate) {
      await runWithContext(
        "package:activate",
        addon.key,
        "php",
        [consolePath, "package:activate", addon.key, "--no-interaction"],
        projectDir,
        verbose,
      );
    }

    if (addon.plugins) {
      for (const plugin of addon.plugins) {
        const pluginKey = `${addon.key}/${plugin}`;
        await runWithContext(
          "package:install",
          pluginKey,
          "php",
          [consolePath, "package:install", pluginKey, "--no-interaction"],
          projectDir,
          verbose,
        );
        await runWithContext(
          "package:activate",
          pluginKey,
          "php",
          [consolePath, "package:activate", pluginKey, "--no-interaction"],
          projectDir,
          verbose,
        );
      }
    }
  }

  await exec("php", [consolePath, "cache:clear"], { cwd: projectDir, verbose });
  await exec("php", [consolePath, "be_style:compile"], { cwd: projectDir, verbose });

  if (failedDownloads.length > 0) {
    p.log.warn(
      `Could not download ${failedDownloads.length} addon(s) — install them manually via the Redaxo installer:\n` +
        failedDownloads.map((f) => `  • ${f}`).join("\n"),
    );
  }
}

/**
 * Wrap an exec call so a failure carries the addon key in its message.
 * Without this, all you see is "Command failed: php bin/console package:install yrewrite",
 * with no detail on which step or addon broke when there are 30+ addons in the loop.
 */
async function runWithContext(
  step: string,
  addonKey: string,
  file: string,
  args: string[],
  cwd: string,
  verbose: boolean,
): Promise<void> {
  try {
    await exec(file, args, { cwd, verbose });
  } catch (err) {
    const e = err as Error & { stderr?: string; stdout?: string };
    const detail = [e.stderr, e.stdout].filter(Boolean).join("\n").trim();
    const suffix = detail ? `\n${detail}` : "";
    throw new Error(`${step} ${addonKey} failed${suffix}`);
  }
}
