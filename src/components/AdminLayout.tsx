import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  Activity,
  BookLock,
  CalendarRange,
  Coins,
  Flag,
  Hammer,
  LogOut,
  Menu,
  Newspaper,
  Repeat,
  Settings,
  Sparkles,
  Trophy,
  Users,
  UserCog,
  X,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { DEMO_MODE } from '@/lib/supabase';
import { Brand } from '@/pages/Login';
import { cn } from './ui';

export const ADMIN_MODULES = [
  { to: '/admin', label: 'Centro de mando', icon: Activity, end: true },
  { to: '/admin/planificador', label: 'Planificador semanal', icon: CalendarRange },
  { to: '/admin/competiciones', label: 'Constructor de competiciones', icon: Hammer },
  { to: '/admin/equipos', label: 'Equipos y jugadores', icon: Users },
  { to: '/admin/eventos', label: 'Eventos', icon: Sparkles },
  { to: '/admin/mercado', label: 'Mercado y draft', icon: Repeat },
  { to: '/admin/usuarios', label: 'Usuarios', icon: UserCog },
  { to: '/admin/economia', label: 'Economía y apuestas', icon: Coins },
  { to: '/admin/prensa', label: 'Prensa', icon: Newspaper },
  { to: '/admin/ranking', label: 'Ranking', icon: Trophy },
  { to: '/admin/cierre', label: 'Cierre de temporada', icon: Flag },
  { to: '/admin/bitacora', label: 'Bitácora privada', icon: BookLock },
  { to: '/admin/configuracion', label: 'Configuración', icon: Settings },
];

export function AdminLayout() {
  const { profile, signOut } = useAuth();
  const [open, setOpen] = useState(false);

  const nav = (
    <nav aria-label="Módulos" className="flex flex-col gap-0.5">
      {ADMIN_MODULES.map((m) => (
        <NavLink
          key={m.to}
          to={m.to}
          end={m.end}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            cn(
              'focus-ring flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-sm',
              isActive ? 'bg-primary/15 font-semibold text-primary' : 'text-muted hover:bg-surface-2 hover:text-fg',
            )
          }
        >
          <m.icon size={17} aria-hidden />
          {m.label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-surface p-3 lg:flex">
        <div className="mb-4 px-2 pt-1">
          <Brand small />
          <div className="text-[11px] font-semibold uppercase tracking-widest text-muted">Administración</div>
        </div>
        <div className="flex-1 overflow-y-auto">{nav}</div>
        <div className="mt-3 flex items-center justify-between border-t border-line px-2 pt-3 text-xs text-muted">
          <span className="truncate">{profile?.display_name}</span>
          <button onClick={() => signOut()} className="focus-ring rounded p-1.5 hover:text-fg" aria-label="Salir">
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-bg/90 px-4 backdrop-blur lg:hidden">
          <button onClick={() => setOpen(true)} className="focus-ring rounded-lg p-2" aria-label="Abrir menú">
            <Menu size={20} />
          </button>
          <Brand small />
        </header>
        {DEMO_MODE && (
          <div className="border-b border-secondary/30 bg-secondary/10 px-4 py-2 text-xs text-secondary">
            Modo demostración: los cambios no se guardan hasta conectar Supabase.
          </div>
        )}
        <main className="mx-auto max-w-7xl p-4 lg:p-6">
          <Outlet />
        </main>
      </div>

      {open && (
        <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setOpen(false)}>
          <div
            className="absolute inset-y-0 left-0 w-72 overflow-y-auto bg-surface p-3"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Módulos"
          >
            <div className="mb-3 flex items-center justify-between px-2">
              <Brand small />
              <button onClick={() => setOpen(false)} className="focus-ring rounded-lg p-2" aria-label="Cerrar">
                <X size={18} />
              </button>
            </div>
            {nav}
            <button
              onClick={() => signOut()}
              className="focus-ring mt-4 flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-sm text-muted hover:bg-surface-2"
            >
              <LogOut size={16} /> Salir
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
