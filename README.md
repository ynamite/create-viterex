# create-viterex

CLI tool to scaffold a **ViteRex** project — [Redaxo CMS](https://redaxo.org/) + [Vite](https://vitejs.dev/) + [Tailwind CSS](https://tailwindcss.com/) — *or* augment an existing Redaxo install with viterex_addon, ydeploy, and Deployer PHP.

[Viterex-installer-short.webm](https://github.com/user-attachments/assets/09684bb5-2402-4640-8437-08918cc13b44)

## Quick start

```bash
# Fresh install in a new directory
npx create-viterex my-project

# Augment the current directory (auto-detects existing Redaxo)
cd ~/path/to/existing/redaxo
npx create-viterex .
```

The CLI inspects the target directory and switches between two modes:

- **Fresh install** — empty target. Prompts for Redaxo version, admin credentials, DB credentials, layout, and addon extras. Downloads Redaxo, runs `setup:run`, installs the baseline, then preset extras.
- **Augment** — existing Redaxo detected. Skips Redaxo download / setup. Prompts for which baseline addons to add on top of the existing install. Already-activated addons are pre-disabled.

## Layouts

Three directory layouts are supported:

| Layout         | Console binary           | Backend entry           | Frontend entry      | Detection signal                               |
| -------------- | ------------------------ | ----------------------- | ------------------- | ---------------------------------------------- |
| `modern`       | `bin/console`            | `public/redaxo/index.php` | `public/index.php`  | `bin/console` AND `src/path_provider.php`      |
| `classic`      | `redaxo/bin/console`     | `redaxo/index.php`      | `index.php`         | `redaxo/bin/console`, no `src/path_provider.php` |
| `classic+theme` | `redaxo/bin/console`    | `redaxo/index.php`      | `index.php`         | classic + `theme/` directory at root           |

Modern is the recommended layout for new projects. Pass `--layout modern|classic|classic+theme` to bypass the prompt for fresh installs. Augment mode uses whichever layout it detects.

## Always-included baseline

These addons are installed in this order regardless of preset choice (preset addons are merged on top, deduped). `viterex` is the last entry so downstream addons that subscribe to its `VITEREX_INSTALL_STUBS` extension point see it as available when they activate.

| Order | Addon         | Source                                  |
| ----- | ------------- | --------------------------------------- |
| 1     | `structure` (with `history` plugin) | redaxo.org installer |
| 2     | `phpmailer`   | redaxo.org installer                    |
| 3     | `developer`   | redaxo.org installer                    |
| 4     | `yrewrite`    | redaxo.org installer                    |
| 5     | `ydeploy`     | redaxo.org installer                    |
| 6     | `viterex`     | redaxo.org installer (`install:download viterex`) |

Plus Deployer PHP is installed via Composer to `.tools/` (the project's `composer.json` is patched with `"config": { "vendor-dir": ".tools" }`).

## Usage

```
create-viterex [project-name] [options]
```

### Options

> **`--preset` vs `--config`?** A **preset** is a starting point — it pre-fills addon selection, layout, seed SQL, template files, and any installer value it declares (DB, admin email, package manager, …), skipping those prompts; you only answer what the preset leaves out (e.g. project name, and — by design — the admin password). A **config file** (the JSON written by `--generate-config`) pins *every* answer; passing `--config` skips all prompts entirely. Use `--preset` interactively, `--config` for CI.

| Flag                 | Description                                                          | Default          |
| -------------------- | -------------------------------------------------------------------- | ---------------- |
| `--skip-db`          | Skip database creation (assume pre-populated empty DB at credentials) | `false`          |
| `--skip-addons`      | Skip addon installation                                              | `false`          |
| `--skip-git`         | Don't initialize a git repo                                          | `false`          |
| `--pm <manager>`     | Package manager for JS deps: `bun` \| `pnpm` \| `yarn` \| `npm`      | `bun` if installed, else `pnpm` |
| `--preset <name>`    | Built-in id (`default`, `custom`) or path to a preset directory or `preset.json` | prompted |
| `--config <path>`    | Path to a previously-generated `viterex.json` (or directory containing one); skips all prompts | — |
| `--resume`           | Resume a previously failed run, skipping completed tasks             | `false`          |
| `--dry-run`          | Log each task without executing anything                             | `false`          |
| `--verbose`          | Pipe task stdout/stderr to the terminal                              | `false`          |
| `--layout <m|c|ct>`  | Directory layout: `modern` (ydeploy, recommended), `classic` (Redaxo defaults), `classic+theme` (FriendsOfREDAXO/theme) | prompt (modern) |
| `--fresh`            | Force fresh-install pipeline even when an existing Redaxo is detected | `false`          |
| `--force-push`       | Allow `git push --force` when the remote already has commits         | `false`          |
| `--with-tower`       | macOS only. Bypass the prompt and force-open Tower after a successful run. Skipped when the preset sets `withTower: false`. | prompted on macOS when `gittower` is on PATH |
| `--lang <locale>`    | Redaxo language (e.g. `de_de`, `en_gb`)                              | `de_de`          |
| `--timezone <tz>`    | Redaxo timezone (e.g. `Europe/Berlin`, `UTC`)                        | system tz        |
| `--generate-config [path]` | Run prompts and write the resulting config JSON to `<path>` (default: `viterex.json`), then exit. Useful for CI. | —                |
| `--force`            | Allow `--generate-config` to overwrite an existing file              | `false`          |
| `-V, --version`      | Print version                                                        | —                |
| `-h, --help`         | Show help                                                            | —                |

### `--resume`

If a task fails mid-run, fix the issue and resume. State is tracked in `.viterex-state.json` inside the project directory. The state file is kept after a successful run and excluded from the repo via `.gitignore` — unless you pass `--skip-git` — (it contains your DB and admin passwords). Re-running `npx create-viterex <project-name>` on an existing project detects it and offers to reuse the saved answers for a full re-run — no re-entering setup values. Flags like `--preset` or `--layout` don't block the offer as long as they match the saved values; `--fresh` or a differing flag prompts from scratch.

```bash
npx create-viterex my-site --resume
# or, when only a config file is available:
npx create-viterex --resume --config viterex.json
```

The config file's `projectDir` field provides the resume target when no positional project name is given.

> Note: paths inside the installer package (preset directory, preset files, seed SQL, deployer extras, installer config) are resolved fresh on each resume rather than read from the state file. This makes `--resume` portable across `npx` invocations even when the npx cache hash changes between runs, and as a side benefit picks up preset-side edits to `seed.sql.tpl` / `files/` that landed between runs.

## Config JSON schema

```jsonc
{
  // Project
  "projectName": "my-site",
  "projectDir": "/absolute/path/to/my-site",
  "layout": "modern",                // "modern" | "classic" | "classic+theme"
  "installMode": "fresh",            // "fresh" | "augment"

  // Redaxo
  "redaxoVersion": "5.20.2",
  "redaxoAdminUser": "admin",
  "redaxoAdminPassword": "secret",
  "redaxoAdminEmail": "admin@example.com",
  "redaxoErrorEmail": "errors@example.com",
  "redaxoServerName": "my-site.test",
  "redaxoLang": "de_de",
  "redaxoTimezone": "Europe/Berlin",

  // Database
  "skipDb": false,
  "dbHost": "127.0.0.1",
  "dbPort": 3306,
  "dbName": "my_site",
  "dbUser": "root",
  "dbPassword": "",

  // Addons
  "skipAddons": false,
  "addons": [
    { "key": "structure", "install": true, "activate": true, "plugins": ["history"] },
    { "key": "phpmailer", "install": true, "activate": true },
    { "key": "developer", "install": true, "activate": true },
    { "key": "yform", "install": true, "activate": true },
    { "key": "yrewrite", "install": true, "activate": true },
    { "key": "ydeploy", "install": true, "activate": true },
    { "key": "viterex_addon", "install": true, "activate": true },
    { "key": "ui_tools", "install": true, "activate": true, "plugins": ["jquery-minicolors", "selectize"] }
  ],

  // Frontend
  "packageManager": "pnpm",          // "bun" | "yarn" | "npm" | "pnpm"

  // Preset
  "preset": "default",
  "templateReplacements": {          // {{TOKEN}} -> value in scaffolded files
    "MASSIF_FIRMA": "My Company",
    "MASSIF_EMAIL": "info@example.com"
  },

  // Submodule addons (preset extras only — viterex_addon is no longer a submodule)
  "submoduleAddons": [
    { "url": "git@github.com:org/redaxo_massif.git", "path": "src/addons/massif", "packageKey": "massif" },
    // optional: "branch" tracks a branch instead of the default HEAD (e.g. an open PR's head branch),
    //           "hasComposerDeps" runs composer install inside the submodule
    { "url": "git@github.com:FriendsOfREDAXO/navbuilder.git", "path": "src/addons/navbuilder", "packageKey": "navbuilder", "branch": "v2" }
  ],

  // Preset extension (optional — typically set by a preset, not by hand)
  "installerConfig": "/abs/path/to/redaxo_installer_config.json",
  "deployerExtras": ["/abs/path/to/extra1.php"],

  // Or supply REDAXO Installer credentials directly (used only when installerConfig is unset)
  "installerApiLogin": "your-login",
  "installerApiKey":   "your-api-key",

  // Deployment
  "setupDeploy": false,

  // Git
  "skipGit": false,
  "gitProvider": "github.com",       // "github.com" | "gitlab.com" | ""
  "gitNamespace": "my-org",
  "gitRepoName": "my-site",

  // Runtime (CLI flags override these)
  "verbose": false
}
```

> **Heads-up:** `installerApiKey` and any preset-supplied `redaxo_installer_config.json` are stored in plaintext on disk. Don't commit a generated `viterex.json` containing real credentials to a public repo.

### Addon entry format

| Field      | Type       | Description                                                |
| ---------- | ---------- | ---------------------------------------------------------- |
| `key`      | `string`   | Redaxo addon key (e.g. `"yrewrite"`)                       |
| `install`  | `boolean`  | Download + install                                         |
| `activate` | `boolean`  | Activate after install                                     |
| `plugins`  | `string[]` | Optional list of plugin keys (e.g. `["history"]`)          |
| `version`  | `string?`  | Optional version pin for `install:download`                |

Plugin keys use slash notation internally: addon `structure` with plugin `history` becomes `structure/history`.

### Template replacements

Custom prompts defined in a preset's `customPrompts` array populate the `templateReplacements` map. Tokens of the form `{{KEY}}` in any template file (including the seed SQL) are replaced at scaffold time.

### Git remote format

| Field          | Type     | Description                                             |
| -------------- | -------- | ------------------------------------------------------- |
| `gitProvider`  | `string` | `"github.com"` or `"gitlab.com"` (empty string to skip) |
| `gitNamespace` | `string` | Organization or username                                |
| `gitRepoName`  | `string` | Repository name                                         |

## Preset extension

Presets can supply personal/site-specific files **and pre-fill any installer prompt** — when the preset sets a value, that prompt is skipped (see _Installer values_ below).

| Preset field      | Type                                          | Effect at scaffold time                                                                                                                          |
| ----------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `installerConfig` | `string`                                      | Path (relative to the preset directory) to a `redaxo_installer_config.json`. Copied to `<dataDir>/addons/install/config.json`.                   |
| `deployerExtras`  | `string[]`                                    | List of `.php` paths (relative to the preset directory). Each file is copied to the project root, `require`'d in `deploy.php`, and added to its `clear_paths`. |
| `filesDir`        | `string`                                      | Optional; defaults to `"files"`. Directory whose contents are merged into `projectDir`: folders walked recursively, files overwritten by the preset version. A `package-deps.json` inside is merged into the project `package.json` (additive, higher-version-wins), and a top-level `.gitignore` is append-merged into the project `.gitignore` — both instead of being copied. |
| `layout`          | `"modern" \| "classic" \| "classic+theme"`    | Optional. When set AND a `files/` directory exists, the installer validates the user's chosen layout matches; aborts before any file is copied if not. When set, the layout prompt is skipped (the preset's value is used unless `--layout` overrides). |
| `withTower`       | `boolean`                                     | Optional. When set (`true`/`false`), replaces the "Add the repo to Git Tower?" prompt. macOS-only feature; `true` still requires `gittower` on PATH and a local git repo. |

**Installer values (skip prompts):**

Beyond the file/path fields above, a preset may set **any** scalar installer field, in which case its prompt is skipped (a one-line `Using values from preset '<name>': …` summary is logged). Supported fields: `redaxoVersion`, `redaxoServerName`, `redaxoAdminUser`, `redaxoAdminPassword`, `redaxoAdminEmail`, `redaxoErrorEmail`, `redaxoLang`, `redaxoTimezone`; `skipDb`, `dbHost`, `dbPort`, `dbName`, `dbUser`, `dbPassword`; `packageManager`, `setupDeploy`; `skipGit`, `gitProvider`, `gitNamespace`, `gitRepoName`; `verbose`, `forcePush`. Precedence is **CLI flag > preset value > prompt/default**. Notes:

- **Git remote** resolves per field: an empty `gitProvider` (`""`) means **explicitly no remote**; a non-empty `gitProvider` configures a remote (skipping the "create a remote?" + provider prompts) — `gitNamespace` is taken from the preset when set (else prompted), and `gitRepoName` is **always prompted** (default: project name) unless the preset pins it. Omitting `gitProvider` entirely runs the normal opt-in remote flow.
- `dbName` stays prompted (default: slugified project name) **unless** the preset sets it — it's per-project.
- `redaxoAdminPassword` in a preset is **discouraged** (a password in a committed file is a security smell). When present it must satisfy Redaxo's 8–4096-char rule, else it's ignored with a warning and you're prompted. Omit it to always be prompted.
- `--config <path>` is unaffected — it loads a full config and skips all prompts regardless.

**Precedence (installer config):**

1. **Preset wins.** If the preset declares `installerConfig`, the installer copies that file and skips the prompt entirely.
2. **Otherwise prompt.** Fresh installs ask `Configure REDAXO Installer API credentials? (no/yes)` (default: no). Confirming asks for username + API key, then writes a fresh `config.json` from the answers.
3. **Skip.** If the user declines, no installer config is installed.

**`deployerExtras`:**

The default `templates/deploy/deploy.php.tpl` exposes two placeholders — `{{DEPLOYER_EXTRAS}}` (immediately after the standard `require`s) and `{{DEPLOYER_EXTRAS_CLEAR_PATHS}}` (inside the `add('clear_paths', [...])` array). Each entry in `deployerExtras` produces one `require __DIR__ . '/<basename>';` line and one `'<basename>',` clear_paths entry. Empty when no extras are declared.

**`filesDir` / `layout`:**

A preset may ship arbitrary content (asset starters, sample workflow files, custom config, etc.) by adding a `files/` directory next to its `preset.json`. The directory is merged into the user's project root: folder structure is walked recursively (siblings outside the preset's tree are preserved), and individual files that exist on both sides are overwritten by the preset version. This means a preset's authoritative content (e.g. an updated `.env.example`) lands on every install — including re-runs — instead of silently going stale. Any user-customized files that should NOT be reset on re-run should live outside the preset's `files/` tree.

The `files/` directory is **layout-locked**: its internal structure mirrors the project tree as the preset author intends it to land on disk. Authors are expected to declare which layout the preset targets via the `layout` field; the installer validates the user's choice and skips the layout prompt accordingly. CLI `--layout` overrides the preset's declared layout, in which case the apply-preset-files task aborts with a clear error before any file is copied.

Two filenames are special and **merged** rather than copied verbatim:

- A `package-deps.json` placed anywhere in `files/` is merged into the project's `package.json` (additive — existing dependencies are kept; on a version conflict the higher constraint wins) rather than copied. This lets a preset add npm dependencies on top of viterex_addon's stub `package.json` without clobbering it. The merge runs before the package-manager install, so the added dependencies are installed in the same run.
- A **top-level** `.gitignore` (i.e. `files/.gitignore`) has its patterns append-merged into the project's `.gitignore` — which `viterex_addon` owns and seeds (it ships `stubs/.gitignore.example` and merges it during `viterex:install-stubs`). Only the missing patterns are appended, under an `# Added by preset '<name>'` header (idempotent), so the preset extends the baseline instead of overwriting it. **Nested** per-directory `.gitignore` files (e.g. `files/public/uploads/.gitignore`) copy normally. For ignores that should apply to _every_ project rather than one preset, add them to `viterex_addon`'s `stubs/.gitignore.example` instead.

Example preset slice:

```json
{
  "name": "my-preset",
  "installerConfig": "redaxo_installer_config.json",
  "deployerExtras": ["deployer.task.release.acme.php"],
  "layout": "modern"
}
```

```
presets/my-preset/
├── preset.json
├── redaxo_installer_config.json
├── deployer.task.release.acme.php
└── files/
    ├── .env.example
    ├── package-deps.json
    └── src/assets/img/logo.svg
```

After install, `.env.example` lands at `<projectDir>/.env.example`, the logo at `<projectDir>/src/assets/img/logo.svg`, and `package-deps.json`'s entries are merged into the project `package.json`. Choose `--layout classic` and the install aborts before any file in `files/` is touched.

## Pipeline

```
 1  Configure composer (.tools/, deployer)   — both modes
 2  Download Redaxo                          — skip when augment
 3  Install Redaxo                           — skip when augment OR setup already complete
 4  Install addons                           — both modes (idempotent); ALWAYS_INCLUDED + extras
 5  Install viterex stubs                    — `php bin/console viterex:install-stubs`; requires viterex_addon ≥ 3.2.0
 6  Scaffold frontend (Vite, configs)        — both modes
 7  Apply preset files                       — copy preset's files/ into projectDir, merging folders and overwriting individual files; skip when no presetFilesDir
 8  Seed database                             — skip when augment OR --skip-db OR no seedFile
 9  Install dependencies (composer + pm)      — both modes; runs AFTER step 7 so preset files and deps land before install
10  Initialize git repo                       — git init only (early; `git submodule add` needs .git); skip if .git/ exists or --skip-git
11  Add submodule addons (preset extras)      — runs AFTER deps; skip if --skip-git or none
12  Activate submodule addons                 — composer install + package:install/activate
13  Sync developer + clear cache              — `developer:sync` (gated on the developer addon; non-fatal) → `cache:clear`
14  Build frontend                            — refresh browserslist DB + `<pm> run build`; skip if no `package.json`; both steps non-fatal (warn + continue)
15  Git initial commit                        — the LAST file-touching task, so `git status` is clean afterward; skip if HEAD exists or --skip-git
16  Create remote git repository              — push (needs the commit); skip if no provider or --skip-git
17  Open frontend and backend in browser      — both
18  Show next steps                           — print the `<pm> run dev` instruction (display only)
```

Each task is idempotent — re-running on a partially-set-up project converges instead of erroring. Resume from a specific failure with `--resume`.

## Available addon extras

Baseline addons are installed regardless of preset choice (see Always-included baseline above). The interactive multiselect offers these extras on top — recommended ones are pre-checked:

| Addon                   | Description                                      |
| ----------------------- | ------------------------------------------------ |
| `yform`                 | Form builder                                     |
| `be_tools`              | Backend enhancements                             |
| `sprog`                 | i18n / variables                                 |
| `url`                   | Custom URL profiles                              |
| `adminer`               | DB management                                    |
| `bloecks`               | Block editor                                     |
| `focuspoint`            | Image focal point                                |
| `mblock`                | Repeatable fields                                |
| `mform`                 | Module form builder                              |
| `quick_navigation`      | Quick navigation                                 |
| `cropper`               | Image cropping                                   |
| `hyphenator`            | Auto-hyphenation                                 |
| `emailobfuscator`       | Email obfuscation                                |
| `structure_tweaks`      | Structure tweaks                                 |
| `cke5`                  | CKEditor 5                                       |
| `ui_tools`              | UI tools (plugins: jquery-minicolors, selectize) |
| `uploader`              | Media upload                                     |
| `useragent`             | Device detection                                 |
| `yform_adminer`         | YForm adminer                                    |
| `yform_spam_protection` | YForm spam protection                            |
| `yform_usability`       | YForm usability                                  |
| `media_negotiator`      | WebP/AVIF negotiation                            |
| `statistics`            | Statistics                                       |
| `be_password`           | Password policy                                  |
| `block_peek`            | Slice preview                                    |

## Prerequisites

- Node.js >= 18
- PHP (for Redaxo CLI commands)
- MySQL / MariaDB (unless `--skip-db` and you have an empty DB ready)
- Composer
- Git (unless `--skip-git`)

## Development

```bash
npm install
npm run build         # tsup -> dist/
node dist/index.js    # run locally
./scripts/test-run.sh # smoke tests (--dry-run scenarios)
```

## Releasing

Releases publish to npm via the `Release` GitHub Action (`.github/workflows/release.yml`), which fires on every `v*` tag. To cut a release:

1. Move items from `## [Unreleased]` in `CHANGELOG.md` into a new dated section: `## [X.Y.Z] - YYYY-MM-DD`.
2. Bump the version and create the tag:
   ```bash
   pnpm version patch                       # 3.0.1
   pnpm version minor                       # 3.1.0
   pnpm version major                       # 4.0.0
   pnpm version prerelease --preid=alpha    # 3.0.0-alpha.2
   ```
3. Push commits and tags:
   ```bash
   git push --follow-tags
   ```

The workflow verifies the tag matches `package.json`, builds, runs tests + smoke tests, publishes to npm with [provenance](https://docs.npmjs.com/generating-provenance-statements), and opens a GitHub Release. Pre-release versions (`-alpha.N`, `-beta.N`, `-rc.N`) publish under the `alpha` / `beta` / `next` dist-tags; stable versions go to `latest`.

Auth is handled via npm [Trusted Publishers](https://docs.npmjs.com/trusted-publishers) — no `NPM_TOKEN` secret required. One-time setup on npmjs.com: package page → Settings → Publishing access → "Add trusted publisher" → GitHub Actions, repository `ynamite/create-viterex`, workflow `release.yml`.

To validate the pipeline without shipping, run the workflow manually via Actions → Release → "Run workflow". Dispatch runs install/build/test/smoke-test and `npm publish --dry-run` against the current `package.json` version, but skip the real publish and GitHub Release.

## License

MIT
