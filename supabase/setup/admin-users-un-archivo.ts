// admin-users en un solo archivo, para pegar en Supabase → Edge Functions → Deploy a new function → Via Editor.
// Nombre de la función: admin-users. Generado a partir de supabase/functions/admin-users y _shared/admin.ts.

// Utilidades comunes de las Edge Functions (Deno).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

/** Cliente con la clave de servicio: solo existe en el servidor. */
function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
}

/** Verifica que quien llama es administrador con segundo factor (aal2). */
async function requireAdmin(req: Request): Promise<{ userId: string } | Response> {
  const auth = req.headers.get('Authorization');
  if (!auth) return json({ error: 'Sin sesión' }, 401);
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data, error } = await userClient.rpc('is_admin');
  if (error || data !== true) return json({ error: 'No autorizado' }, 403);
  const { data: u } = await userClient.auth.getUser();
  return { userId: u.user!.id };
}

/** Código de acceso: 8 caracteres sin letras ni números ambiguos. */
function newAccessCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

function loginSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '');
}

const USER_EMAIL_DOMAIN = 'usuarios.arena.app';

// Gestión de usuarios del administrador: crear códigos, regenerarlos, cambiar
// rol o club y silenciar en el chat. El código se guarda solo como hash
// (contraseña de Supabase Auth) y se muestra una única vez.

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;
  const db = serviceClient();

  const body = await req.json().catch(() => ({}));
  const log = (action: string, entityId: string, before: unknown, after: unknown) =>
    db.from('admin_log').insert({ actor: admin.userId, action, entity: 'profiles', entity_id: entityId, before, after });

  try {
    switch (body.action) {
      case 'create': {
        const name = String(body.name ?? '').trim();
        const role = body.role === 'owner' ? 'owner' : 'spectator';
        const slug = loginSlug(name);
        if (slug.length < 2) return json({ error: 'Nombre demasiado corto' }, 400);
        if (role === 'owner' && !body.clubTeamId) return json({ error: 'Un dueño necesita un club' }, 400);

        const { data: exists } = await db.from('profiles').select('id').eq('login_slug', slug).maybeSingle();
        if (exists) return json({ error: 'Ya existe un usuario con ese nombre' }, 409);

        const code = newAccessCode();
        const { data: created, error } = await db.auth.admin.createUser({
          email: `${slug}@${USER_EMAIL_DOMAIN}`,
          password: code,
          email_confirm: true,
          user_metadata: { display_name: name },
        });
        if (error) throw error;

        const { data: settings } = await db.from('settings').select('value').eq('key', 'betting').maybeSingle();
        const credits = Number(settings?.value?.initialCredits ?? 1000);
        const profile = {
          id: created.user.id,
          display_name: name,
          login_slug: slug,
          role,
          club_team_id: role === 'owner' ? body.clubTeamId : null,
          credits,
        };
        const { error: pErr } = await db.from('profiles').insert(profile);
        if (pErr) {
          await db.auth.admin.deleteUser(created.user.id);
          throw pErr;
        }
        await log('INSERT', created.user.id, null, profile);
        return json({ code });
      }

      case 'reset_code': {
        const code = newAccessCode();
        const { error } = await db.auth.admin.updateUserById(body.userId, { password: code });
        if (error) throw error;
        await log('custom', body.userId, null, { reset_code: true });
        return json({ code });
      }

      case 'set_role': {
        const { data: before } = await db.from('profiles').select('*').eq('id', body.userId).single();
        const patch = {
          role: body.role === 'owner' ? 'owner' : 'spectator',
          club_team_id: body.role === 'owner' ? body.clubTeamId : null,
        };
        const { error } = await db.from('profiles').update(patch).eq('id', body.userId);
        if (error) throw error;
        await log('UPDATE', body.userId, before, { ...before, ...patch });
        return json({ ok: true });
      }

      case 'mute': {
        const minutes = Math.max(0, Math.min(60 * 24 * 7, Number(body.minutes ?? 60)));
        const until = minutes ? new Date(Date.now() + minutes * 60_000).toISOString() : null;
        const { error } = await db.from('profiles').update({ muted_until: until }).eq('id', body.userId);
        if (error) throw error;
        await log('custom', body.userId, null, { muted_until: until });
        return json({ ok: true });
      }

      default:
        return json({ error: 'Acción desconocida' }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
