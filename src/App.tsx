import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Spinner } from "@/components/ui";
import { SpectatorLayout } from "@/components/SpectatorLayout";
import { LoginPage } from "@/pages/Login";
import { AdminLoginPage } from "@/pages/AdminLogin";
import { TeamsPage } from "@/pages/spectator/Teams";
import { ProfilePage } from "@/pages/spectator/Profile";
import { MyTeamsPage } from "@/pages/spectator/MyTeams";
import { TodayPage } from "@/pages/spectator/Today";
import { LiveIndexPage, LiveMatchPage } from "@/pages/spectator/Live";
import { CompetitionsPage, EditionPage } from "@/pages/spectator/Competitions";

// El panel de administración y las páginas pesadas se cargan bajo demanda,
// para que el espectador abra la app rápido desde el teléfono.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const named = <K extends string>(
  load: () => Promise<Record<K, ComponentType<any>>>,
  name: K,
) => lazy(() => load().then((m) => ({ default: m[name] })));
const AdminLayout = named(
  () => import("@/components/AdminLayout"),
  "AdminLayout",
);
const AdminDashboard = named(
  () => import("@/pages/admin/Dashboard"),
  "AdminDashboard",
);
const TeamsAdmin = named(
  () => import("@/pages/admin/TeamsAdmin"),
  "TeamsAdmin",
);
const UsersAdmin = named(
  () => import("@/pages/admin/UsersAdmin"),
  "UsersAdmin",
);
const LogAdmin = named(() => import("@/pages/admin/LogAdmin"), "LogAdmin");
const SettingsAdmin = named(
  () => import("@/pages/admin/SettingsAdmin"),
  "SettingsAdmin",
);
const Planner = named(() => import("@/pages/admin/Planner"), "Planner");
const CompetitionsAdmin = named(
  () => import("@/pages/admin/CompetitionsAdmin"),
  "CompetitionsAdmin",
);
const MarketAdmin = named(
  () => import("@/pages/admin/MarketAdmin"),
  "MarketAdmin",
);
const SeasonClose = named(
  () => import("@/pages/admin/SeasonClose"),
  "SeasonClose",
);
const EventsAdmin = named(
  () => import("@/pages/admin/EventsAdmin"),
  "EventsAdmin",
);
const EconomyAdmin = named(
  () => import("@/pages/admin/EconomyAdmin"),
  "EconomyAdmin",
);
const PressAdmin = named(
  () => import("@/pages/admin/PressAdmin"),
  "PressAdmin",
);
const RankingAdmin = named(
  () => import("@/pages/admin/RankingAdmin"),
  "RankingAdmin",
);
const StatsPage = named(() => import("@/pages/spectator/Stats"), "StatsPage");
const MarketPage = named(
  () => import("@/pages/spectator/Market"),
  "MarketPage",
);
const MyClubPage = named(
  () => import("@/pages/spectator/MyClub"),
  "MyClubPage",
);
const HistoryPage = named(
  () => import("@/pages/spectator/History"),
  "HistoryPage",
);
const BetsPage = named(() => import("@/pages/spectator/Bets"), "BetsPage");
const NewsPage = named(() => import("@/pages/spectator/News"), "NewsPage");
const GossipPage = named(
  () => import("@/pages/spectator/Gossip"),
  "GossipPage",
);
const TeamDetailPage = named(
  () => import("@/pages/spectator/TeamDetail"),
  "TeamDetailPage",
);

function RequireUser({ children }: { children: ReactNode }) {
  const { loading, profile } = useAuth();
  if (loading) return <Spinner />;
  if (!profile) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { loading, profile, aal } = useAuth();
  if (loading) return <Spinner />;
  if (!profile || profile.role !== "admin" || aal !== "aal2")
    return <Navigate to="/admin/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Suspense fallback={<Spinner />}>
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
          <Route path="eventos" element={<EventsAdmin />} />
          <Route path="mercado" element={<MarketAdmin />} />
          <Route path="economia" element={<EconomyAdmin />} />
          <Route path="prensa" element={<PressAdmin />} />
          <Route path="ranking" element={<RankingAdmin />} />
          <Route path="cierre" element={<SeasonClose />} />
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
          <Route path="chismes" element={<GossipPage />} />
          <Route path="mercado" element={<MarketPage />} />
          <Route path="mi-club" element={<MyClubPage />} />
          <Route path="equipos" element={<TeamsPage />} />
          <Route path="equipos/:key" element={<TeamDetailPage />} />
          <Route path="historia" element={<HistoryPage />} />
          <Route path="perfil" element={<ProfilePage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
