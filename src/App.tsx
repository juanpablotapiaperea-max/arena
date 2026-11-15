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
  '/admin/planificador': { phase: 2, description: 'Elegir competiciones, generar la semana con su barra de interés y arrastrar eventos.' },
  '/admin/competiciones': { phase: 2, description: 'Crear y editar competiciones, formatos, reglas de participantes, clasificados y desempates.' },
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
        <Route index element={<Placeholder title="Hoy" phase={2} description="El guion del día: cuenta regresiva a los eventos principales, ráfagas de resultados y tablas que se actualizan." />} />
        <Route path="en-vivo" element={<Placeholder title="En vivo" phase={3} description="El evento principal con marcador, 3 periodos, jugadas, estadísticas en tiempo real, reacciones y chat." />} />
        <Route path="competiciones" element={<Placeholder title="Competiciones" phase={2} description="Tablas, cuadros de playoffs y probabilidades." />} />
        <Route path="mi-equipo" element={<MyTeamsPage />} />
        <Route path="estadisticas" element={<Placeholder title="Estadísticas" phase={3} description="Catálogo de estadísticas de equipos, jugadores, competiciones e historia." />} />
        <Route path="apuestas" element={<Placeholder title="Apuestas" phase={3} description="Mercados abiertos, tu boleta e historial." />} />
        <Route path="noticias" element={<Placeholder title="Noticias" phase={4} description="Resúmenes, crónicas, historias y rumores." />} />
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
