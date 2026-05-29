import path from "node:path";
import { exec } from "../utils/exec.js";
import { consolePathFor, isSetupComplete } from "../utils/detect.js";
import type { ViterexConfig } from "../types.js";

/**
 * Thrown when Redaxo's setup:run rejects the admin password against its
 * built-in policy (8–4096 chars). The pipeline catches this specifically
 * to re-prompt for a longer password and retry the task.
 */
export class PasswordRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasswordRuleError";
  }
}

const PASSWORD_RULE_MARKER = "password does not match the required rules";

export async function installRedaxo(config: ViterexConfig): Promise<void> {
  const {
    projectDir,
    layout,
    redaxoServerName,
    redaxoAdminUser,
    redaxoAdminPassword,
    redaxoErrorEmail,
    redaxoLang,
    redaxoTimezone,
    skipDb,
    dbHost,
    dbUser,
    dbPassword,
    dbName,
    verbose,
  } = config;

  // Idempotency: skip when setup is already complete
  if (await isSetupComplete(projectDir, layout)) {
    return;
  }

  const consolePath = consolePathFor(layout);

  // On resume the DB may already exist with partial tables from a previous
  // failed run, which causes setup:run to abort. Back it up and drop it.
  // When skipDb is set the user is responsible for providing an empty DB
  // at the given credentials — we don't touch it.
  if (!skipDb) {
    const authArgs = [
      "-h",
      dbHost,
      "-u",
      dbUser,
      ...(dbPassword ? [`--password=${dbPassword}`] : []),
    ];

    const { stdout: dbExists } = await exec(
      "mysql",
      [...authArgs, "--skip-column-names", "-e", `SHOW DATABASES LIKE '${dbName}';`],
      { verbose },
    );

    // execa's stdout is a union (and undefined when inherited under --verbose);
    // coerce to a string before comparing.
    if (String(dbExists ?? "").trim() === dbName) {
      const backupFile = path.join(projectDir, `backup_${dbName}_${Date.now()}.sql`);
      await exec(
        "mysqldump",
        [...authArgs, "--databases", dbName, `--result-file=${backupFile}`],
        { verbose },
      );
      await exec("mysql", [...authArgs, "-e", `DROP DATABASE \`${dbName}\`;`], { verbose });
    }
  }

  const serverUrl = `http://${redaxoServerName}/`;

  try {
    await exec(
      "php",
      [
        consolePath,
        "setup:run",
        `--lang=${redaxoLang}`,
        "--agree-license",
        `--server=${serverUrl}`,
        `--servername=${config.projectName}`,
        `--error-email=${redaxoErrorEmail}`,
        `--timezone=${redaxoTimezone}`,
        `--db-host=${dbHost}`,
        `--db-login=${dbUser}`,
        `--db-password=${dbPassword}`,
        `--db-name=${dbName}`,
        "--db-setup=normal",
        `--db-createdb=${skipDb ? "no" : "yes"}`,
        "--db-charset=utf8mb4",
        `--admin-username=${redaxoAdminUser}`,
        `--admin-password=${config.redaxoAdminPassword}`,
        "--no-interaction",
        "--quiet",
      ],
      { cwd: projectDir, verbose },
    );
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    const haystack = `${e.stderr ?? ""}${e.stdout ?? ""}${e.message ?? ""}`;
    if (haystack.includes(PASSWORD_RULE_MARKER)) {
      throw new PasswordRuleError(
        "Redaxo rejected the admin password (rule: 8–4096 characters).",
      );
    }
    throw err;
  }
}
