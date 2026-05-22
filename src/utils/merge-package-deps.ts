/**
 * Additive merge of npm dependency declarations into a project package.json.
 *
 * Mirrors `Ynamite\ViteRex\StubsInstaller::syncPackageDeps()` (PHP, shipped in
 * viterex_addon): never removes existing deps; on a name conflict the higher
 * constraint wins (compared on the leading numeric segments, after stripping a
 * leading `^ ~ >= <= > <` range operator); keys in each section are sorted.
 *
 * Pure — does no I/O. The caller reads and writes package.json.
 */

export interface PackageDeps {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** Strip a leading semver-range operator so two constraints can be compared. */
function bareVersion(constraint: string): string {
  return constraint.replace(/^[\^~>=< ]+/, "");
}

/**
 * Compare two bare version strings on their leading numeric segments.
 * Returns >0 when `a` is higher, <0 when lower, 0 when equal.
 */
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Merge `incoming` deps into a parsed `package.json` object. Returns a new
 * object (the input is not mutated) plus the count of newly-added entries.
 */
export function mergePackageDeps(
  pkg: Record<string, unknown>,
  incoming: PackageDeps,
): { pkg: Record<string, unknown>; added: number } {
  const result: Record<string, unknown> = { ...pkg };
  let added = 0;

  for (const section of ["dependencies", "devDependencies"] as const) {
    const incomingSection = incoming[section];
    if (!incomingSection || Object.keys(incomingSection).length === 0) continue;

    const existing = result[section];
    const current: Record<string, string> =
      typeof existing === "object" && existing !== null
        ? { ...(existing as Record<string, string>) }
        : {};

    for (const [name, constraint] of Object.entries(incomingSection)) {
      if (current[name] === undefined) {
        current[name] = constraint;
        added++;
        continue;
      }
      // Both declare it — keep whichever constraint is higher.
      if (compareVersions(bareVersion(constraint), bareVersion(current[name])) > 0) {
        current[name] = constraint;
      }
    }

    result[section] = Object.fromEntries(
      Object.entries(current).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  }

  return { pkg: result, added };
}
