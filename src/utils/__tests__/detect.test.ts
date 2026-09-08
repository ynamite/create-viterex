import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isSetupComplete } from "../detect.js";

let tmpDir: string;
beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "viterex-detect-"));
});
afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function writeConfig(content: string) {
  const dir = path.join(tmpDir, "var/data/core");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "config.yml"), content);
}

describe("isSetupComplete", () => {
  it("is false when config.yml is missing (fresh download)", async () => {
    expect(await isSetupComplete(tmpDir, "modern")).toBe(false);
  });
  it("is false while Redaxo is in setup mode (setup: true)", async () => {
    await writeConfig("setup: true\nlang: de_de\n");
    expect(await isSetupComplete(tmpDir, "modern")).toBe(false);
  });
  it("is true once setup:run finished (setup: false)", async () => {
    await writeConfig("setup: false\nlang: de_de\n");
    expect(await isSetupComplete(tmpDir, "modern")).toBe(true);
  });
});
