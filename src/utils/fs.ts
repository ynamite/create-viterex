import fs from "node:fs/promises";

export async function pathExists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true, () => false);
}

export async function readJSON<T = unknown>(p: string): Promise<T> {
  return JSON.parse(await fs.readFile(p, "utf-8")) as T;
}

export async function writeJSON(p: string, data: unknown): Promise<void> {
  await fs.writeFile(p, JSON.stringify(data, null, 2) + "\n");
}
