// Tiempo real: cuando cambia una tabla, se refrescan las consultas indicadas.
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DEMO_MODE, supabase } from './supabase';

export function useRealtime(table: string, queryKeys: unknown[][], filter?: string) {
  const qc = useQueryClient();
  const keyStr = JSON.stringify(queryKeys);
  useEffect(() => {
    if (DEMO_MODE || !supabase) return;
    const channel = supabase
      .channel(`rt:${table}:${filter ?? 'all'}:${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) }, () => {
        for (const k of JSON.parse(keyStr) as unknown[][]) qc.invalidateQueries({ queryKey: k });
      })
      .subscribe();
    return () => {
      supabase!.removeChannel(channel);
    };
  }, [table, filter, keyStr, qc]);
}
