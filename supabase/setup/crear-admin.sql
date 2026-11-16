-- Paso 2 de la instalación: convertir tu usuario en administrador.
-- Antes: Supabase → Authentication → Users → Add user → Create new user
--        (tu correo, una contraseña fuerte, marca "Auto Confirm User").
-- Luego cambia TU_CORREO abajo por ese mismo correo y pulsa Run.
insert into profiles (id, display_name, login_slug, role, credits)
select id, 'Administrador', 'admin.' || left(id::text, 8), 'admin', 0
from auth.users
where email = lower('TU_CORREO')
on conflict (id) do update set role = 'admin';

select display_name, role from profiles where role = 'admin';
