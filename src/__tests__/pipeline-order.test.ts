import { describe, expect, it } from "vitest";
import { tasks } from "../pipeline.js";

describe("pipeline task order", () => {
  const names = tasks.map((t) => t.name);
  const idx = (n: string) => {
    const i = names.indexOf(n);
    expect(i, `task not found: ${n}`).toBeGreaterThan(-1);
    return i;
  };

  it("builds the frontend BEFORE the initial commit (so build output is committed, not left dirty)", () => {
    expect(idx("Build frontend")).toBeLessThan(idx("Git initial commit"));
  });

  it("syncs developer + clears cache before building", () => {
    expect(idx("Sync developer + clear cache")).toBeLessThan(idx("Build frontend"));
  });

  it("commits before pushing the remote (push needs a commit)", () => {
    expect(idx("Git initial commit")).toBeLessThan(idx("Create remote git repository"));
  });

  it("opens the browser and shows next steps AFTER the commit (no tracked-file writes after commit)", () => {
    expect(idx("Git initial commit")).toBeLessThan(idx("Open frontend and backend in browser"));
    expect(idx("Git initial commit")).toBeLessThan(idx("Show next steps"));
  });

  it("initializes git before adding submodules (submodule add needs .git)", () => {
    expect(idx("Initialize git repo")).toBeLessThan(idx("Add submodule addons (preset extras)"));
  });

  it("applies preset files before installing dependencies", () => {
    expect(idx("Apply preset files")).toBeLessThan(
      idx("Install dependencies (composer + packages)"),
    );
  });

  it("still has 18 tasks", () => {
    expect(tasks).toHaveLength(18);
  });
});
