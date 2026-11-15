import { useQuery } from '@tanstack/react-query';
import { getCompetitions, getHistoricalRanking, getLegacyEditions, getPlayers, getTeams } from './api';
import type { Team } from './types';

export function useTeams() {
  const q = useQuery({ queryKey: ['teams'], queryFn: getTeams, staleTime: 60_000 });
  const byId = new Map<string, Team>((q.data ?? []).map((t) => [t.id, t]));
  return { ...q, teams: q.data ?? [], byId };
}

export const usePlayers = (teamId?: string) =>
  useQuery({ queryKey: ['players', teamId ?? 'all'], queryFn: () => getPlayers(teamId), staleTime: 60_000 });

export const useHistoricalRanking = () =>
  useQuery({ queryKey: ['ranking', 'historical'], queryFn: getHistoricalRanking, staleTime: 60_000 });

export const useLegacyEditions = () => useQuery({ queryKey: ['legacy'], queryFn: getLegacyEditions, staleTime: 300_000 });

export const useCompetitions = () => useQuery({ queryKey: ['competitions'], queryFn: getCompetitions, staleTime: 300_000 });
