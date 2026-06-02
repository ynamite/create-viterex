/**
 * Append-only merge of one `.gitignore`'s patterns into another.
 *
 * Mirrors `Ynamite\ViteRex\StubsInstaller::mergeGitignore()` (PHP, shipped in
 * viterex_addon): keeps every existing line; appends only the incoming patterns
 * not already present, grouped under a `# <header>` comment. Idempotent — a
 * second merge of the same input adds nothing.
 *
 * Pure — does no I/O. The caller reads and writes `.gitignore`.
 */

/** Extract real ignore patterns from raw `.gitignore` text: trimmed, no blank
 *  lines, no `#` comments, deduped (first occurrence wins). */
function patternsOf(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
}

/**
 * Merge `incoming` `.gitignore` text into `existing`. Returns the merged text
 * plus the count of newly-appended patterns. When nothing is missing the
 * `existing` string is returned verbatim (so the caller can skip the write).
 */
export function mergeGitignore(
  existing: string,
  incoming: string,
  header = "Added by preset",
): { content: string; added: number } {
  const have = new Set(
    existing.split("\n").map((l) => l.trim()).filter((l) => l !== ""),
  );
  const missing = patternsOf(incoming).filter((p) => !have.has(p));

  if (missing.length === 0) {
    return { content: existing, added: 0 };
  }

  const block = `# ${header}\n${missing.join("\n")}\n`;
  const content =
    existing.trim() === "" ? block : `${existing.replace(/\s*$/, "")}\n\n${block}`;

  return { content, added: missing.length };
}
