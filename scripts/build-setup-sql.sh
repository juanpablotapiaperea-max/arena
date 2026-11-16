#!/usr/bin/env bash
# Junta migraciones, seed e historial en supabase/setup/arena-instalacion.sql
# para instalar todo pegándolo una vez en Supabase → SQL Editor.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=supabase/setup/arena-instalacion.sql
mkdir -p supabase/setup
{
  echo "-- ARENA · instalación completa en un solo archivo (pegar en Supabase → SQL Editor → Run)"
  echo "-- Generado por scripts/build-setup-sql.sh. Contiene: esquema, seguridad, atributos, equipos, jugadores e historial."
  for f in supabase/migrations/*.sql; do echo; echo "-- ═══ $f ═══"; cat "$f"; done
  echo; echo "-- ═══ supabase/seed.sql ═══"; cat supabase/seed.sql
  echo; echo "-- ═══ supabase/legacy.sql ═══"; cat supabase/legacy.sql
} > "$OUT"
echo "$OUT ($(wc -c < "$OUT") bytes)"
