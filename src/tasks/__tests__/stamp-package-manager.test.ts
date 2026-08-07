import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stampPackageManagerField } from "../install-deps.js";

async function tmpProject(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "viterex-stamp-"));
}

describe("stampPackageManagerField", () => {
  it("adds the packageManager field and preserves tab indentation", async () => {
    const dir = await tmpProject();
    await writeFile(
      path.join(dir, "package.json"),
      '{\n\t"name": "x",\n\t"scripts": {\n\t\t"dev": "vite"\n\t}\n}\n',
    );

    await stampPackageManagerField(dir, "bun@1.2.20");

    const raw = await readFile(path.join(dir, "package.json"), "utf-8");
    const pkg = JSON.parse(raw);
    expect(pkg.packageManager).toBe("bun@1.2.20");
    expect(pkg.scripts.dev).toBe("vite");
    expect(raw).toContain('\t"name"'); // indentation style kept
    expect(raw.endsWith("\n")).toBe(true);
  });

  it("is a no-op when package.json is missing", async () => {
    const dir = await tmpProject();
    await expect(stampPackageManagerField(dir, "bun@1.2.20")).resolves.toBeUndefined();
  });

  it("overwrites an existing packageManager field (idempotent re-run)", async () => {
    const dir = await tmpProject();
    await writeFile(path.join(dir, "package.json"), '{\n  "packageManager": "pnpm@9.0.0"\n}\n');

    await stampPackageManagerField(dir, "pnpm@10.0.0");

    const pkg = JSON.parse(await readFile(path.join(dir, "package.json"), "utf-8"));
    expect(pkg.packageManager).toBe("pnpm@10.0.0");
  });
});
