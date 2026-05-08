import * as p from "@clack/prompts";
import path from "node:path";
import fs from "fs-extra";
import { ADDON_CATALOG, ALWAYS_INCLUDED, type Layout, type ViterexConfig } from "./types.js";
import { discoverPresets, loadPreset, resolveSeedFile } from "./preset.js";
import { promptAugmentAddons } from "./tasks/augment-prompt.js";
import { dataDirFor, type DetectionResult } from "./utils/detect.js";
import { commandExists } from "./utils/exec.js";
import { getLatestRedaxoVersion } from "./utils/redaxo-version.js";

interface CliOptions {
  pm?: string;
  preset?: string;
  layout?: string;
  skipDb?: boolean;
  skipAddons?: boolean;
  skipGit?: boolean;
  fresh?: boolean;
  forcePush?: boolean;
  withTower?: boolean;
  lang?: string;
  timezone?: string;
}

export async function collectConfig(
  projectNameArg: string | undefined,
  options: CliOptions,
  detection: DetectionResult,
): Promise<ViterexConfig> {
  const isAugment = detection.mode === "augment";

  if (isAugment) {
    p.intro(
      `Detected existing Redaxo at ${detection.layout} layout — augmenting`,
    );
  } else {
    p.intro("Let's set up your ViteRex project");
  }

  // ─── Project basics ───────────────────────────────────────────────
  // `.` or `./` means "use current directory": projectDir = cwd, and the
  // project name (and vhost) defaults to slugified basename(cwd).
  const useCurrentDir = projectNameArg === "." || projectNameArg === "./";
  const cwdName = slugifyProjectName(path.basename(process.cwd()));
  const projectDirForRead = isAugment || useCurrentDir ? process.cwd() : "";
  const augmentExistingValues = isAugment
    ? await readExistingRedaxoConfig(projectDirForRead, detection.layout)
    : null;

  const projectNameDefault =
    (useCurrentDir ? cwdName : projectNameArg) ??
    augmentExistingValues?.projectName ??
    "my-viterex-project";

  const projectName = await p.text({
    message: "Project name",
    initialValue: projectNameDefault,
    validate: (v) => {
      if (!/^[a-z0-9_-]+$/i.test(v)) return "Only alphanumeric, hyphens, underscores";
    },
  });
  if (p.isCancel(projectName)) process.exit(0);

  const serverName = await p.text({
    message: "Local server name (vhost URL)",
    placeholder: `${projectName as string}.test`,
    initialValue:
      augmentExistingValues?.serverName ?? `${projectName as string}.test`,
  });
  if (p.isCancel(serverName)) process.exit(0);

  const packageManager = await p.select({
    message: "Package manager",
    initialValue: (options.pm as ViterexConfig["packageManager"]) ?? "pnpm",
    options: [
      { value: "pnpm", label: "pnpm" },
      { value: "yarn", label: "Yarn" },
      { value: "npm", label: "npm" },
    ],
  });
  if (p.isCancel(packageManager)) process.exit(0);

  // ─── Preset selection ─────────────────────────────────────────────
  // Runs before layout selection so a preset that declares a `layout` can
  // skip the layout prompt entirely. CLI `--layout` still wins over the
  // preset's declared layout; if they disagree the apply-preset-files task
  // errors out before any file is touched.
  let presetId = (options.preset as string) ?? "";
  let presetDir: string | undefined;
  let presetLayout: Layout | undefined;
  let presetFilesDir: string | undefined;
  let seedFile: string | undefined;
  let submoduleAddons: ViterexConfig["submoduleAddons"];
  let templateReplacements: Record<string, string> = {};
  let presetAddons: ViterexConfig["addons"] | undefined;
  let installerConfig: string | undefined;
  let deployerExtras: string[] | undefined;
  let installerApiLogin: string | undefined;
  let installerApiKey: string | undefined;

  if (!presetId) {
    const presetNames = await discoverPresets();
    const selected = await p.select({
      message: "Select a preset",
      options: presetNames.map((name) => ({
        value: name,
        label: name === "custom" ? "Custom (manual configuration)" : name,
      })),
    });
    if (p.isCancel(selected)) process.exit(0);
    presetId = selected as string;
  }

  const loaded = await loadPreset(presetId);
  if (loaded) {
    presetDir = loaded.dir;
    if (loaded.config.seedFile) {
      seedFile = resolveSeedFile(loaded.config.seedFile, loaded.dir);
    }
    submoduleAddons = loaded.config.submoduleAddons;
    templateReplacements = loaded.config.templateReplacements ?? {};
    if (loaded.config.addons) {
      presetAddons = loaded.config.addons;
    }
    if (loaded.config.installerConfig) {
      installerConfig = path.resolve(loaded.dir, loaded.config.installerConfig);
    }
    if (loaded.config.deployerExtras?.length) {
      deployerExtras = loaded.config.deployerExtras.map((f) =>
        path.resolve(loaded.dir, f),
      );
    }
    if (loaded.config.layout) {
      presetLayout = loaded.config.layout;
    }
    const filesDirName = loaded.config.filesDir ?? "files";
    const filesDirPath = path.resolve(loaded.dir, filesDirName);
    if (await fs.pathExists(filesDirPath)) {
      presetFilesDir = filesDirPath;
    }
  }

  // ─── Layout (fresh only) ──────────────────────────────────────────
  let layout: Layout = detection.layout;
  if (!isAugment) {
    if (options.layout) {
      layout = normalizeLayout(options.layout);
    } else if (presetLayout) {
      layout = presetLayout;
      p.log.info(`Using layout '${layout}' from preset '${presetId}'.`);
    } else {
      const selected = await p.select({
        message: "Directory layout",
        initialValue: "modern" as Layout,
        options: [
          { value: "modern", label: "Modern (recommended) — ydeploy-opinionated; bin/, src/, var/, public/" },
          { value: "classic", label: "Classic — Redaxo defaults; redaxo/ at project root" },
          { value: "classic+theme", label: "Classic + theme — classic + FriendsOfREDAXO/theme addon" },
        ],
      });
      if (p.isCancel(selected)) process.exit(0);
      layout = selected as Layout;
    }
  }

  // ─── Redaxo config (fresh only) ───────────────────────────────────
  let redaxoVersion = "5.20.2";
  let adminUser = "admin";
  let adminPassword = "";
  let adminEmail = "";
  let errorEmail = "";
  // Preset > CLI flag > system default. System timezone via Intl
  // (resolves to e.g. "Europe/Zurich" on macOS); falls back to UTC if missing.
  const systemTimezone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  let lang =
    options.lang ?? loaded?.config.redaxoLang ?? "de_de";
  let timezone =
    options.timezone ?? loaded?.config.redaxoTimezone ?? systemTimezone;

  if (!isAugment) {
    // Resolve the latest Redaxo release as the prompt default; falls back to
    // the bundled FALLBACK_VERSION if the network call fails.
    const latestVersion = await getLatestRedaxoVersion();
    redaxoVersion = latestVersion;
    const versionAnswer = await p.text({ message: "Redaxo version", initialValue: redaxoVersion });
    if (p.isCancel(versionAnswer)) process.exit(0);
    redaxoVersion = versionAnswer as string;

    const adminUserAnswer = await p.text({ message: "Admin username", initialValue: adminUser });
    if (p.isCancel(adminUserAnswer)) process.exit(0);
    adminUser = adminUserAnswer as string;

    const adminPasswordAnswer = await p.password({
      message: "Admin password (Redaxo rule: 8–4096 characters)",
      validate: (v) => {
        if (v.length < 8) return "Must be at least 8 characters (Redaxo password rule).";
        if (v.length > 4096) return "Must be at most 4096 characters.";
      },
    });
    if (p.isCancel(adminPasswordAnswer)) process.exit(0);
    adminPassword = adminPasswordAnswer as string;

    const adminEmailAnswer = await p.text({
      message: "Admin email",
      validate: (v) => (!v.includes("@") ? "Enter a valid email" : undefined),
    });
    if (p.isCancel(adminEmailAnswer)) process.exit(0);
    adminEmail = adminEmailAnswer as string;

    const errorEmailAnswer = await p.text({
      message: "Error notification email",
      initialValue: adminEmail,
      validate: (v) => (!v.includes("@") ? "Enter a valid email" : undefined),
    });
    if (p.isCancel(errorEmailAnswer)) process.exit(0);
    errorEmail = errorEmailAnswer as string;

    if (!options.lang) {
      const langAnswer = await p.text({ message: "Redaxo language", initialValue: lang });
      if (p.isCancel(langAnswer)) process.exit(0);
      lang = langAnswer as string;
    }

    if (!options.timezone) {
      const tzAnswer = await p.text({ message: "Timezone", initialValue: timezone });
      if (p.isCancel(tzAnswer)) process.exit(0);
      timezone = tzAnswer as string;
    }

    // REDAXO Installer API credentials — preset wins; otherwise opt-in prompt.
    // Defaults to no, since most local-dev users don't have an API key.
    if (!installerConfig) {
      const wants = await p.confirm({
        message: "Configure REDAXO Installer API credentials?",
        initialValue: false,
      });
      if (p.isCancel(wants)) process.exit(0);
      if (wants) {
        const login = await p.text({
          message: "REDAXO Installer username",
          validate: (v) => (v.length === 0 ? "Required" : undefined),
        });
        if (p.isCancel(login)) process.exit(0);
        const key = await p.password({
          message: "REDAXO Installer API key",
          validate: (v) => (v.length === 0 ? "Required" : undefined),
        });
        if (p.isCancel(key)) process.exit(0);
        installerApiLogin = login as string;
        installerApiKey = key as string;
      }
    }
  }

  // ─── Database (fresh only) ────────────────────────────────────────
  let db = {
    skipDb: !!options.skipDb,
    host: "127.0.0.1",
    port: 3306,
    name: "",
    user: "root",
    password: "",
  };

  if (!isAugment && !options.skipDb) {
    const host = await p.text({ message: "DB host", initialValue: "127.0.0.1" });
    if (p.isCancel(host)) process.exit(0);
    const port = await p.text({ message: "DB port", initialValue: "3306" });
    if (p.isCancel(port)) process.exit(0);
    const dbName = await p.text({
      message: "DB name",
      initialValue: (projectName as string).replace(/-/g, "_"),
    });
    if (p.isCancel(dbName)) process.exit(0);
    const user = await p.text({ message: "DB user", initialValue: "root" });
    if (p.isCancel(user)) process.exit(0);
    const password = await p.password({ message: "DB password" });
    if (p.isCancel(password)) process.exit(0);

    db = {
      skipDb: false,
      host: host as string,
      port: parseInt(port as string),
      name: dbName as string,
      user: user as string,
      password: password as string,
    };
  }

  // ─── Addon selection ──────────────────────────────────────────────
  let addons: ViterexConfig["addons"] = [];

  if (isAugment) {
    addons = await promptAugmentAddons(detection);
  } else {
    let extras: ViterexConfig["addons"] = [];

    if (presetAddons) {
      extras = presetAddons.filter(
        (a) => !ALWAYS_INCLUDED.some((b) => b.key === a.key),
      );
    } else if (!options.skipAddons) {
      const selected = await p.multiselect({
        message: "Select addons to install (baseline addons are always installed)",
        options: ADDON_CATALOG.map((a) => ({
          value: a.key,
          label: a.label,
          hint: a.recommended ? "recommended" : undefined,
        })),
        initialValues: ADDON_CATALOG.filter((a) => a.recommended).map((a) => a.key),
        required: false,
      });

      if (p.isCancel(selected)) process.exit(0);

      extras = (selected as string[]).map((key) => {
        const catalogEntry = ADDON_CATALOG.find((a) => a.key === key);
        return {
          key,
          install: true,
          activate: true,
          plugins: catalogEntry?.plugins,
        };
      });

      const extraAddons = await p.text({
        message: "Extra addon keys (comma-separated, or leave empty)",
        placeholder: "addon1, addon2",
        defaultValue: "",
      });

      if (!p.isCancel(extraAddons) && extraAddons) {
        const extraKeys = (extraAddons as string)
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean);
        for (const key of extraKeys) {
          extras.push({ key, install: true, activate: true });
        }
      }
    }

    addons = [...ALWAYS_INCLUDED, ...extras];
  }

  // ─── Custom prompts (from preset) ─────────────────────────────────
  if (loaded?.config.customPrompts?.length) {
    for (const prompt of loaded.config.customPrompts) {
      const value = await p.text({
        message: prompt.message,
        placeholder: prompt.placeholder,
        initialValue: prompt.initialValue,
        validate: prompt.required ? (v) => (!v ? "This field is required" : undefined) : undefined,
      });
      if (p.isCancel(value)) process.exit(0);
      templateReplacements[prompt.key] = (value as string) ?? "";
    }
  }

  // ─── Seed file (custom preset only) ───────────────────────────────
  if (presetId === "custom") {
    const seedPath = await p.text({
      message: "Path to SQL seed file (optional, leave empty to skip)",
      placeholder: "/path/to/seed.sql.tpl",
      defaultValue: "",
    });
    if (!p.isCancel(seedPath) && seedPath) {
      seedFile = path.resolve(seedPath as string);
    }
  }

  // ─── Frontend / deploy ────────────────────────────────────────────
  const setupDeploy = await p.confirm({ message: "Set up ydeploy?", initialValue: true });
  if (p.isCancel(setupDeploy)) process.exit(0);

  // ─── Git ──────────────────────────────────────────────────────────
  // Local first, then remote (only if local).
  let skipGit = !!options.skipGit;
  let gitProvider = "";
  let gitNamespace = "";
  let gitRepoName = "";
  let withTower = false;

  if (!skipGit) {
    const initLocal = await p.confirm({
      message: "Initialize a local git repository?",
      initialValue: true,
    });
    if (p.isCancel(initLocal)) process.exit(0);
    skipGit = !initLocal;

    if (!skipGit) {
      // Tower (macOS-only opt-in). Skip if preset opts out, or gittower
      // isn't on PATH, or the user declined local git above.
      const presetTower = loaded?.config.withTower;
      if (
        process.platform === "darwin" &&
        presetTower !== false &&
        (await commandExists("gittower"))
      ) {
        const answer = await p.confirm({
          message: "Add the repo to Git Tower?",
          initialValue: presetTower === true,
        });
        if (p.isCancel(answer)) process.exit(0);
        withTower = answer as boolean;
      }

      const setupRemote = await p.confirm({
        message: "Create a remote git repository?",
        initialValue: false,
      });
      if (p.isCancel(setupRemote)) process.exit(0);

      if (setupRemote) {
        const provider = await p.select({
          message: "Git provider",
          initialValue: "github.com",
          options: [
            { value: "github.com", label: "GitHub" },
            { value: "gitlab.com", label: "GitLab" },
          ],
        });
        if (p.isCancel(provider)) process.exit(0);

        const namespace = await p.text({ message: "Organization / username" });
        if (p.isCancel(namespace)) process.exit(0);

        const repoName = await p.text({
          message: "Repository name",
          initialValue: projectName as string,
        });
        if (p.isCancel(repoName)) process.exit(0);

        gitProvider = provider as string;
        gitNamespace = namespace as string;
        gitRepoName = repoName as string;
      }
    }
  }

  p.outro("Config collected — starting installation...");

  return {
    projectName: projectName as string,
    projectDir:
      isAugment || useCurrentDir
        ? process.cwd()
        : path.resolve(process.cwd(), projectName as string),
    layout,
    installMode: isAugment ? "augment" : "fresh",
    redaxoVersion,
    redaxoAdminUser: adminUser,
    redaxoAdminPassword: adminPassword,
    redaxoAdminEmail: adminEmail,
    redaxoErrorEmail: errorEmail,
    redaxoServerName: serverName as string,
    redaxoLang: lang,
    redaxoTimezone: timezone,
    skipDb: db.skipDb,
    dbHost: db.host,
    dbPort: db.port,
    dbName: db.name,
    dbUser: db.user,
    dbPassword: db.password,
    skipAddons: !!options.skipAddons,
    addons,
    packageManager: packageManager as ViterexConfig["packageManager"],
    preset: presetId,
    presetDir,
    presetLayout,
    presetFilesDir,
    seedFile,
    submoduleAddons,
    templateReplacements,
    setupDeploy: setupDeploy as boolean,
    skipGit,
    gitProvider,
    gitNamespace,
    gitRepoName,
    verbose: false,
    forcePush: !!options.forcePush,
    withTower: withTower || !!options.withTower,
    installerConfig,
    deployerExtras,
    installerApiLogin,
    installerApiKey,
  };
}

/**
 * Slugify a directory basename into a valid project name (alphanumeric +
 * hyphens + underscores). Spaces become hyphens; everything else outside
 * the allowed set is dropped. Used when the user passes `.` so the cwd
 * basename can become a project-name default that passes validation.
 */
function slugifyProjectName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeLayout(value: string): Layout {
  const v = value.toLowerCase().replace(/\s+/g, "");
  if (v === "m" || v === "modern") return "modern";
  if (v === "c" || v === "classic") return "classic";
  if (v === "ct" || v === "classic+theme" || v === "classictheme" || v === "theme") {
    return "classic+theme";
  }
  throw new Error(`Unknown --layout value: "${value}". Expected modern | classic | classic+theme.`);
}

interface ExistingRedaxoSnapshot {
  projectName?: string;
  serverName?: string;
}

async function readExistingRedaxoConfig(
  projectDir: string,
  layout: Layout,
): Promise<ExistingRedaxoSnapshot> {
  try {
    const configPath = path.join(projectDir, dataDirFor(layout), "core", "config.yml");
    if (!(await fs.pathExists(configPath))) return {};
    const content = await fs.readFile(configPath, "utf-8");

    const serverMatch = content.match(/^server:\s*['"]?([^'"\n]+)['"]?\s*$/m);
    const serverNameMatch = content.match(/^servername:\s*['"]?([^'"\n]+)['"]?\s*$/m);

    let serverName: string | undefined;
    if (serverMatch) {
      try {
        serverName = new URL(serverMatch[1]).host;
      } catch {
        // ignore
      }
    }

    return {
      projectName: serverNameMatch?.[1]?.trim().toLowerCase().replace(/\s+/g, "-"),
      serverName,
    };
  } catch {
    return {};
  }
}
