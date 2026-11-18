// Nunca dejar la pantalla en negro: si una página falla, se muestra un aviso
// con la opción de recargar. Si el fallo es porque se publicó una versión
// nueva de la app (archivos viejos que ya no existen), se recarga sola una vez.
import { Component, type ErrorInfo, type ReactNode } from 'react';

const RELOAD_KEY = 'arena:recarga-version';

export function isChunkError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err ?? '');
  return /dynamically imported module|Importing a module script failed|error loading dynamically|Failed to fetch dynamically|ChunkLoadError|module script/i.test(msg);
}

/** Recarga una sola vez por minuto para traer la versión nueva. Devuelve true si recargó. */
export function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    /* sin almacenamiento: recargar igual */
  }
  window.location.reload();
  return true;
}

interface State {
  error: unknown;
}

export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (isChunkError(error) && reloadForNewVersion()) return;
    console.error('Fallo en la interfaz', error, info.componentStack);
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    // Al cambiar de página se intenta de nuevo.
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const chunk = isChunkError(this.state.error);
    return (
      <div role="alert" className="mx-auto my-10 max-w-md rounded-2xl border border-line bg-surface p-6 text-center">
        <div className="text-3xl" aria-hidden>
          {chunk ? '🔄' : '⚠️'}
        </div>
        <h2 className="mt-2 font-display text-2xl font-bold uppercase">{chunk ? 'Hay una versión nueva' : 'Algo salió mal'}</h2>
        <p className="mt-1 text-sm text-muted">
          {chunk ? 'Se actualizó la app mientras la tenías abierta. Recarga para ver la versión nueva.' : 'Esta pantalla tuvo un problema. Puedes recargar o volver al inicio.'}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <button onClick={() => window.location.reload()} className="focus-ring min-h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-bg">
            Recargar
          </button>
          <a href="/" className="focus-ring inline-flex min-h-11 items-center rounded-xl border border-line px-4 text-sm">
            Ir al inicio
          </a>
        </div>
      </div>
    );
  }
}
