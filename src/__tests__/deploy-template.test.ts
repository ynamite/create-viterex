import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { replacePlaceholders } from "../utils/replace-placeholders.js";

const TPL_URL = new URL("../../templates/deploy/deploy.php.tpl", import.meta.url);

describe("deploy.php.tpl", () => {
  it("pins the chosen PM, keeps Deployer placeholders, clears all lockfiles", async () => {
    const tpl = await readFile(TPL_URL, "utf-8");
    const out = replacePlaceholders(tpl, {
      PROJECT_NAME: "demo",
      PACKAGE_MANAGER: "bun",
      DEPLOYER_EXTRAS: "",
      DEPLOYER_EXTRAS_CLEAR_PATHS: "",
    });

    // Chosen PM is checked first and used verbatim.
    expect(out).toContain("commandExist('bun')");
    expect(out).toContain("'bun install'");
    expect(out).toContain("'bun run build'");
    expect(out).not.toContain("{{PACKAGE_MANAGER}}");

    // Deployer's own runtime placeholders must survive rendering.
    expect(out).toContain("{{release_path}}");

    // Every PM's lockfile is removed from releases.
    for (const lock of [
      "bun.lock",
      "bun.lockb",
      "package-lock.json",
      "pnpm-lock.yaml",
      "yarn.lock",
    ]) {
      expect(out).toContain(`'${lock}',`);
    }
  });
});
