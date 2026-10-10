#!/usr/bin/env bash
# Database tests (pgTAP). Builds a throwaway database from scratch, applies
# every numbered supabase/NN_*.sql file in order, then runs each
# supabase/tests/*.test.sql file and fails if any test fails.
#
# Needs: Postgres 14+ with the pgTAP extension installed, and psql.
# Connection comes from the usual libpq variables (PGHOST, PGPORT, PGUSER,
# PGPASSWORD); the user must be allowed to create databases. Nothing here
# touches the real Supabase project.
#
#   supabase/tests/run.sh                         # all tests
#   supabase/tests/run.sh auth_provisioning       # files whose name contains this
#   TEST_DB=my_db supabase/tests/run.sh           # pick the scratch db name
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sql_dir="$(cd "$here/.." && pwd)"
db="${TEST_DB:-teamup_test}"
filter="${1:-}"
# Hide NOTICE chatter (e.g. "trigger … does not exist, skipping").
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"

psql_admin() { psql -X -q -v ON_ERROR_STOP=1 -d postgres "$@"; }
psql_db()    { psql -X -q -v ON_ERROR_STOP=1 -d "$db" "$@"; }

echo "== Building $db"
psql_admin -c "drop database if exists \"$db\" with (force)" >/dev/null
psql_admin -c "create database \"$db\"" >/dev/null

load() {
  echo "   $(basename "$1")"
  psql_db -f "$1" >/dev/null
}

load "$here/harness/00_supabase_stub.sql"
load "$here/harness/01_baseline_schema.sql"
for f in "$sql_dir"/[0-9][0-9]_*.sql; do
  load "$f"
done
psql_db -c "create extension if not exists pgtap" >/dev/null
load "$here/harness/02_helpers.sql"

echo "== Running tests"
failed=0
ran=0
for t in "$here"/*.test.sql; do
  [[ -n "$filter" && "$(basename "$t")" != *"$filter"* ]] && continue
  ran=$((ran + 1))
  name="$(basename "$t")"
  if ! out="$(psql_db -t -A -f "$t" 2>&1)"; then
    echo "FAIL $name (SQL error)"
    echo "$out" | sed 's/^/     /'
    failed=$((failed + 1))
    continue
  fi
  # pgTAP prints "not ok" for a failed assertion, and "# Looks like…" when
  # the number of tests run doesn't match plan().
  if grep -qE '^not ok|^# Looks like' <<<"$out"; then
    echo "FAIL $name"
    echo "$out" | grep -vE '^ok ' | sed 's/^/     /'
    failed=$((failed + 1))
  else
    echo "ok   $name ($(grep -cE '^ok ' <<<"$out") tests)"
  fi
done

if [[ $ran -eq 0 ]]; then
  echo "No test files matched '${filter}'" >&2
  exit 1
fi
if [[ $failed -gt 0 ]]; then
  echo "== $failed of $ran test files failed"
  exit 1
fi
echo "== All $ran test files passed"
