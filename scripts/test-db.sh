#!/usr/bin/env bash
# Prueba las migraciones, el seed y las políticas RLS en un Postgres local.
# Uso: PGHOST=/tmp PGPORT=5499 PGUSER=postgres scripts/test-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${TEST_DB:-arena_test}
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
P="psql -q -v ON_ERROR_STOP=1 -d $DB"
$P -f tests/sql/supabase_stub.sql
for f in supabase/migrations/*.sql; do $P -f "$f"; done
$P -f supabase/seed.sql
OUT=$($P -tA -f tests/sql/rls.test.sql)
grep -q "^RLS OK$" <<<"$OUT" || { echo "$OUT"; exit 1; }
echo "OK: migraciones, seed y RLS"
