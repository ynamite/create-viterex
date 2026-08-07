import { describe, expect, it } from "vitest";
import { resolvePresetValues } from "../resolve-preset-values.js";
import type { CliOptions, PresetConfig } from "../../types.js";

const NO_OPTS: CliOptions = {};
const base: Pick<PresetConfig, "name" | "description"> = { name: "x", description: "" };

describe("resolvePresetValues", () => {
  it("returns all-undefined (=> prompt) with no preset and no flags", () => {
    const r = resolvePresetValues(undefined, NO_OPTS);

    expect(r.redaxoAdminEmail).toBeUndefined();
    expect(r.dbHost).toBeUndefined();
    expect(r.packageManager).toBeUndefined();
    expect(r.setupDeploy).toBeUndefined();
    expect(r.skipGit).toBeUndefined();
    expect(r.gitProvider).toBeUndefined();
    expect(r.gitNamespace).toBeUndefined();
    expect(r.gitRepoName).toBeUndefined();
    expect(r.withTower).toBeUndefined();
    // No-prompt booleans always carry a final value.
    expect(r.skipDb).toBe(false);
    expect(r.verbose).toBe(false);
    expect(r.forcePush).toBe(false);
    expect(r.fromPreset).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("uses preset scalar values and records them in fromPreset", () => {
    const preset: PresetConfig = {
      ...base,
      redaxoAdminEmail: "studio@massif.ch",
      redaxoErrorEmail: "studio@massif.ch",
      dbHost: "127.0.0.1",
      dbPort: 3306,
      dbUser: "root",
      dbPassword: "", // empty string is a real value — skip the prompt
      packageManager: "pnpm",
    };
    const r = resolvePresetValues(preset, NO_OPTS);

    expect(r.redaxoAdminEmail).toBe("studio@massif.ch");
    expect(r.dbPort).toBe(3306);
    expect(r.dbPassword).toBe("");
    expect(r.packageManager).toBe("pnpm");
    expect(r.fromPreset).toEqual(
      expect.arrayContaining([
        "redaxoAdminEmail",
        "redaxoErrorEmail",
        "dbHost",
        "dbPort",
        "dbUser",
        "dbPassword",
        "packageManager",
      ]),
    );
  });

  it("lets a CLI flag win over the preset (and not count as from-preset)", () => {
    const preset: PresetConfig = {
      ...base,
      packageManager: "pnpm",
      redaxoLang: "de_de",
      redaxoTimezone: "Europe/Zurich",
    };
    const r = resolvePresetValues(preset, { pm: "npm", lang: "en_gb", timezone: "UTC" });

    expect(r.packageManager).toBe("npm");
    expect(r.redaxoLang).toBe("en_gb");
    expect(r.redaxoTimezone).toBe("UTC");
    expect(r.fromPreset).not.toContain("packageManager");
    expect(r.fromPreset).not.toContain("redaxoLang");
    expect(r.fromPreset).not.toContain("redaxoTimezone");
  });

  describe("no-prompt booleans", () => {
    it("takes skipDb/verbose/forcePush from the preset", () => {
      const r = resolvePresetValues(
        { ...base, skipDb: true, verbose: true, forcePush: true },
        NO_OPTS,
      );
      expect(r.skipDb).toBe(true);
      expect(r.verbose).toBe(true);
      expect(r.forcePush).toBe(true);
      expect(r.fromPreset).toEqual(
        expect.arrayContaining(["skipDb", "verbose", "forcePush"]),
      );
    });

    it("lets --skip-db / --force-push flags win over the preset", () => {
      const r = resolvePresetValues(
        { ...base, skipDb: false, forcePush: false },
        { skipDb: true, forcePush: true },
      );
      expect(r.skipDb).toBe(true);
      expect(r.forcePush).toBe(true);
      expect(r.fromPreset).not.toContain("skipDb");
      expect(r.fromPreset).not.toContain("forcePush");
    });

    it("records preset.skipDb=false as from-preset", () => {
      const r = resolvePresetValues({ ...base, skipDb: false }, NO_OPTS);
      expect(r.skipDb).toBe(false);
      expect(r.fromPreset).toContain("skipDb");
    });
  });

  describe("git remote (per-field)", () => {
    it("treats an empty provider as 'explicitly no remote'", () => {
      const r = resolvePresetValues({ ...base, gitProvider: "" }, NO_OPTS);
      expect(r.gitProvider).toBe("");
      expect(r.fromPreset).toContain("gitProvider");
    });

    it("takes provider + namespace from the preset but leaves repoName to prompt when omitted", () => {
      // mirrors the massif preset: provider + namespace set, gitRepoName removed.
      const r = resolvePresetValues(
        { ...base, gitProvider: "github.com", gitNamespace: "massif-web" },
        NO_OPTS,
      );
      expect(r.gitProvider).toBe("github.com");
      expect(r.gitNamespace).toBe("massif-web");
      expect(r.gitRepoName).toBeUndefined(); // => prompt, default project name
      expect(r.fromPreset).toEqual(
        expect.arrayContaining(["gitProvider", "gitNamespace"]),
      );
      expect(r.fromPreset).not.toContain("gitRepoName");
    });

    it("pins all three when the preset provides them", () => {
      const r = resolvePresetValues(
        { ...base, gitProvider: "gitlab.com", gitNamespace: "acme", gitRepoName: "site" },
        NO_OPTS,
      );
      expect(r.gitProvider).toBe("gitlab.com");
      expect(r.gitNamespace).toBe("acme");
      expect(r.gitRepoName).toBe("site");
    });

    it("leaves gitProvider undefined (=> full opt-in flow) when the preset omits it", () => {
      const r = resolvePresetValues({ ...base }, NO_OPTS);
      expect(r.gitProvider).toBeUndefined();
      expect(r.gitNamespace).toBeUndefined();
      expect(r.gitRepoName).toBeUndefined();
    });
  });

  describe("admin password", () => {
    it("honors a valid preset password", () => {
      const r = resolvePresetValues({ ...base, redaxoAdminPassword: "longenough" }, NO_OPTS);
      expect(r.redaxoAdminPassword).toBe("longenough");
      expect(r.fromPreset).toContain("redaxoAdminPassword");
      expect(r.warnings).toEqual([]);
    });

    it("ignores a too-short preset password, warns, and falls back to prompting", () => {
      const r = resolvePresetValues({ ...base, redaxoAdminPassword: "short" }, NO_OPTS);
      expect(r.redaxoAdminPassword).toBeUndefined();
      expect(r.fromPreset).not.toContain("redaxoAdminPassword");
      expect(r.warnings).toHaveLength(1);
    });
  });

  it("handles a default-preset-style input (only withTower set)", () => {
    // presets/default/preset.json sets withTower:false and nothing else here.
    const r = resolvePresetValues({ ...base, withTower: false }, NO_OPTS);
    expect(r.withTower).toBe(false);
    expect(r.fromPreset).toEqual(["withTower"]);
    expect(r.redaxoAdminEmail).toBeUndefined();
    expect(r.dbHost).toBeUndefined();
    expect(r.gitProvider).toBeUndefined();
  });

  it("passes a preset packageManager 'bun' through when no --pm flag is set", () => {
    const preset: PresetConfig = { ...base, packageManager: "bun" };
    const r = resolvePresetValues(preset, NO_OPTS);

    expect(r.packageManager).toBe("bun");
    expect(r.fromPreset).toContain("packageManager");
  });

  it("lets an explicit --pm flag beat the preset packageManager", () => {
    const preset: PresetConfig = { ...base, packageManager: "pnpm" };
    const r = resolvePresetValues(preset, { pm: "bun" });

    expect(r.packageManager).toBe("bun");
    expect(r.fromPreset).not.toContain("packageManager");
  });
});
