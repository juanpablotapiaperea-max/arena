// Crea la cuenta del administrador (una sola vez).
// Uso:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/create-admin.ts correo@ejemplo.com "Nombre"
// La contraseña se pide por la terminal y no se guarda en ningún archivo.
import { createInterface } from 'node:readline/promises';
import { createClient } from '@supabase/supabase-js';

const [email, name = 'Administrador'] = process.argv.slice(2);
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!email || !url || !key) {
  console.error('Faltan datos. Revisa el comentario al inicio de este archivo.');
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const password = await rl.question('Contraseña del administrador (mínimo 12 caracteres): ');
rl.close();
if (password.length < 12) {
  console.error('La contraseña es demasiado corta.');
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });
const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
if (error) throw error;
const { error: pErr } = await db.from('profiles').insert({
  id: data.user.id,
  display_name: name,
  login_slug: `admin.${data.user.id.slice(0, 8)}`,
  role: 'admin',
  credits: 0,
});
if (pErr) throw pErr;
console.log('Administrador creado. Al entrar por primera vez se te pedirá registrar tu app autenticadora.');
