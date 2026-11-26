#!/usr/bin/env bash
# Isolated regression checks. Fake values only; no network or services.
set -euo pipefail
hook=$(cd "$(dirname "$0")" && pwd)/pre-commit
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
passed=0

check() {
  local label=$1 expected=$2 path=$3 body=$4 remove_worktree=${5:-false}
  local dir="$root/case-$passed"
  mkdir -p "$dir"; git -C "$dir" init -q
  (cd "$dir"; mkdir -p "$(dirname "$path")"; printf '%s\n' "$body" > "$path"; git add -f -- "$path")
  if [ "$remove_worktree" = true ]; then rm -- "$dir/$path"; fi
  local status=0
  (cd "$dir"; bash "$hook") > "$root/output" 2>&1 || status=$?
  if { [ "$expected" = allow ] && [ "$status" -ne 0 ]; } || { [ "$expected" = block ] && [ "$status" -eq 0 ]; }; then
    printf 'FAIL: %s (expected %s, exit %s)\n' "$label" "$expected" "$status" >&2
    exit 1
  fi
  passed=$((passed + 1)); printf 'PASS: %s\n' "$label"
}

check 'empty root example allowed' allow .env.example $'DATABASE_URL="file:./dev.db"\nEMILY_API_TOKEN=\nGOOGLE_API_KEY='
check 'ordinary source allowed' allow src/example.ts 'export const value = 1;'
for path in .env .env.local .env.production .env.production.local .env.backup-old nested/.env nested/.env.example nested/.env.staging; do
  check "environment path $path blocked" block "$path" 'EMPTY='
done
for path in data.db data.db-wal data.db-shm data.db.backup-old data.sqlite data.sqlite3 data.sqlite3-journal; do
  check "database path $path blocked" block "$path" 'synthetic data'
done
# Construct test markers at runtime so this test does not itself resemble a key.
fake=$(printf 'fixture_%040d' 0)
check 'Emily assignment blocked' block notes.txt "EMILY_API_TOKEN=$fake"
check 'exported/spaced assignment blocked' block notes.txt "export GOOGLE_API_KEY = '$fake'"
check 'populated root template blocked' block .env.example "EMILY_API_TOKEN=$fake"
check 'staged file removed from worktree still scanned' block notes.txt "EMILY_API_TOKEN=$fake" true
check 'path with whitespace scanned' block 'notes with spaces.txt' "EMILY_API_TOKEN=$fake"
check 'path with newline scanned' block $'notes\nwith-newline.txt' "EMILY_API_TOKEN=$fake"
check 'OAuth token blocked' block notes.txt "v^1.1#i^1#$(printf 'A%.0s' {1..80})"
check 'password hash blocked' block notes.txt "scrypt:16384:8:1:$(printf 'A%.0s' {1..20}):placeholder"
check 'application key blocked' block notes.txt "PRD-$(printf 'f%.0s' {1..16})"
check 'synthetic application marker allowed' allow notes.txt 'PRD-a1b2c3d4e5f6-example'

# Binary blobs (screenshots): NUL bytes must not make bash warn, and a
# credential inside binary content is still found.
binary_check() {
  local label=$1 expected=$2 payload=$3
  local dir="$root/case-$passed"
  mkdir -p "$dir"; git -C "$dir" init -q
  (cd "$dir"; printf '\x89PNG\r\n\x1a\n\x00\x00%s\x00\x00' "$payload" > shot.png; git add -f shot.png)
  local status=0
  (cd "$dir"; bash "$hook") > "$root/output" 2>&1 || status=$?
  if { [ "$expected" = allow ] && [ "$status" -ne 0 ]; } || { [ "$expected" = block ] && [ "$status" -eq 0 ]; } \
     || grep -q 'null byte' "$root/output"; then
    printf 'FAIL: %s (expected %s, exit %s)\n' "$label" "$expected" "$status" >&2
    cat "$root/output" >&2
    exit 1
  fi
  passed=$((passed + 1)); printf 'PASS: %s\n' "$label"
}
binary_check 'binary file allowed without NUL warnings' allow 'IHDR plain pixels'
binary_check 'credential inside binary file blocked' block "EMILY_API_TOKEN=$fake"
printf 'All %s pre-commit regression checks passed.\n' "$passed"
