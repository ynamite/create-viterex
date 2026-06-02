import { describe, expect, it } from "vitest";
import { patchDevScriptForYdeploy } from "../patch-dev-script.js";

const MODERN = "bin/console";
const CLASSIC = "redaxo/bin/console";

describe("patchDevScriptForYdeploy", () => {
  it("rewrites a plain `vite` dev script to the ydeploy variant (modern console path)", () => {
    const { pkg, changed } = patchDevScriptForYdeploy(
      { scripts: { dev: "vite", build: "vite build" } },
      MODERN,
    );
    expect(changed).toBe(true);
    expect((pkg.scripts as Record<string, string>).dev).toBe(
      "bin/console ydeploy:diff && cross-env NODE_ENV=development vite && bin/console ydeploy:diff",
    );
    // leaves sibling scripts untouched
    expect((pkg.scripts as Record<string, string>).build).toBe("vite build");
  });

  it("uses the classic console path when given one", () => {
    const { pkg, changed } = patchDevScriptForYdeploy(
      { scripts: { dev: "vite" } },
      CLASSIC,
    );
    expect(changed).toBe(true);
    expect((pkg.scripts as Record<string, string>).dev).toBe(
      "redaxo/bin/console ydeploy:diff && cross-env NODE_ENV=development vite && redaxo/bin/console ydeploy:diff",
    );
  });

  it("is idempotent — re-patching an already-patched dev script is a no-op", () => {
    const first = patchDevScriptForYdeploy({ scripts: { dev: "vite" } }, MODERN);
    const second = patchDevScriptForYdeploy(first.pkg, MODERN);
    expect(second.changed).toBe(false);
    expect(second.pkg).toEqual(first.pkg);
  });

  it("leaves a customised dev script alone (only the exact `vite` value is patched)", () => {
    const { pkg, changed } = patchDevScriptForYdeploy(
      { scripts: { dev: "vite --host" } },
      MODERN,
    );
    expect(changed).toBe(false);
    expect((pkg.scripts as Record<string, string>).dev).toBe("vite --host");
  });

  it("does nothing when there is no scripts.dev entry", () => {
    const { changed } = patchDevScriptForYdeploy(
      { scripts: { build: "vite build" } },
      MODERN,
    );
    expect(changed).toBe(false);
  });

  it("does nothing when there is no scripts section at all", () => {
    const { pkg, changed } = patchDevScriptForYdeploy({ name: "x" }, MODERN);
    expect(changed).toBe(false);
    expect(pkg).toEqual({ name: "x" });
  });

  it("does not mutate the input package object", () => {
    const input = { scripts: { dev: "vite" } };
    patchDevScriptForYdeploy(input, MODERN);
    expect(input.scripts.dev).toBe("vite");
  });
});
