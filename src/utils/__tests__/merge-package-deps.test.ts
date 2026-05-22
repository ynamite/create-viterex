import { describe, expect, it } from "vitest";
import { mergePackageDeps } from "../merge-package-deps.js";

describe("mergePackageDeps", () => {
  it("adds new deps into an empty package.json", () => {
    const { pkg, added } = mergePackageDeps(
      { name: "x" },
      {
        dependencies: { alpinejs: "^3.14.0" },
        devDependencies: { "@iconify/tailwind4": "^1.0.0" },
      },
    );
    expect(added).toBe(2);
    expect(pkg.dependencies).toEqual({ alpinejs: "^3.14.0" });
    expect(pkg.devDependencies).toEqual({ "@iconify/tailwind4": "^1.0.0" });
  });

  it("is additive — keeps user deps not present in the incoming set", () => {
    const { pkg, added } = mergePackageDeps(
      { dependencies: { "user-only": "^1.0.0" } },
      { dependencies: { alpinejs: "^3.14.0" } },
    );
    expect(added).toBe(1);
    expect(pkg.dependencies).toEqual({
      alpinejs: "^3.14.0",
      "user-only": "^1.0.0",
    });
  });

  it("takes the incoming constraint when it is the higher one", () => {
    const { pkg, added } = mergePackageDeps(
      { dependencies: { swiper: "^11.0.0" } },
      { dependencies: { swiper: "^11.2.0" } },
    );
    expect(added).toBe(0);
    expect((pkg.dependencies as Record<string, string>).swiper).toBe("^11.2.0");
  });

  it("keeps the existing constraint when it is the higher one", () => {
    const { pkg } = mergePackageDeps(
      { dependencies: { swiper: "^11.5.0" } },
      { dependencies: { swiper: "^11.2.0" } },
    );
    expect((pkg.dependencies as Record<string, string>).swiper).toBe("^11.5.0");
  });

  it("strips range operators before comparing versions", () => {
    const { pkg } = mergePackageDeps(
      { dependencies: { gsap: "~3.12.0" } },
      { dependencies: { gsap: "^3.12.5" } },
    );
    expect((pkg.dependencies as Record<string, string>).gsap).toBe("^3.12.5");
  });

  it("sorts keys within each section", () => {
    const { pkg } = mergePackageDeps(
      { dependencies: { zzz: "^1.0.0" } },
      { dependencies: { aaa: "^1.0.0", mmm: "^1.0.0" } },
    );
    expect(Object.keys(pkg.dependencies as object)).toEqual(["aaa", "mmm", "zzz"]);
  });

  it("is idempotent — re-merging the same deps adds nothing and is stable", () => {
    const incoming = { dependencies: { alpinejs: "^3.14.0" } };
    const first = mergePackageDeps({ name: "x" }, incoming);
    const second = mergePackageDeps(first.pkg, incoming);
    expect(second.added).toBe(0);
    expect(second.pkg).toEqual(first.pkg);
  });

  it("ignores empty or missing sections", () => {
    const { added } = mergePackageDeps({ name: "x" }, { dependencies: {} });
    expect(added).toBe(0);
  });

  it("does not mutate the input package object", () => {
    const input = { dependencies: { swiper: "^11.0.0" } };
    mergePackageDeps(input, { dependencies: { alpinejs: "^3.14.0" } });
    expect(input.dependencies).toEqual({ swiper: "^11.0.0" });
  });
});
