#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="node $REPO_ROOT/dist/index.js"
TMPDIR_BASE="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_BASE"' EXIT

pass=0
fail=0

run_test() {
  local name="$1"
  shift
  echo "--- TEST: $name"
  if "$@" >/dev/null 2>&1; then
    echo "    PASS"
    pass=$((pass + 1))
  else
    echo "    FAIL (exit code $?)"
    fail=$((fail + 1))
  fi
}

assert_contains() {
  local label="$1"
  local output="$2"
  shift 2
  local all_found=true
  for needle in "$@"; do
    if echo "$output" | grep -q "$needle"; then
      echo "    Found: $needle"
    else
      echo "    MISSING: $needle"
      all_found=false
    fi
  done
  if $all_found; then
    echo "    PASS"
    pass=$((pass + 1))
  else
    echo "    FAIL"
    fail=$((fail + 1))
  fi
}

# Generate a fresh-modern config in $TMPDIR_BASE/$1.json with optional overrides
make_fresh_modern_config() {
  local label="$1"
  local out="$TMPDIR_BASE/$label.json"
  local project_dir="$TMPDIR_BASE/$label"
  mkdir -p "$project_dir"
  cat > "$out" <<JSON
{
  "projectName": "$label",
  "projectDir": "$project_dir",
  "layout": "modern",
  "installMode": "fresh",
  "redaxoVersion": "5.20.2",
  "redaxoAdminUser": "admin",
  "redaxoAdminPassword": "admin123",
  "redaxoAdminEmail": "admin@example.com",
  "redaxoErrorEmail": "error@example.com",
  "redaxoServerName": "$label.test",
  "redaxoLang": "de_de",
  "redaxoTimezone": "Europe/Berlin",
  "skipDb": false,
  "dbHost": "127.0.0.1",
  "dbPort": 3306,
  "dbName": "$(echo "$label" | tr - _)",
  "dbUser": "root",
  "dbPassword": "",
  "skipAddons": false,
  "addons": [
    { "key": "structure", "install": true, "activate": true, "plugins": ["history"] },
    { "key": "phpmailer", "install": true, "activate": true },
    { "key": "developer", "install": true, "activate": true },
    { "key": "yform", "install": true, "activate": true },
    { "key": "yrewrite", "install": true, "activate": true },
    { "key": "ydeploy", "install": true, "activate": true },
    { "key": "viterex_addon", "install": true, "activate": true }
  ],
  "packageManager": "npm",
  "preset": "default",
  "templateReplacements": {},
  "submoduleAddons": [],
  "setupDeploy": false,
  "skipGit": true,
  "gitProvider": "",
  "gitNamespace": "",
  "gitRepoName": "",
  "verbose": false
}
JSON
  echo "$out"
}

# ─── 1. --help and --version ──────────────────────────────────────────
run_test "--help flag" $CLI --help
run_test "--version flag" $CLI --version

# ─── 2. Fresh modern via --config + --dry-run ─────────────────────────
CONFIG_FRESH=$(make_fresh_modern_config fresh-modern)

echo "--- TEST: fresh modern --dry-run lists the pipeline tasks"
OUTPUT=$($CLI --config "$CONFIG_FRESH" --dry-run 2>&1)
assert_contains "fresh modern tasks" "$OUTPUT" \
  "Configure composer" \
  "Download Redaxo" \
  "Install Redaxo" \
  "Install addons" \
  "Scaffold frontend" \
  "Install dependencies" \
  "Add submodule addons" \
  "Open frontend and backend" \
  "Show next steps"

# ─── 3. Fresh classic ─────────────────────────────────────────────────
CONFIG_CLASSIC="$TMPDIR_BASE/fresh-classic.json"
make_fresh_modern_config fresh-classic > /dev/null
sed 's/"layout": "modern"/"layout": "classic"/' "$TMPDIR_BASE/fresh-classic.json" > "$CONFIG_CLASSIC.tmp" \
  && mv "$CONFIG_CLASSIC.tmp" "$CONFIG_CLASSIC"

run_test "fresh classic --dry-run" $CLI --config "$CONFIG_CLASSIC" --dry-run

# ─── 4. Augment of existing modern ────────────────────────────────────
AUGMENT_MODERN_DIR="$TMPDIR_BASE/augment-modern"
mkdir -p "$AUGMENT_MODERN_DIR/bin" "$AUGMENT_MODERN_DIR/src"
touch "$AUGMENT_MODERN_DIR/bin/console" "$AUGMENT_MODERN_DIR/src/path_provider.php"

CONFIG_AUGMENT_MODERN="$TMPDIR_BASE/augment-modern.json"
cat > "$CONFIG_AUGMENT_MODERN" <<JSON
{
  "projectName": "augment-modern",
  "projectDir": "$AUGMENT_MODERN_DIR",
  "layout": "modern",
  "installMode": "augment",
  "redaxoVersion": "5.20.2",
  "redaxoAdminUser": "admin",
  "redaxoAdminPassword": "",
  "redaxoAdminEmail": "admin@example.com",
  "redaxoErrorEmail": "error@example.com",
  "redaxoServerName": "augment-modern.test",
  "redaxoLang": "de_de",
  "redaxoTimezone": "Europe/Berlin",
  "skipDb": true,
  "dbHost": "127.0.0.1",
  "dbPort": 3306,
  "dbName": "augment_modern",
  "dbUser": "root",
  "dbPassword": "",
  "skipAddons": false,
  "addons": [
    { "key": "viterex_addon", "install": true, "activate": true }
  ],
  "packageManager": "npm",
  "preset": "custom",
  "templateReplacements": {},
  "submoduleAddons": [],
  "setupDeploy": false,
  "skipGit": true,
  "gitProvider": "",
  "gitNamespace": "",
  "gitRepoName": "",
  "verbose": false
}
JSON

echo "--- TEST: augment modern --dry-run skips Download/Install Redaxo + Seed database"
OUTPUT=$($CLI --config "$CONFIG_AUGMENT_MODERN" --dry-run 2>&1)
assert_contains "augment modern skips" "$OUTPUT" \
  "Would skip: Download Redaxo" \
  "Would skip: Install Redaxo" \
  "Would skip: Seed database" \
  "Would run: Configure composer" \
  "Would run: Install addons"

# ─── 5. Augment of existing classic ───────────────────────────────────
AUGMENT_CLASSIC_DIR="$TMPDIR_BASE/augment-classic"
mkdir -p "$AUGMENT_CLASSIC_DIR/redaxo/bin"
touch "$AUGMENT_CLASSIC_DIR/redaxo/bin/console"

CONFIG_AUGMENT_CLASSIC="$TMPDIR_BASE/augment-classic.json"
sed "s|augment-modern|augment-classic|g; s|\"layout\": \"modern\"|\"layout\": \"classic\"|" "$CONFIG_AUGMENT_MODERN" \
  > "$CONFIG_AUGMENT_CLASSIC"

run_test "augment classic --dry-run" $CLI --config "$CONFIG_AUGMENT_CLASSIC" --dry-run

# ─── 6. --resume requires positional name OR --config with projectDir ─
RESUME_CONFIG="$TMPDIR_BASE/resume-test.json"
RESUME_DIR="$TMPDIR_BASE/resume-test"
mkdir -p "$RESUME_DIR"
make_fresh_modern_config resume-test > /dev/null

# Write a state file simulating one completed task
cat > "$RESUME_DIR/.viterex-state.json" <<JSON
{
  "config": $(cat "$RESUME_CONFIG"),
  "completedTasks": ["Configure composer (.tools/, deployer)"]
}
JSON

echo "--- TEST: --resume + --config (no positional name)"
OUTPUT=$($CLI --config "$RESUME_CONFIG" --resume --dry-run 2>&1 || true)
if echo "$OUTPUT" | grep -q "Resuming from state file"; then
  echo "    PASS"
  pass=$((pass + 1))
else
  echo "    FAIL - expected 'Resuming from state file' in output"
  echo "$OUTPUT" | tail -10
  fail=$((fail + 1))
fi

# ─── 7. Old preset filtering: viterex_addon submodule entry stripped ──
LEGACY_PRESET_DIR="$TMPDIR_BASE/legacy-preset"
mkdir -p "$LEGACY_PRESET_DIR"
cat > "$LEGACY_PRESET_DIR/preset.json" <<JSON
{
  "name": "legacy",
  "description": "Old preset that still lists viterex_addon as a submodule",
  "addons": [],
  "submoduleAddons": [
    { "url": "git@github.com:ynamite/viterex_addon.git", "path": "src/addons/viterex_addon", "packageKey": "viterex_addon", "hasComposerDeps": true }
  ]
}
JSON

# Build a config that uses preset by path (fall through to loadPreset filter)
LEGACY_CONFIG=$(make_fresh_modern_config legacy-preset)
# Force preset to the legacy path
node -e "
const fs = require('fs');
const c = JSON.parse(fs.readFileSync('$LEGACY_CONFIG'));
c.preset = '$LEGACY_PRESET_DIR/preset.json';
c.submoduleAddons = [{ url: 'git@github.com:ynamite/viterex_addon.git', path: 'src/addons/viterex_addon', packageKey: 'viterex_addon' }];
fs.writeFileSync('$LEGACY_CONFIG', JSON.stringify(c, null, 2));
"
echo "--- TEST: legacy preset filters viterex submodule entry"
OUTPUT=$($CLI --config "$LEGACY_CONFIG" --dry-run 2>&1 || true)
# Note: when running with --config, the preset is not loaded (config is the source of truth).
# So this test is mainly that preset.ts's filter exists; rely on the build/unit test.
echo "    (covered by preset.ts unit assertion — skipping integration check)"

# ─── Summary ──────────────────────────────────────────────────────────
echo ""
echo "================================"
echo "  $pass passed, $fail failed"
echo "================================"

[ "$fail" -eq 0 ]
