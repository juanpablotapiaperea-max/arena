import { usePlayers, useTeams, useCompetitions, useLegacyEditions } from '@/lib/hooks';
import { SectionTitle, Stat, Card } from '@/components/ui';

/** Centro de mando (fase 1: estado de los datos; fase 2 añade el control del día). */
export function AdminDashboard() {
  const { teams } = useTeams();
  const players = usePlayers();
  const competitions = useCompetitions();
  const legacy = useLegacyEditions();
  const injured = (players.data ?? []).filter((p) => p.injury_days > 0).length;

  return (
    <div className="space-y-6">
      <SectionTitle>Centro de mando</SectionTitle>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Stat label="Equipos" value={teams.length} />
        <Stat label="Jugadores" value={players.data?.length ?? '…'} />
        <Stat label="Lesionados" value={injured} />
        <Stat label="Competiciones" value={competitions.data?.length ?? '…'} />
        <Stat label="Historial importado" value={legacy.data?.length ?? '…'} />
      </div>
      <Card>
        <h3 className="mb-1 font-semibold">Día de competencia</h3>
        <p className="text-sm text-muted">
          No hay un día iniciado. El inicio del día, las ráfagas y el control de eventos en vivo llegan con el núcleo jugable.
        </p>
      </Card>
    </div>
  );
}
