import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfigFile } from "../load-config.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "viterex-loadcfg-test-"));
});

afterEach(async () => {
  await fs.remove(tmpDir);
});

describe("loadConfigFile — path resolution", () => {
  const minimalConfig = {
    projectName: "fixture",
    projectDir: "/tmp/fixture",
    redaxoVersion: "5.20.2",
  };

  it("loads from a JSON file path", async () => {
    const file = path.join(tmpDir, "viterex.json");
    await fs.writeJSON(file, minimalConfig);

    const result = await loadConfigFile(file, "modern");

    expect(result.projectName).toBe("fixture");
    expect(result.layout).toBe("modern"); // backfilled
  });

  it("loads from a directory path containing viterex.json", async () => {
    await fs.writeJSON(path.join(tmpDir, "viterex.json"), minimalConfig);

    const result = await loadConfigFile(tmpDir, "modern");

    expect(result.projectName).toBe("fixture");
    expect(result.installMode).toBe("fresh"); // backfilled
  });

  it("backfills missing fields", async () => {
    await fs.writeJSON(path.join(tmpDir, "viterex.json"), minimalConfig);

    const result = await loadConfigFile(tmpDir, "classic");

    expect(result.templateReplacements).toEqual({});
    expect(result.preset).toBe("custom");
    expect(result.layout).toBe("classic");
    expect(result.redaxoLang).toBe("de_de");
    expect(result.redaxoTimezone).toBe("Europe/Berlin");
    expect(result.addons).toEqual([]);
  });
});
