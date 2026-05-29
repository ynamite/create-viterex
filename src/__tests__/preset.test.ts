import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPreset } from "../preset.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "viterex-preset-test-"));
});

afterEach(async () => {
  await fs.remove(tmpDir);
});

describe("loadPreset — path resolution", () => {
  it("loads a preset when given a directory path", async () => {
    await fs.writeJSON(path.join(tmpDir, "preset.json"), {
      name: "fixture",
      description: "test fixture",
      addons: [],
    });

    const result = await loadPreset(tmpDir);

    expect(result).not.toBeNull();
    expect(result?.config.name).toBe("fixture");
    expect(result?.dir).toBe(tmpDir);
  });

  it("loads a preset when given a path to preset.json", async () => {
    const file = path.join(tmpDir, "preset.json");
    await fs.writeJSON(file, {
      name: "fixture",
      description: "test fixture",
      addons: [],
    });

    const result = await loadPreset(file);

    expect(result).not.toBeNull();
    expect(result?.config.name).toBe("fixture");
    expect(result?.dir).toBe(tmpDir);
  });

  it("returns dir pointing at the preset folder so relative paths resolve correctly", async () => {
    // Create a preset with a relative seedFile so we can verify dir is correct.
    await fs.writeJSON(path.join(tmpDir, "preset.json"), {
      name: "fixture",
      description: "test fixture",
      seedFile: "seed.sql.tpl",
      addons: [],
    });
    await fs.writeFile(path.join(tmpDir, "seed.sql.tpl"), "-- seed");

    const result = await loadPreset(tmpDir);

    // The dir returned is the anchor used by resolveSeedFile, filesDir,
    // installerConfig, deployerExtras. It must be tmpDir, not its parent.
    expect(result?.dir).toBe(tmpDir);
    expect(
      await fs.pathExists(path.join(result!.dir, result!.config.seedFile!)),
    ).toBe(true);
  });

  it("throws a clear error when the directory has no preset.json", async () => {
    await expect(loadPreset(tmpDir)).rejects.toThrow(/Preset not found/);
  });

  it("passes through the installer fields added to PresetConfig", async () => {
    await fs.writeJSON(path.join(tmpDir, "preset.json"), {
      name: "fixture",
      description: "test fixture",
      redaxoAdminEmail: "studio@massif.ch",
      redaxoErrorEmail: "studio@massif.ch",
      dbHost: "127.0.0.1",
      dbPort: 3306,
      packageManager: "pnpm",
      setupDeploy: true,
      gitProvider: "",
      verbose: false,
      addons: [],
    });

    const result = await loadPreset(tmpDir);

    expect(result?.config.redaxoAdminEmail).toBe("studio@massif.ch");
    expect(result?.config.redaxoErrorEmail).toBe("studio@massif.ch");
    expect(result?.config.dbHost).toBe("127.0.0.1");
    expect(result?.config.dbPort).toBe(3306);
    expect(result?.config.packageManager).toBe("pnpm");
    expect(result?.config.setupDeploy).toBe(true);
    expect(result?.config.gitProvider).toBe("");
    expect(result?.config.verbose).toBe(false);
  });
});
