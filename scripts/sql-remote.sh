#!/usr/bin/env bash
# Ejecuta un archivo SQL en el proyecto de Supabase con la Management API.
# Uso: SUPABASE_REF=xxxx scripts/sql-remote.sh archivo.sql
set -euo pipefail
REF=${SUPABASE_REF:?Falta SUPABASE_REF}
python3 -c "import json,sys; print(json.dumps({'query': open(sys.argv[1]).read()}))" "$1" | \
  curl -sS -m 300 -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN:-proxy-injected}" -H "Content-Type: application/json" --data-binary @- -w "\n%{http_code}\n"
