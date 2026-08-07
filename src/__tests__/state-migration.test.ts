import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSavedConfig, loadState, saveState } from "../state.js";
import type { ViterexConfig } from "../types.js";
import { readJSON, writeJSON } from "../utils/fs.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "viterex-state-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("loadState — older state-file migration", () => {
  it("backfills layout / installMode / redaxoLang / redaxoTimezone when absent", async () => {
    const stateFile = path.join(tmpDir, ".viterex-state.json");
    // An old state file that pre-dates the v3 layout-detection / lang fields.
    await writeJSON(stateFile, {
      config: {
        projectName: "legacy",
        projectDir: tmpDir,
        redaxoVersion: "5.20.2",
        redaxoAdminUser: "admin",
        redaxoAdminPassword: "x",
        redaxoAdminEmail: "a@b.test",
        redaxoErrorEmail: "e@b.test",
        redaxoServerName: "legacy.test",
        skipDb: true,
        dbHost: "127.0.0.1",
        dbPort: 3306,
        dbName: "legacy",
        dbUser: "root",
        dbPassword: "",
        skipAddons: false,
        addons: [],
        packageManager: "yarn",
        preset: "custom",
        templateReplacements: {},
        setupDeploy: false,
        skipGit: true,
        gitProvider: "",
        gitNamespace: "",
        gitRepoName: "",
        verbose: false,
      },
      completedTasks: [],
    });

    const result = await loadState(tmpDir, {});

    expect(result.config.layout).toBe("modern");
    expect(result.config.installMode).toBe("fresh");
    expect(result.config.redaxoLang).toBe("de_de");
    expect(result.config.redaxoTimezone).toBe("Europe/Berlin");
  });

  it("strips package-resolved paths on save and re-derives them on load (built-in preset)", async () => {
    // Simulate paths resolved from a previous run at a different package location
    // — what would happen if the installer had been npx-installed and re-installed
    // since the state file was written.
    const stalePackageRoot = "/some/old/npx/cache/_npx/abc123/node_modules/create-viterex";
    const config = {
      projectName: "rt-test",
      projectDir: tmpDir,
      layout: "modern",
      installMode: "fresh",
      redaxoVersion: "5.21.0",
      redaxoAdminUser: "admin",
      redaxoAdminPassword: "x",
      redaxoAdminEmail: "a@b.test",
      redaxoErrorEmail: "e@b.test",
      redaxoServerName: "rt.test",
      redaxoLang: "de_de",
      redaxoTimezone: "Europe/Zurich",
      skipDb: false,
      dbHost: "127.0.0.1",
      dbPort: 3306,
      dbName: "rt",
      dbUser: "root",
      dbPassword: "",
      skipAddons: false,
      addons: [],
      packageManager: "yarn",
      preset: "default",
      // These are the absolute paths that would have been resolved last run
      // from the (now-stale) package location:
      presetDir: `${stalePackageRoot}/presets/default`,
      presetFilesDir: `${stalePackageRoot}/presets/default/files`,
      seedFile: `${stalePackageRoot}/presets/default/seed.sql.tpl`,
      installerConfig: `${stalePackageRoot}/presets/default/redaxo_installer_config.json`,
      deployerExtras: [`${stalePackageRoot}/presets/default/deploy.staging.php`],
      submoduleAddons: [],
      templateReplacements: {},
      setupDeploy: true,
      skipGit: false,
      gitProvider: "",
      gitNamespace: "",
      gitRepoName: "",
      verbose: false,
    } as unknown as ViterexConfig;

    await saveState(config, ["task-a"]);

    // On disk: the stale paths must be gone.
    const onDisk = await readJSON<{
      config: Record<string, unknown>;
    }>(path.join(tmpDir, ".viterex-state.json"));
    expect(onDisk.config.presetDir).toBeUndefined();
    expect(onDisk.config.presetFilesDir).toBeUndefined();
    expect(onDisk.config.seedFile).toBeUndefined();
    expect(onDisk.config.installerConfig).toBeUndefined();
    expect(onDisk.config.deployerExtras).toBeUndefined();
    // Sanity: persisted fields the loader needs are still there.
    expect(onDisk.config.preset).toBe("default");
    expect(onDisk.config.projectDir).toBe(tmpDir);

    // On load: paths are re-derived against the *current* package location.
    const loaded = await loadState(tmpDir, {});
    expect(loaded.config.presetDir).toBeDefined();
    expect(loaded.config.presetDir).not.toContain(stalePackageRoot);
    expect(loaded.config.presetDir!.endsWith("/presets/default")).toBe(true);
    expect(loaded.config.presetFilesDir).toBeDefined();
    expect(loaded.config.presetFilesDir!.endsWith("/presets/default/files")).toBe(true);
    expect(loaded.config.seedFile).toBeDefined();
    expect(loaded.config.seedFile!.endsWith("/presets/default/seed.sql.tpl")).toBe(true);
    // The default preset doesn't ship installerConfig or deployerExtras.
    expect(loaded.config.installerConfig).toBeUndefined();
    expect(loaded.config.deployerExtras).toBeUndefined();
  });

  it("leaves package-resolved paths unset when preset is 'custom'", async () => {
    const stateFile = path.join(tmpDir, ".viterex-state.json");
    await writeJSON(stateFile, {
      config: {
        projectDir: tmpDir,
        preset: "custom",
        addons: [],
        templateReplacements: {},
      },
      completedTasks: [],
    });

    const result = await loadState(tmpDir, {});
    expect(result.config.presetDir).toBeUndefined();
    expect(result.config.presetFilesDir).toBeUndefined();
    expect(result.config.seedFile).toBeUndefined();
  });

  it("warns and continues when the persisted preset can no longer be resolved", async () => {
    const stateFile = path.join(tmpDir, ".viterex-state.json");
    await writeJSON(stateFile, {
      config: {
        projectDir: tmpDir,
        preset: "this-preset-does-not-exist-anywhere",
        addons: [],
        templateReplacements: {},
      },
      completedTasks: [],
    });

    // Should not throw; tasks that depend on preset-derived paths will be
    // skipped by their own predicates downstream.
    const result = await loadState(tmpDir, {});
    expect(result.config.presetDir).toBeUndefined();
    expect(result.config.presetFilesDir).toBeUndefined();
  });

  it("migrates legacy massifSettings into templateReplacements", async () => {
    const stateFile = path.join(tmpDir, ".viterex-state.json");
    await writeJSON(stateFile, {
      config: {
        projectDir: tmpDir,
        massifSettings: {
          firma: "ACME",
          email: "info@acme.test",
        },
        addons: [],
      },
      completedTasks: [],
    });

    const result = await loadState(tmpDir, {});

    expect(
      (result.config as unknown as Record<string, unknown>).massifSettings,
    ).toBeUndefined();
    expect(result.config.templateReplacements.MASSIF_FIRMA).toBe("ACME");
    expect(result.config.templateReplacements.MASSIF_EMAIL).toBe(
      "info@acme.test",
    );
  });
});

describe("loadSavedConfig — persistent state reuse", () => {
  it("returns null when no state file exists", async () => {
    expect(await loadSavedConfig(tmpDir)).toBeNull();
  });

  it("returns the saved config with backfilled defaults", async () => {
    const stateFile = path.join(tmpDir, ".viterex-state.json");
    await writeJSON(stateFile, {
      config: {
        projectName: "kept",
        projectDir: tmpDir,
        redaxoVersion: "5.20.2",
        redaxoAdminUser: "admin",
        redaxoAdminPassword: "x",
        redaxoAdminEmail: "a@b.test",
        // no layout/installMode — backfill must supply them
      },
      completedTasks: ["Download Redaxo"],
    });

    const config = await loadSavedConfig(tmpDir);
    expect(config).not.toBeNull();
    expect(config?.projectName).toBe("kept");
    expect(config?.layout).toBe("modern"); // backfillConfigDefaults default
  });
});
