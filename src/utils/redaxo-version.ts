const FALLBACK_VERSION = "5.20.2";
const RELEASES_URL = "https://api.github.com/repos/redaxo/redaxo/releases/latest";
const TIMEOUT_MS = 3000;

/**
 * Resolve the latest Redaxo release tag from GitHub. Falls back to a known
 * version if the request fails or times out — used as a prompt default.
 */
export async function getLatestRedaxoVersion(): Promise<string> {
  try {
    const res = await fetch(RELEASES_URL, {
      headers: {
        "User-Agent": "create-viterex",
        Accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return FALLBACK_VERSION;
    const tag = ((await res.json() as { tag_name?: string }).tag_name ?? "").trim();
    return tag || FALLBACK_VERSION;
  } catch {
    return FALLBACK_VERSION;
  }
}
