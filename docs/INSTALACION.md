# Instalar ARENA en Supabase (sin token)

Se hace una vez, desde una computadora. Tiempo: unos 10 minutos.

## 1. Base de datos completa
1. Abre en GitHub el archivo `supabase/setup/arena-instalacion.sql` del repo `arena` y pulsa **Raw**.
2. Selecciona todo (Ctrl+A / Cmd+A) y cópialo.
3. En Supabase: tu proyecto → **SQL Editor** → **New query** → pega → **Run**.
4. Debe terminar sin errores. Comprueba con:
   ```sql
   select (select count(*) from teams) equipos, (select count(*) from players) jugadores,
          (select count(*) from legacy_editions) historial;
   ```
   Resultado esperado: 54 · 1080 · 171.

## 2. Tu cuenta de administrador
1. Supabase → **Authentication** → **Users** → **Add user** → **Create new user**: tu correo, una contraseña fuerte y marca **Auto Confirm User**.
2. SQL Editor → pega `supabase/setup/crear-admin.sql`, cambia `TU_CORREO` por ese correo → **Run**.
3. La primera vez que entres al panel te pedirá escanear un código QR con una app autenticadora.

## 3. Función del servidor para crear códigos de usuarios
1. Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Nombre: `admin-users`.
3. Borra el código de ejemplo, pega `supabase/setup/admin-users-un-archivo.ts` y pulsa **Deploy**.

## 4. Datos para la app
Supabase → **Project Settings** → **API**: copia el **Project URL** y la **anon public key**. Esos dos no son secretos y se ponen en `.env.local` (o en el hosting) como `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.

Nunca compartas la *service_role key* ni la contraseña de la base de datos.
