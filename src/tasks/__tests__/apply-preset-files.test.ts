import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyPresetFiles } from "../apply-preset-files.js";
import type { ViterexConfig } from "../../types.js";
import { pathExists, readJSON, writeJSON } from "../../utils/fs.js";

let tmpDir: string;
let projectDir: string;
let presetDir: string;
let presetFilesDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "viterex-apply-preset-test-"));
  projectDir = path.join(tmpDir, "project");
  presetDir = path.join(tmpDir, "preset");
  presetFilesDir = path.join(presetDir, "files");
  await fs.mkdir(projectDir, { recursive: true });
  await fs.mkdir(presetFilesDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function outputFile(p: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, content);
}

function makeConfig(overrides: Partial<ViterexConfig> = {}): ViterexConfig {
  return {
    projectDir,
    layout: "modern",
    preset: "test-preset",
    ...overrides,
  } as ViterexConfig;
}

describe("applyPresetFiles", () => {
  it("is a no-op when presetFilesDir is undefined", async () => {
    await applyPresetFiles(makeConfig({ presetFilesDir: undefined }));
    const entries = await fs.readdir(projectDir);
    expect(entries).toEqual([]);
  });

  it("copies files verbatim when presetLayout is unset", async () => {
    await outputFile(path.join(presetFilesDir, ".env.example"), "FOO=bar\n");
    await outputFile(
      path.join(presetFilesDir, "src/assets/img/logo.svg"),
      "<svg/>",
    );

    await applyPresetFiles(makeConfig({ presetFilesDir }));

    expect(await fs.readFile(path.join(projectDir, ".env.example"), "utf-8")).toBe(
      "FOO=bar\n",
    );
    expect(
      await fs.readFile(path.join(projectDir, "src/assets/img/logo.svg"), "utf-8"),
    ).toBe("<svg/>");
  });

  it("copies files when presetLayout matches selected layout", async () => {
    await outputFile(path.join(presetFilesDir, ".env.example"), "FOO=bar\n");

    await applyPresetFiles(
      makeConfig({ presetFilesDir, presetLayout: "modern", layout: "modern" }),
    );

    expect(await fs.readFile(path.join(projectDir, ".env.example"), "utf-8")).toBe(
      "FOO=bar\n",
    );
  });

  it("throws before copying when presetLayout does not match", async () => {
    await outputFile(path.join(presetFilesDir, ".env.example"), "FOO=bar\n");

    await expect(
      applyPresetFiles(
        makeConfig({ presetFilesDir, presetLayout: "classic", layout: "modern" }),
      ),
    ).rejects.toThrow(/targets layout 'classic'.*'modern' was selected/);

    expect(await pathExists(path.join(projectDir, ".env.example"))).toBe(false);
  });

  it("overwrites existing destination files", async () => {
    await outputFile(path.join(presetFilesDir, ".env.example"), "FROM=preset\n");
    await outputFile(path.join(projectDir, ".env.example"), "FROM=user\n");

    await applyPresetFiles(makeConfig({ presetFilesDir }));

    expect(await fs.readFile(path.join(projectDir, ".env.example"), "utf-8")).toBe(
      "FROM=preset\n",
    );
  });

  it("merges folder contents without removing pre-existing siblings", async () => {
    await outputFile(path.join(presetFilesDir, "src/a.txt"), "preset-a\n");
    await outputFile(path.join(projectDir, "src/b.txt"), "user-b\n");

    await applyPresetFiles(makeConfig({ presetFilesDir }));

    expect(await fs.readFile(path.join(projectDir, "src/a.txt"), "utf-8")).toBe("preset-a\n");
    expect(await fs.readFile(path.join(projectDir, "src/b.txt"), "utf-8")).toBe("user-b\n");
  });

  it("merges a package-deps.json into the project package.json instead of copying it", async () => {
    await writeJSON(path.join(projectDir, "package.json"), {
      name: "proj",
      dependencies: { "viterex-stub-dep": "^1.0.0" },
    });
    await writeJSON(path.join(presetFilesDir, "package-deps.json"), {
      dependencies: { alpinejs: "^3.14.0" },
    });

    await applyPresetFiles(makeConfig({ presetFilesDir }));

    const pkg = await readJSON<{ dependencies?: Record<string, string> }>(
      path.join(projectDir, "package.json"),
    );
    expect(pkg.dependencies).toEqual({
      alpinejs: "^3.14.0",
      "viterex-stub-dep": "^1.0.0",
    });
    // the package-deps.json itself is not copied into the project
    expect(await pathExists(path.join(projectDir, "package-deps.json"))).toBe(false);
  });

  it("does not copy .DS_Store files", async () => {
    await outputFile(path.join(presetFilesDir, "public/favicon.ico"), "icon");
    await outputFile(path.join(presetFilesDir, ".DS_Store"), "junk");

    await applyPresetFiles(makeConfig({ presetFilesDir }));

    expect(await pathExists(path.join(projectDir, "public/favicon.ico"))).toBe(true);
    expect(await pathExists(path.join(projectDir, ".DS_Store"))).toBe(false);
  });

  it("package-deps merge is idempotent — a second run leaves package.json byte-identical", async () => {
    await writeJSON(path.join(projectDir, "package.json"), { name: "proj" });
    await writeJSON(path.join(presetFilesDir, "package-deps.json"), {
      dependencies: { alpinejs: "^3.14.0" },
    });

    await applyPresetFiles(makeConfig({ presetFilesDir }));
    const first = await fs.readFile(path.join(projectDir, "package.json"), "utf-8");
    await applyPresetFiles(makeConfig({ presetFilesDir }));
    const second = await fs.readFile(path.join(projectDir, "package.json"), "utf-8");

    expect(second).toBe(first);
  });

  it("copies files even when the project package.json is missing", async () => {
    await outputFile(path.join(presetFilesDir, "src/assets/css/style.css"), "body{}");
    await writeJSON(path.join(presetFilesDir, "package-deps.json"), {
      dependencies: { alpinejs: "^3.14.0" },
    });

    await applyPresetFiles(makeConfig({ presetFilesDir }));

    expect(await pathExists(path.join(projectDir, "src/assets/css/style.css"))).toBe(true);
    expect(await pathExists(path.join(projectDir, "package.json"))).toBe(false);
  });

  it("merges a top-level .gitignore into the project .gitignore instead of clobbering it", async () => {
    await outputFile(path.join(projectDir, ".gitignore"), "node_modules\nvendor\n");
    await outputFile(path.join(presetFilesDir, ".gitignore"), "vendor\n.idea/\n");

    await applyPresetFiles(makeConfig({ presetFilesDir }));

    const gi = await fs.readFile(path.join(projectDir, ".gitignore"), "utf-8");
    expect(gi).toContain("node_modules"); // existing entry preserved
    expect(gi).toContain(".idea/"); // preset entry appended
    expect(gi).toContain("# Added by preset 'test-preset'");
    // `vendor` already existed → appended once, not duplicated
    expect(gi.match(/vendor/g)).toHaveLength(1);
  });

  it("creates the project .gitignore from a preset .gitignore when none exists", async () => {
    await outputFile(path.join(presetFilesDir, ".gitignore"), "dist/\n.cache/\n");

    await applyPresetFiles(makeConfig({ presetFilesDir }));

    const gi = await fs.readFile(path.join(projectDir, ".gitignore"), "utf-8");
    expect(gi).toContain("dist/");
    expect(gi).toContain(".cache/");
  });

  it("copies a nested .gitignore verbatim (only the top-level one is merged)", async () => {
    await outputFile(path.join(presetFilesDir, ".gitignore"), "dist/\n");
    await outputFile(
      path.join(presetFilesDir, "public/uploads/.gitignore"),
      "*\n!.gitkeep\n",
    );

    await applyPresetFiles(makeConfig({ presetFilesDir }));

    // nested .gitignore is copied as-is
    expect(
      await fs.readFile(path.join(projectDir, "public/uploads/.gitignore"), "utf-8"),
    ).toBe("*\n!.gitkeep\n");
    // top-level .gitignore was merged (carries the header), not verbatim-copied
    const gi = await fs.readFile(path.join(projectDir, ".gitignore"), "utf-8");
    expect(gi).toContain("# Added by preset 'test-preset'");
    expect(gi).toContain("dist/");
  });

  it("gitignore merge is idempotent — a second run leaves .gitignore byte-identical", async () => {
    await outputFile(path.join(projectDir, ".gitignore"), "node_modules\n");
    await outputFile(path.join(presetFilesDir, ".gitignore"), ".idea/\n");

    await applyPresetFiles(makeConfig({ presetFilesDir }));
    const first = await fs.readFile(path.join(projectDir, ".gitignore"), "utf-8");
    await applyPresetFiles(makeConfig({ presetFilesDir }));
    const second = await fs.readFile(path.join(projectDir, ".gitignore"), "utf-8");

    expect(second).toBe(first);
  });
});
