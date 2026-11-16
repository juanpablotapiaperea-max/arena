// Acceso a datos del servidor (clave de servicio: salta RLS; nunca llega al navegador).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export type DB = SupabaseClient;

export function serviceClient(): DB {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
}

export function userClient(authHeader: string): DB {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
}

export class AppError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

// deno-lint-ignore no-explicit-any
type Builder = any;

/** Ejecuta una consulta y lanza si falla. */
export async function q<T = Record<string, unknown>>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new AppError(error.message, 500);
  return data as T;
}

/** Lee todas las filas paginando de 1000 en 1000. */
export async function all<T = Record<string, unknown>>(make: () => Builder): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const page = await q<T[]>(make().range(from, from + 999));
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

/** Inserta en bloques; devuelve las filas creadas si se pide. */
export async function insertMany<T = Record<string, unknown>>(db: DB, table: string, rows: Record<string, unknown>[], select?: string): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const b = db.from(table).insert(chunk);
    const data = await q<T[] | null>(select ? b.select(select) : b);
    if (data) out.push(...data);
  }
  return out;
}

export async function getSetting<T>(db: DB, key: string, fallback: T): Promise<T> {
  const { data } = await db.from('settings').select('value').eq('key', key).maybeSingle();
  return (data?.value as T) ?? fallback;
}

export function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}
