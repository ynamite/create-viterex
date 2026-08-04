import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfigFile } from "../load-config.js";
import { writeJSON } from "../fs.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "viterex-loadcfg-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("loadConfigFile — path resolution", () => {
  const minimalConfig = {
    projectName: "fixture",
    projectDir: "/tmp/fixture",
    redaxoVersion: "5.20.2",
  };

  it("loads from a JSON file path", async () => {
    const file = path.join(tmpDir, "viterex.json");
    await writeJSON(file, minimalConfig);

    const result = await loadConfigFile(file, "modern");

    expect(result.projectName).toBe("fixture");
    expect(result.layout).toBe("modern"); // backfilled
  });

  it("loads from a directory path containing viterex.json", async () => {
    await writeJSON(path.join(tmpDir, "viterex.json"), minimalConfig);

    const result = await loadConfigFile(tmpDir, "modern");

    expect(result.projectName).toBe("fixture");
    expect(result.installMode).toBe("fresh"); // backfilled
  });

  it("backfills missing fields", async () => {
    await writeJSON(path.join(tmpDir, "viterex.json"), minimalConfig);

    const result = await loadConfigFile(tmpDir, "classic");

    expect(result.templateReplacements).toEqual({});
    expect(result.preset).toBe("custom");
    expect(result.layout).toBe("classic");
    expect(result.redaxoLang).toBe("de_de");
    expect(result.redaxoTimezone).toBe("Europe/Berlin");
    expect(result.addons).toEqual([]);
  });
});
