import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { DEMO_MODE, emailForName, supabase } from './supabase';
import { getMyProfile } from './api';
import type { Profile, UserRole } from './types';

interface AuthState {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  /** Nivel de verificación de la sesión: aal2 = pasó el segundo factor. */
  aal: 'aal1' | 'aal2' | null;
  demoRole: UserRole | null;
  signInWithCode: (name: string, code: string) => Promise<void>;
  signInAdmin: (email: string, password: string) => Promise<void>;
  enterDemo: (role: UserRole) => void;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  setLocalProfile: (patch: Partial<Profile>) => void;
}

const Ctx = createContext<AuthState | null>(null);

const DEMO_PROFILE = (role: UserRole): Profile => ({
  id: 'demo',
  display_name: role === 'admin' ? 'Administrador (demo)' : 'Espectador (demo)',
  login_slug: 'demo',
  role,
  club_team_id: role === 'owner' ? 'kings' : null,
  favorite_team_ids: [],
  star_team_id: null,
  credits: 1000,
  muted_until: null,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(!DEMO_MODE);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [aal, setAal] = useState<'aal1' | 'aal2' | null>(null);
  const [demoRole, setDemoRole] = useState<UserRole | null>(null);

  const load = useCallback(async (s: Session | null) => {
    setSession(s);
    if (!s || !supabase) {
      setProfile(null);
      setAal(null);
      setLoading(false);
      return;
    }
    try {
      const [{ data: level }, p] = await Promise.all([
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        getMyProfile(s.user.id),
      ]);
      setAal((level?.currentLevel as 'aal1' | 'aal2') ?? 'aal1');
      setProfile(p);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => load(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      // Diferido para no bloquear el callback de Supabase.
      setTimeout(() => load(s), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  const value = useMemo<AuthState>(
    () => ({
      loading,
      session,
      profile: DEMO_MODE && demoRole ? profile ?? DEMO_PROFILE(demoRole) : profile,
      aal: DEMO_MODE && demoRole ? 'aal2' : aal,
      demoRole,
      async signInWithCode(name, code) {
        if (!supabase) throw new Error('Supabase no está configurado');
        const { error } = await supabase.auth.signInWithPassword({ email: emailForName(name), password: code.trim() });
        if (error) throw new Error('Nombre o código incorrectos');
      },
      async signInAdmin(email, password) {
        if (!supabase) throw new Error('Supabase no está configurado');
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw new Error('Correo o contraseña incorrectos');
      },
      enterDemo(role) {
        setDemoRole(role);
        setProfile(DEMO_PROFILE(role));
      },
      async signOut() {
        if (DEMO_MODE) {
          setDemoRole(null);
          setProfile(null);
          return;
        }
        await supabase!.auth.signOut();
      },
      async refresh() {
        if (session) await load(session);
      },
      setLocalProfile(patch) {
        setProfile((p) => (p ? { ...p, ...patch } : p));
      },
    }),
    [loading, session, profile, aal, demoRole, load],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth fuera de AuthProvider');
  return v;
}
