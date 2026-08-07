import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureStateIgnored } from "../init-git.js";

async function tmpProject(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "viterex-ignore-"));
}

describe("ensureStateIgnored", () => {
  it("creates .gitignore with the state entry when none exists", async () => {
    const dir = await tmpProject();
    await ensureStateIgnored(dir);
    const content = await readFile(path.join(dir, ".gitignore"), "utf-8");
    expect(content).toContain("# Added by create-viterex");
    expect(content).toContain(".viterex-state.json");
  });

  it("appends to an existing .gitignore without touching its content", async () => {
    const dir = await tmpProject();
    await writeFile(path.join(dir, ".gitignore"), "node_modules\ndist\n");
    await ensureStateIgnored(dir);
    const content = await readFile(path.join(dir, ".gitignore"), "utf-8");
    expect(content).toContain("node_modules");
    expect(content).toContain("dist");
    expect(content).toContain(".viterex-state.json");
  });

  it("is idempotent — a second run changes nothing", async () => {
    const dir = await tmpProject();
    await ensureStateIgnored(dir);
    const first = await readFile(path.join(dir, ".gitignore"), "utf-8");
    await ensureStateIgnored(dir);
    const second = await readFile(path.join(dir, ".gitignore"), "utf-8");
    expect(second).toBe(first);
  });
});
