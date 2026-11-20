import { Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Accessibility, BarChart3, CalendarDays, Coins, History, LogOut, Menu, Newspaper, Radio, Repeat, Shield, Trophy, User, Users, X, Heart, MonitorPlay } from 'lucide-react';
import { Ticker } from './Ticker';
import { ErrorBoundary } from './ErrorBoundary';
import { Spinner } from './ui';
import { NotificationCenter } from './Notifications';
import { AccessibilityPanel } from './AccessibilityPanel';
import { useAuth } from '@/lib/auth';
import { useTeams } from '@/lib/hooks';
import { applyTeamTheme } from '@/lib/theme';
import { Crest } from './Crest';
import { Brand } from '@/pages/Login';
import { cn } from './ui';

const MAIN_TABS: { to: string; label: string; icon: typeof CalendarDays; end?: boolean }[] = [
  { to: '/', label: 'Hoy', icon: CalendarDays, end: true },
  { to: '/en-vivo', label: 'En vivo', icon: Radio },
  { to: '/competiciones', label: 'Competiciones', icon: Trophy },
  { to: '/mi-equipo', label: 'Mi equipo', icon: Shield },
];

const MORE_TABS = [
  { to: '/board', label: 'Board en vivo', icon: MonitorPlay },
  { to: '/estadisticas', label: 'Estadísticas', icon: BarChart3 },
  { to: '/apuestas', label: 'Apuestas', icon: Coins },
  { to: '/noticias', label: 'Noticias', icon: Newspaper },
  { to: '/chismes', label: 'Chismes', icon: Heart },
  { to: '/mercado', label: 'Mercado y draft', icon: Repeat },
  { to: '/equipos', label: 'Equipos', icon: Users },
  { to: '/historia', label: 'Historia', icon: History },
  { to: '/perfil', label: 'Perfil', icon: User },
];

export function SpectatorLayout() {
  const { profile, signOut } = useAuth();
  const { byId } = useTeams();
  const star = profile?.star_team_id ? byId.get(profile.star_team_id) ?? null : null;
  const [moreOpen, setMoreOpen] = useState(false);
  const [a11yOpen, setA11yOpen] = useState(false);
  const location = useLocation();
  const reduce = useReducedMotion();

  useEffect(() => applyTeamTheme(star), [star]);
  useEffect(() => setMoreOpen(false), [location.pathname]);

  const tabs = profile?.role === 'owner' ? [...MORE_TABS, { to: '/mi-club', label: 'Mi club', icon: Shield }] : MORE_TABS;

  return (
    <div className="min-h-screen pb-24 xl:pb-8">
      <a href="#contenido" className="focus-ring sr-only z-50 rounded-lg bg-primary px-3 py-2 text-bg focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Saltar al contenido
      </a>
      {profile?.role === 'admin' && (
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-secondary px-4 py-2 text-center text-sm font-semibold text-bg">
          <span>Estás viendo la app como espectador</span>
          <Link to="/admin" className="focus-ring rounded underline underline-offset-2">
            Volver al panel
          </Link>
        </div>
      )}
      <header className="sticky top-0 z-30 border-b border-line/70 bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          {star ? <Crest team={star} size={28} /> : null}
          <Brand small />
          <nav className="ml-6 hidden gap-1 xl:flex" aria-label="Principal">
            {[...MAIN_TABS, ...tabs].map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.to === '/'}
                className={({ isActive }) =>
                  cn('focus-ring rounded-lg px-2.5 py-1.5 text-sm font-medium', isActive ? 'bg-primary/15 text-primary' : 'text-muted hover:text-fg')
                }
              >
                {t.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="flex items-center gap-1 rounded-lg bg-surface-2 px-2 py-1 text-xs font-semibold tabular" title="Créditos">
              <Coins size={14} className="text-secondary" aria-hidden /> {profile?.credits.toLocaleString('es-MX')}
            </span>
            <NotificationCenter />
            <button onClick={() => setA11yOpen(true)} className="focus-ring rounded-lg p-2 text-muted hover:text-fg" aria-label="Accesibilidad">
              <Accessibility size={18} />
            </button>
            <button onClick={() => signOut()} className="focus-ring rounded-lg p-2 text-muted hover:text-fg" aria-label="Salir">
              <LogOut size={18} />
            </button>
          </div>
        </div>
        <Ticker />
      </header>

      {a11yOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={() => setA11yOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Accesibilidad"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-line bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:rounded-3xl"
          >
            <div className="mb-2 flex justify-end">
              <button onClick={() => setA11yOpen(false)} className="focus-ring rounded-lg p-2" aria-label="Cerrar">
                <X size={18} />
              </button>
            </div>
            <AccessibilityPanel compact />
          </div>
        </div>
      )}

      <AnimatePresence mode="wait">
        <motion.main
          key={location.pathname}
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? undefined : { opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="mx-auto max-w-6xl px-4 py-5"
          id="contenido"
          tabIndex={-1}
        >
          <ErrorBoundary resetKey={location.pathname}>
            <Suspense fallback={<Spinner />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </motion.main>
      </AnimatePresence>

      {/* Navegación inferior en celular */}
      <nav
        aria-label="Principal"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur xl:hidden"
      >
        <div className="grid grid-cols-5">
          {MAIN_TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                cn('focus-ring flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium', isActive ? 'text-primary' : 'text-muted')
              }
            >
              <t.icon size={20} aria-hidden />
              {t.label}
            </NavLink>
          ))}
          <button
            onClick={() => setMoreOpen(true)}
            className="focus-ring flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted"
          >
            <Menu size={20} aria-hidden />
            Más
          </button>
        </div>
      </nav>

      <AnimatePresence>
        {moreOpen && (
          <motion.div
            className="fixed inset-0 z-40 bg-black/60 xl:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setMoreOpen(false)}
          >
            <motion.div
              role="dialog"
              aria-label="Más secciones"
              className="absolute inset-x-0 bottom-0 rounded-t-3xl border-t border-line bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 320 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="font-display text-xl font-bold uppercase">Más</span>
                <button onClick={() => setMoreOpen(false)} className="focus-ring rounded-lg p-2" aria-label="Cerrar">
                  <X size={20} />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {tabs.map((t) => (
                  <NavLink
                    key={t.to}
                    to={t.to}
                    className="focus-ring flex flex-col items-center gap-1.5 rounded-2xl bg-surface-2 px-2 py-4 text-center text-xs font-medium"
                  >
                    <t.icon size={22} className="text-primary" aria-hidden />
                    {t.label}
                  </NavLink>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
