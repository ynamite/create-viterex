import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import { dataDirFor, srcAddonsDirFor } from "../utils/detect.js";
import { pathExists, writeJSON } from "../utils/fs.js";
import { replacePlaceholders } from "../utils/replace-placeholders.js";
import type { ViterexConfig } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templatesDir = path.resolve(__dirname, "../templates");

async function processTemplate(
  tplPath: string,
  destPath: string,
  replacements: Record<string, string>,
): Promise<void> {
  if (!(await pathExists(tplPath))) return;
  const content = await fs.readFile(tplPath, "utf-8");
  await fs.writeFile(destPath, replacePlaceholders(content, replacements));
}

async function copyTemplate(srcPath: string, destPath: string): Promise<void> {
  if (!(await pathExists(srcPath))) return;
  await fs.cp(srcPath, destPath, { recursive: true, force: false });
}

export async function scaffoldFrontend(config: ViterexConfig): Promise<void> {
  const {
    projectDir,
    projectName,
    layout,
    redaxoServerName,
    redaxoAdminUser,
    redaxoAdminEmail,
    redaxoErrorEmail,
    setupDeploy,
  } = config;

  const replacements: Record<string, string> = {
    PROJECT_NAME: projectName,
    SERVER_NAME: redaxoServerName,
    ADMIN_USER: redaxoAdminUser,
    ADMIN_EMAIL: redaxoAdminEmail,
    ERROR_EMAIL: redaxoErrorEmail,
    HOST_PROTOCOL: "http",
    ...config.templateReplacements,
  };

  // ─── 1. Base static files ──────────────────────────────────────────
  const baseDir = path.join(templatesDir, "base");
  if (await pathExists(baseDir)) {
    await fs.cp(baseDir, projectDir, { recursive: true, force: false });
  }

  // ─── 2. Templated root configs ─────────────────────────────────────
  await processTemplate(path.join(templatesDir, "env.tpl"), path.join(projectDir, ".env"), replacements);
  await processTemplate(
    path.join(templatesDir, "env.tpl"),
    path.join(projectDir, ".env.local"),
    replacements,
  );

  await processTemplate(
    path.join(templatesDir, "composer.json.tpl"),
    path.join(projectDir, "composer.json"),
    replacements,
  );

  // ─── 3. Layout-aware Redaxo data files ────────────────────────────
  const dataDir = path.join(projectDir, dataDirFor(layout));
  const addonsDir = path.join(projectDir, srcAddonsDirFor(layout));

  await fs.mkdir(path.join(dataDir, "addons", "install"), { recursive: true });

  // REDAXO Installer API credentials:
  //   1. preset supplies a config file → copy it
  //   2. user answered the prompt → write a fresh config from their values
  //   3. neither → no installer config installed (Redaxo handles its absence)
  const installerConfigPath = path.join(dataDir, "addons", "install", "config.json");
  if (config.installerConfig) {
    await fs.cp(config.installerConfig, installerConfigPath, { recursive: true, force: false });
  } else if (config.installerApiLogin && config.installerApiKey) {
    await writeJSON(
      installerConfigPath,
      {
        backups: true,
        api_login: config.installerApiLogin,
        api_key: config.installerApiKey,
      },
    );
  }

  await fs.mkdir(path.join(dataDir, "addons", "ydeploy"), { recursive: true });

  if (config.seedFile) {
    await processTemplate(
      config.seedFile,
      path.join(dataDir, "seed.sql"),
      replacements,
    );
  }

  await fs.mkdir(path.join(addonsDir, "project", "fragments"), { recursive: true });

  // ─── 4. Deploy files (conditional) ────────────────────────────────
  if (setupDeploy) {
    const deployDir = path.join(templatesDir, "deploy");
    const extras = config.deployerExtras ?? [];

    // Copy preset-supplied extras to project root.
    for (const absPath of extras) {
      await fs.cp(
        absPath,
        path.join(projectDir, path.basename(absPath)),
        { recursive: true, force: false },
      );
    }

    // Build placeholder content for deploy.php.
    const requiresBlock = extras
      .map((f) => `require __DIR__ . '/${path.basename(f)}';`)
      .join("\n");
    const clearPathsBlock = extras
      .map((f) => `    '${path.basename(f)}',`)
      .join("\n");

    await processTemplate(
      path.join(deployDir, "deploy.php.tpl"),
      path.join(projectDir, "deploy.php"),
      {
        ...replacements,
        PACKAGE_MANAGER: config.packageManager,
        DEPLOYER_EXTRAS: requiresBlock,
        DEPLOYER_EXTRAS_CLEAR_PATHS: clearPathsBlock,
      },
    );

    // Collapse extra blank lines left behind when placeholders are empty.
    const deployPhp = path.join(projectDir, "deploy.php");
    const rendered = (await fs.readFile(deployPhp, "utf-8")).replace(
      /\n{3,}/g,
      "\n\n",
    );
    await fs.writeFile(deployPhp, rendered);

    await copyTemplate(
      path.join(deployDir, "deployer.task.setup.php"),
      path.join(projectDir, "deployer.task.setup.php"),
    );
  }

}
