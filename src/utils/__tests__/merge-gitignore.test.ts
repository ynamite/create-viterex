import { describe, expect, it } from "vitest";
import { mergeGitignore } from "../merge-gitignore.js";

describe("mergeGitignore", () => {
  it("appends only the missing patterns under a header, keeping existing content", () => {
    const { content, added } = mergeGitignore(
      "node_modules\nvendor\n",
      "vendor\n.idea/\n*.log\n",
      "Added by preset 'x'",
    );
    expect(added).toBe(2);
    expect(content).toBe(
      "node_modules\nvendor\n\n# Added by preset 'x'\n.idea/\n*.log\n",
    );
  });

  it("is idempotent — re-merging the same input adds nothing and returns existing verbatim", () => {
    const existing = "node_modules\n\n# Added by preset 'x'\n.idea/\n";
    const { content, added } = mergeGitignore(existing, ".idea/\n");
    expect(added).toBe(0);
    expect(content).toBe(existing);
  });

  it("creates a fresh file (whole block) when existing is empty", () => {
    const { content, added } = mergeGitignore("", "dist/\n.cache/\n", "Added by preset 'x'");
    expect(added).toBe(2);
    expect(content).toBe("# Added by preset 'x'\ndist/\n.cache/\n");
  });

  it("ignores comments and blank lines in the incoming text", () => {
    const { content, added } = mergeGitignore(
      "node_modules\n",
      "# a comment\n\n   \n*.tmp\n",
    );
    expect(added).toBe(1);
    expect(content).toBe("node_modules\n\n# Added by preset\n*.tmp\n");
  });

  it("dedupes against existing patterns (whitespace-insensitive)", () => {
    const { added } = mergeGitignore("  vendor  \nnode_modules\n", "vendor\n");
    expect(added).toBe(0);
  });

  it("dedupes repeated patterns within the incoming text", () => {
    const { content, added } = mergeGitignore("", "*.log\n*.log\n");
    expect(added).toBe(1);
    expect(content).toBe("# Added by preset\n*.log\n");
  });

  it("uses the default header when none is given", () => {
    const { content } = mergeGitignore("a\n", "b\n");
    expect(content).toContain("# Added by preset\n");
  });
});
