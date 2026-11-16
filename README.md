# ARENA

Liga de Hockey 5v5 simulada como transmisión deportiva: jugadores, calendario por días de competencia, eventos en vivo, apuestas con créditos, mercado, draft y prensa.

- Frontend: React + Vite + TypeScript + Tailwind + Framer Motion + Recharts.
- Backend: Supabase (Postgres, Auth, Realtime, Edge Functions, pg_cron).
- Motor de simulación compartido: `shared/engine` (lo usan el servidor y las pruebas).

## Estructura

```
shared/engine     Motor de simulación (fórmula original + jugadores, estilos, sesgos)
shared/data       Datos iniciales: 54 equipos, generador de 1,080 jugadores, competiciones, ajustes
src/              Aplicación web (espectador y panel de administrador)
supabase/         Migraciones SQL, seed generado y Edge Functions
scripts/          Generación del seed, importación del historial, alta del administrador
tests/            Pruebas del motor (vitest) y de permisos (SQL)
docs/             Decisiones tomadas (sección 19)
```

## Desarrollo

```bash
npm install
npm run dev        # sin .env.local arranca en modo demostración con los datos iniciales
npm test           # pruebas del motor y del importador
npm run seed       # regenera supabase/seed.sql
```

Pruebas de base de datos (migraciones + seed + RLS) en un Postgres local:

```bash
PGHOST=/tmp PGPORT=5499 PGUSER=postgres scripts/test-db.sh
```

## Puesta en marcha con Supabase

1. Crear un proyecto en Supabase y copiar `.env.example` a `.env.local` con la URL y la anon key.
2. Aplicar `supabase/migrations/*.sql` y luego `supabase/seed.sql` (con la CLI: `supabase db push` y `psql -f supabase/seed.sql`).
3. Desplegar las Edge Functions: `supabase functions deploy admin-users`.
4. Crear el administrador: `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/create-admin.ts correo "Nombre"`.
5. Importar el historial: `npx tsx scripts/import-legacy.ts export.md` y cargar `supabase/legacy.sql`.

## Funciones de servidor

- `engine`: temporada, planificador, días de competencia (lo llama `pg_cron` cada minuto), apuestas, mercado, draft, cierre y prensa.
- `admin-users`: alta de usuarios con código, cambio de rol o club, silenciar en el chat.

Secreto opcional: `ANTHROPIC_API_KEY` para que la prensa la escriba Claude (sin él se usan plantillas).

## Producción

El frontend se publica en Vercel (`vercel deploy --prod`). Las decisiones y supuestos están en `docs/DECISIONES.md` y la guía para el dueño en `docs/INSTALACION.md`.

El nombre de la app es provisional y vive en `shared/config.ts` (`APP_NAME`).
