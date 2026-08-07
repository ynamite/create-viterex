import { describe, expect, it } from "vitest";
import { detectDefaultPm, PACKAGE_MANAGERS } from "../detect-pm.js";

describe("detectDefaultPm", () => {
  it("returns bun when bun is on PATH", async () => {
    expect(await detectDefaultPm(async (cmd) => cmd === "bun")).toBe("bun");
  });

  it("falls back to pnpm when bun is missing", async () => {
    expect(await detectDefaultPm(async () => false)).toBe("pnpm");
  });

  it("lists all four package managers, bun first", () => {
    expect(PACKAGE_MANAGERS).toEqual(["bun", "pnpm", "yarn", "npm"]);
  });
});
