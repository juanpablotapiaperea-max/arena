#!/usr/bin/env bash
# Empaqueta las Edge Functions en un archivo cada una y las despliega con la
# Management API de Supabase (el token lo inyecta el entorno; nunca va en el repo).
# Uso: SUPABASE_REF=xxxx scripts/deploy-functions.sh [engine|admin-users]
set -euo pipefail
cd "$(dirname "$0")/.."
REF=${SUPABASE_REF:?Falta SUPABASE_REF}
OUT=supabase/.build
mkdir -p "$OUT"
for fn in ${@:-engine admin-users}; do
  npx esbuild "supabase/functions/$fn/index.ts" --bundle --format=esm --platform=neutral --target=es2022 \
    --external:'npm:*' --outfile="$OUT/$fn.js" --log-level=warning
  curl -sS -m 300 -o "$OUT/$fn.deploy.json" -w "$fn: %{http_code}\n" -X POST \
    "https://api.supabase.com/v1/projects/$REF/functions/deploy?slug=$fn" \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN:-proxy-injected}" \
    -F "metadata={\"entrypoint_path\":\"index.js\",\"name\":\"$fn\",\"verify_jwt\":false};type=application/json" \
    -F "file=@$OUT/$fn.js;filename=index.js;type=application/javascript"
done
