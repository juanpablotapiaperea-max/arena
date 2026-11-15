import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { APP_NAME } from '@shared/config';
import { useAuth } from '@/lib/auth';
import { DEMO_MODE } from '@/lib/supabase';
import { Button, ErrorBox, Input, Label } from '@/components/ui';

export function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className={small ? 'font-display text-2xl font-extrabold tracking-[0.2em]' : 'font-display text-6xl font-extrabold tracking-[0.25em]'}>
      <span className="text-primary">{APP_NAME.slice(0, 1)}</span>
      {APP_NAME.slice(1)}
    </div>
  );
}

export function LoginPage() {
  const { profile, signInWithCode, enterDemo } = useAuth();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (profile) return <Navigate to={profile.role === 'admin' ? '/admin' : '/'} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signInWithCode(name, code);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-10">
      <Brand />
      <p className="mt-2 text-sm text-muted">Hockey 5v5 · la liga en vivo</p>

      {DEMO_MODE ? (
        <div className="card mt-10 space-y-3 p-5">
          <p className="text-sm text-muted">
            Modo demostración: Supabase aún no está conectado. Puedes recorrer la app con los datos iniciales.
          </p>
          <Button className="w-full" onClick={() => enterDemo('spectator')}>
            Entrar como espectador
          </Button>
          <Button className="w-full" variant="outline" onClick={() => enterDemo('admin')}>
            Entrar como administrador
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="card mt-10 space-y-4 p-5">
          <div>
            <Label htmlFor="name">Nombre</Label>
            <Input id="name" autoComplete="username" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="code">Código</Label>
            <Input
              id="code"
              autoComplete="current-password"
              type="password"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </div>
          {error ? <ErrorBox error={error} /> : null}
          <Button className="w-full" disabled={busy}>
            {busy ? 'Entrando…' : 'Entrar'}
          </Button>
          <p className="text-center text-xs text-muted">El administrador te entrega tu nombre y tu código.</p>
        </form>
      )}
      {!DEMO_MODE && (
        <Link to="/admin/login" className="focus-ring mt-6 self-center rounded text-xs text-muted underline-offset-4 hover:underline">
          Soy administrador
        </Link>
      )}
    </main>
  );
}
