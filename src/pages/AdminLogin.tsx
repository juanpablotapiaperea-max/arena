import { useEffect, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { Button, ErrorBox, Input, Label } from '@/components/ui';
import { Brand } from './Login';

/**
 * Acceso del administrador: correo y contraseña, más un segundo factor
 * (código de una app autenticadora). La primera vez se registra el factor.
 */
export function AdminLoginPage() {
  const { session, profile, aal, signInAdmin, refresh, signOut } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [enroll, setEnroll] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);

  const needsMfa = !!session && profile?.role === 'admin' && aal !== 'aal2';

  useEffect(() => {
    if (!needsMfa || !supabase) return;
    (async () => {
      const { data } = await supabase.auth.mfa.listFactors();
      const verified = data?.totp?.find((f) => f.status === 'verified');
      if (verified) {
        setFactorId(verified.id);
      } else {
        const { data: e, error: err } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'ARENA admin' });
        if (err) setError(err);
        else if (e) setEnroll({ factorId: e.id, qr: e.totp.qr_code, secret: e.totp.secret });
      }
    })();
  }, [needsMfa]);

  if (profile?.role === 'admin' && aal === 'aal2') return <Navigate to="/admin" replace />;
  if (profile && profile.role !== 'admin') return <Navigate to="/" replace />;

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signInAdmin(email, password);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const submitTotp = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    try {
      const id = enroll?.factorId ?? factorId;
      if (!id) throw new Error('No hay factor registrado');
      const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId: id, code: totp.trim() });
      if (err) throw new Error('Código incorrecto');
      await refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-10">
      <Brand />
      <p className="mt-2 text-sm text-muted">Panel de administración</p>

      {!session ? (
        <form onSubmit={submitPassword} className="card mt-10 space-y-4 p-5">
          <div>
            <Label htmlFor="email">Usuario o correo</Label>
            <Input id="email" type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="Tu nombre de usuario" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="password">Contraseña o código</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error ? <ErrorBox error={error} /> : null}
          <Button className="w-full" disabled={busy}>
            Continuar
          </Button>
        </form>
      ) : (
        <form onSubmit={submitTotp} className="card mt-10 space-y-4 p-5">
          {enroll ? (
            <>
              <p className="text-sm text-muted">
                Primera vez: escanea este código con tu app autenticadora (Google Authenticator, 1Password, Authy…).
              </p>
              <img src={enroll.qr} alt="Código QR para la app autenticadora" className="mx-auto h-44 w-44 rounded-lg bg-white p-2" />
              <p className="break-all text-center font-mono text-xs text-muted">{enroll.secret}</p>
            </>
          ) : (
            <p className="text-sm text-muted">Escribe el código de 6 dígitos de tu app autenticadora.</p>
          )}
          <div>
            <Label htmlFor="totp">Código de verificación</Label>
            <Input
              id="totp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={totp}
              onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
              required
            />
          </div>
          {error ? <ErrorBox error={error} /> : null}
          <Button className="w-full" disabled={busy || totp.length !== 6}>
            Verificar
          </Button>
          <Button type="button" variant="ghost" className="w-full" onClick={() => signOut()}>
            Salir
          </Button>
        </form>
      )}
    </main>
  );
}
