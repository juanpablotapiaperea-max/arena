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
