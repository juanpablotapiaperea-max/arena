import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Sin variables de Supabase la app arranca en modo demostración: lee los datos
 * iniciales generados localmente y no guarda cambios. Sirve para ver la
 * interfaz antes de conectar el backend.
 */
export const DEMO_MODE = !url || !anonKey;

export const supabase: SupabaseClient | null = DEMO_MODE
  ? null
  : createClient(url!, anonKey!, { auth: { persistSession: true, autoRefreshToken: true } });

// Safari pausa los temporizadores cuando la app queda en segundo plano y la
// sesión puede vencer: al volver, se renueva en cuanto la pantalla está visible.
if (supabase && typeof document !== 'undefined') {
  const wake = () => {
    if (document.visibilityState === 'visible') {
      supabase!.auth.startAutoRefresh();
      supabase!.auth.getSession().catch(() => undefined);
    } else supabase!.auth.stopAutoRefresh();
  };
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('focus', wake);
  window.addEventListener('online', wake);
}

/** Token vigente: si vence en menos de un minuto (o ya venció), lo renueva antes. */
export async function freshSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  const s = data.session;
  if (!s) return null;
  if ((s.expires_at ?? 0) * 1000 - Date.now() > 60_000) return s;
  const r = await supabase.auth.refreshSession();
  return r.data.session ?? null;
}

export function db(): SupabaseClient {
  if (!supabase) throw new Error('Supabase no está configurado (modo demostración)');
  return supabase;
}

/** Dominio sintético de los correos de espectadores y dueños (entran con nombre y código). */
export const USER_EMAIL_DOMAIN = 'usuarios.arena.app';

export function loginSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '');
}

export const emailForName = (name: string) => `${loginSlug(name)}@${USER_EMAIL_DOMAIN}`;
