import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Spinner } from '@/components/ui';
import { SpectatorLayout } from '@/components/SpectatorLayout';
import { AdminLayout, ADMIN_MODULES } from '@/components/AdminLayout';
import { LoginPage } from '@/pages/Login';
import { AdminLoginPage } from '@/pages/AdminLogin';
import { Placeholder } from '@/pages/Placeholder';
import { TeamsPage } from '@/pages/spectator/Teams';
import { TeamDetailPage } from '@/pages/spectator/TeamDetail';
import { HistoryPage } from '@/pages/spectator/History';
import { ProfilePage } from '@/pages/spectator/Profile';
import { MyTeamsPage } from '@/pages/spectator/MyTeams';
import { AdminDashboard } from '@/pages/admin/Dashboard';
import { TeamsAdmin } from '@/pages/admin/TeamsAdmin';
import { UsersAdmin } from '@/pages/admin/UsersAdmin';
import { LogAdmin } from '@/pages/admin/LogAdmin';
import { SettingsAdmin } from '@/pages/admin/SettingsAdmin';
import { Planner } from '@/pages/admin/Planner';
import { CompetitionsAdmin } from '@/pages/admin/CompetitionsAdmin';
import { TodayPage } from '@/pages/spectator/Today';
import { LiveIndexPage, LiveMatchPage } from '@/pages/spectator/Live';
import { CompetitionsPage, EditionPage } from '@/pages/spectator/Competitions';
import { BetsPage } from '@/pages/spectator/Bets';
import { NewsPage } from '@/pages/spectator/News';
import { StatsPage } from '@/pages/spectator/Stats';

function RequireUser({ children }: { children: ReactNode }) {
  const { loading, profile } = useAuth();
  if (loading) return <Spinner />;
  if (!profile) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { loading, profile, aal } = useAuth();
  if (loading) return <Spinner />;
  if (!profile || profile.role !== 'admin' || aal !== 'aal2') return <Navigate to="/admin/login" replace />;
  return <>{children}</>;
}

const ADMIN_PLACEHOLDERS: Record<string, { phase: number; description: string }> = {
  '/admin/eventos': { phase: 3, description: 'Revisar derbis detectados, forzar o vetar, marcar clásicos y elegir eventos del momento.' },
  '/admin/mercado': { phase: 4, description: 'Abrir ventanas, aprobar, vetar o forzar fichajes y controlar el draft.' },
  '/admin/economia': { phase: 3, description: 'Márgenes, topes, bono diario, tope salarial y consulta de apuestas.' },
  '/admin/prensa': { phase: 4, description: 'Cola de aprobación, nivel de tono, tope de gasto de la IA y noticias manuales.' },
  '/admin/ranking': { phase: 2, description: 'Pesos, puntos base y ajustes manuales del ranking.' },
  '/admin/cierre': { phase: 2, description: 'Asistente de cierre: ranking, ascensos y descensos, progresión, retiros, draft y mercado.' },
};

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/admin/login" element={<AdminLoginPage />} />

      <Route
        path="/admin"
        element={
          <RequireAdmin>
            <AdminLayout />
          </RequireAdmin>
        }
      >
        <Route index element={<AdminDashboard />} />
        <Route path="equipos" element={<TeamsAdmin />} />
        <Route path="usuarios" element={<UsersAdmin />} />
        <Route path="bitacora" element={<LogAdmin />} />
        <Route path="configuracion" element={<SettingsAdmin />} />
        <Route path="planificador" element={<Planner />} />
        <Route path="competiciones" element={<CompetitionsAdmin />} />
        {Object.entries(ADMIN_PLACEHOLDERS).map(([path, p]) => (
          <Route
            key={path}
            path={path.replace('/admin/', '')}
            element={<Placeholder title={ADMIN_MODULES.find((m) => m.to === path)?.label ?? ''} {...p} />}
          />
        ))}
      </Route>

      <Route
        element={
          <RequireUser>
            <SpectatorLayout />
          </RequireUser>
        }
      >
        <Route index element={<TodayPage />} />
        <Route path="en-vivo" element={<LiveIndexPage />} />
        <Route path="en-vivo/:id" element={<LiveMatchPage />} />
        <Route path="competiciones" element={<CompetitionsPage />} />
        <Route path="competiciones/:id" element={<EditionPage />} />
        <Route path="mi-equipo" element={<MyTeamsPage />} />
        <Route path="estadisticas" element={<StatsPage />} />
        <Route path="apuestas" element={<BetsPage />} />
        <Route path="noticias" element={<NewsPage />} />
        <Route path="mercado" element={<Placeholder title="Mercado y draft" phase={4} description="Fichajes, rumores y el evento del draft." />} />
        <Route path="mi-club" element={<Placeholder title="Mi club" phase={4} description="Finanzas, plantilla, estilo de juego, fichajes sugeridos, draft y apuestas del club." />} />
        <Route path="equipos" element={<TeamsPage />} />
        <Route path="equipos/:key" element={<TeamDetailPage />} />
        <Route path="historia" element={<HistoryPage />} />
        <Route path="perfil" element={<ProfilePage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
