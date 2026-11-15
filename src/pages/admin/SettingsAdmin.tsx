import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { APP_NAME } from '@shared/config';
import { adminSetSetting, getSetting } from '@/lib/api';
import { Button, Card, ErrorBox, Input, Label, SectionTitle } from '@/components/ui';

/** Configuración: interruptor de estadios, nombre de la app y parámetros globales. */
export function SettingsAdmin() {
  const qc = useQueryClient();
  const stadiums = useQuery({ queryKey: ['setting', 'stadiums_enabled'], queryFn: () => getSetting<boolean>('stadiums_enabled') });
  const appName = useQuery({ queryKey: ['setting', 'app_name'], queryFn: () => getSetting<string>('app_name') });
  const [name, setName] = useState(APP_NAME);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (appName.data) setName(appName.data);
  }, [appName.data]);

  const save = async (key: string, value: unknown) => {
    setError(null);
    try {
      await adminSetSetting(key, value);
      await qc.invalidateQueries({ queryKey: ['setting', key] });
    } catch (e) {
      setError(e);
    }
  };

  return (
    <div className="space-y-4">
      <SectionTitle>Configuración</SectionTitle>
      {error ? <ErrorBox error={error} /> : null}
      <Card className="flex items-center gap-4">
        <div className="flex-1">
          <h3 className="font-semibold">Estadios</h3>
          <p className="text-sm text-muted">
            Apagados: la taquilla usa un aforo genérico según el nivel del club. Encendidos: aforo real, mejoras y bono de local.
          </p>
        </div>
        <button
          role="switch"
          aria-checked={!!stadiums.data}
          aria-label="Activar estadios"
          onClick={() => save('stadiums_enabled', !stadiums.data)}
          className={`focus-ring relative h-7 w-12 rounded-full transition ${stadiums.data ? 'bg-primary' : 'bg-surface-2 border border-line'}`}
        >
          <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${stadiums.data ? 'left-6' : 'left-1'}`} />
        </button>
      </Card>
      <Card>
        <Label htmlFor="appname">Nombre de la app</Label>
        <div className="flex gap-2">
          <Input id="appname" value={name} onChange={(e) => setName(e.target.value)} />
          <Button onClick={() => save('app_name', name)}>Guardar</Button>
        </div>
        <p className="mt-2 text-xs text-muted">
          El nombre provisional vive en la constante APP_NAME (shared/config.ts); este valor lo sobrescribe en la interfaz.
        </p>
      </Card>
    </div>
  );
}
