import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import { exec } from "../utils/exec.js";
import { consolePathFor } from "../utils/detect.js";
import { pathExists } from "../utils/fs.js";
import type { ViterexConfig } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templatesDir = path.resolve(__dirname, "../templates");

export async function downloadRedaxo(config: ViterexConfig): Promise<void> {
  const { projectDir, redaxoVersion, layout, verbose } = config;

  // Belt-and-braces idempotency guard: if the layout-specific console binary
  // already exists, Redaxo is already on disk — skip.
  if (await pathExists(path.join(projectDir, consolePathFor(layout)))) {
    return;
  }

  const tmpDir = path.join(projectDir, "tmp");
  const zipFile = path.join(tmpDir, `redaxo_${redaxoVersion}.zip`);
  const url = `https://github.com/redaxo/redaxo/releases/download/${redaxoVersion}/redaxo_${redaxoVersion}.zip`;

  await fs.mkdir(tmpDir, { recursive: true });

  if (layout === "modern") {
    await downloadAndReorganizeModern(projectDir, tmpDir, zipFile, url, verbose);
  } else {
    await downloadClassic(projectDir, layout, tmpDir, zipFile, url, verbose);
  }

  await fs.rm(tmpDir, { recursive: true, force: true });
}

async function downloadAndReorganizeModern(
  projectDir: string,
  tmpDir: string,
  zipFile: string,
  url: string,
  verbose: boolean,
): Promise<void> {
  const publicDir = path.join(projectDir, "public");

  await exec("curl", ["-Ls", "-o", zipFile, url], { verbose });
  await exec("unzip", ["-oq", zipFile, "-d", publicDir], { verbose });

  const binDir = path.join(projectDir, "bin");
  const srcDir = path.join(projectDir, "src");
  const varDir = path.join(projectDir, "var");

  await fs.mkdir(srcDir, { recursive: true });
  await fs.mkdir(varDir, { recursive: true });

  await fs.rename(path.join(publicDir, "redaxo/bin"), binDir);
  await fs.rename(path.join(publicDir, "redaxo/cache"), path.join(varDir, "cache"));
  await fs.rename(path.join(publicDir, "redaxo/data"), path.join(varDir, "data"));
  await fs.rename(path.join(publicDir, "redaxo/src/addons"), path.join(srcDir, "addons"));
  await fs.rename(path.join(publicDir, "redaxo/src/core"), path.join(srcDir, "core"));

  const license = path.join(publicDir, "LICENSE.md");
  if (await pathExists(license)) {
    await fs.rename(license, path.join(projectDir, "LICENSE.md"));
  }
  await fs.rm(path.join(publicDir, "README.md"), { recursive: true, force: true });
  await fs.rm(path.join(publicDir, ".htaccess"), { recursive: true, force: true });

  await fs.rm(path.join(publicDir, "redaxo/bin"), { recursive: true, force: true });
  await fs.rm(path.join(publicDir, "redaxo/src"), { recursive: true, force: true });
  await fs.rm(path.join(publicDir, ".gitignore.example"), { recursive: true, force: true });

  // Copy custom Redaxo PHP files required for the modern (path_provider) layout.
  const redaxoTemplates = path.join(templatesDir, "redaxo");

  await fs.cp(path.join(redaxoTemplates, "console"), path.join(binDir, "console"), {
    recursive: true,
  });
  await fs.chmod(path.join(binDir, "console"), 0o755);
  await fs.cp(path.join(redaxoTemplates, "path_provider.php"), path.join(srcDir, "path_provider.php"), {
    recursive: true,
  });
  await fs.cp(path.join(redaxoTemplates, "index.frontend.php"), path.join(publicDir, "index.php"), {
    recursive: true,
  });
  await fs.mkdir(path.join(publicDir, "redaxo"), { recursive: true });
  await fs.cp(
    path.join(redaxoTemplates, "index.backend.php"),
    path.join(publicDir, "redaxo", "index.php"),
    { recursive: true },
  );
  await fs.cp(path.join(redaxoTemplates, "htaccess"), path.join(publicDir, ".htaccess"), {
    recursive: true,
  });
}

async function downloadClassic(
  projectDir: string,
  layout: ViterexConfig["layout"],
  tmpDir: string,
  zipFile: string,
  url: string,
  verbose: boolean,
): Promise<void> {
  await exec("curl", ["-Ls", "-o", zipFile, url], { verbose });
  // Classic: unzip directly into the project root. The Redaxo zip already
  // contains the `redaxo/` subdirectory and a top-level index.php / .htaccess
  // — that's exactly the classic layout.
  await exec("unzip", ["-oq", zipFile, "-d", projectDir], { verbose });

  const license = path.join(projectDir, "LICENSE.md");
  if (await pathExists(license)) {
    // already at root; leave as is
  }
  await fs.rm(path.join(projectDir, "README.md"), { recursive: true, force: true });
  await fs.rm(path.join(projectDir, ".gitignore.example"), { recursive: true, force: true });

  if (layout === "classic+theme") {
    await fs.mkdir(path.join(projectDir, "theme", "public"), { recursive: true });
    await fs.mkdir(path.join(projectDir, "theme", "private"), { recursive: true });
  }
}
