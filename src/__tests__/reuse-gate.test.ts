import { describe, expect, it } from "vitest";
import { savedConfigMatchesFlags } from "../state.js";
import type { ViterexConfig } from "../types.js";

const saved = {
  packageManager: "bun",
  layout: "modern",
  redaxoLang: "de_de",
  redaxoTimezone: "Europe/Zurich",
  preset: "/tmp/presets/massif",
} as ViterexConfig;

describe("savedConfigMatchesFlags", () => {
  it("offers reuse when no flags are passed", () => {
    expect(savedConfigMatchesFlags(saved, {})).toBe(true);
  });
  it("offers reuse when flags equal the saved values (same command line re-run)", () => {
    expect(
      savedConfigMatchesFlags(saved, {
        preset: "/tmp/presets/../presets/massif",
        layout: "m",
        pm: "bun",
        lang: "de_de",
        timezone: "Europe/Zurich",
      }),
    ).toBe(true);
  });
  it("skips the offer when a flag disagrees with the saved value", () => {
    expect(savedConfigMatchesFlags(saved, { preset: "default" })).toBe(false);
    expect(savedConfigMatchesFlags(saved, { layout: "c" })).toBe(false);
    expect(savedConfigMatchesFlags(saved, { pm: "pnpm" })).toBe(false);
  });
});
