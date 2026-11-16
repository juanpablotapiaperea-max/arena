// Modos de accesibilidad para todos (se guardan en este dispositivo).
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export interface A11yPrefs {
  /** Tamaño del texto: 100 = normal. */
  textScale: 100 | 115 | 130 | 150;
  /** Alto contraste: colores más fuertes y bordes visibles. */
  highContrast: boolean;
  /** Menos movimiento: sin animaciones ni confeti. */
  reduceMotion: boolean;
  /** Letra de lectura fácil (Atkinson Hyperlegible). */
  readableFont: boolean;
  /** Daltonismo: azul/naranja y símbolos además del color. */
  colorSafe: boolean;
  /** Subrayar todos los enlaces. */
  underlineLinks: boolean;
  /** Anunciar goles y resultados al lector de pantalla. */
  announce: boolean;
  /** Vibrar en los goles del estelar (celular). */
  haptics: boolean;
  /** Sonidos de la transmisión. */
  sound: boolean;
}

export const DEFAULT_A11Y: A11yPrefs = {
  textScale: 100,
  highContrast: false,
  reduceMotion: false,
  readableFont: false,
  colorSafe: false,
  underlineLinks: false,
  announce: true,
  haptics: true,
  sound: false,
};

const KEY = 'arena-a11y';

function load(): A11yPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_A11Y, ...JSON.parse(raw) };
  } catch {
    /* sin almacenamiento */
  }
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const contrast = typeof matchMedia === 'function' && matchMedia('(prefers-contrast: more)').matches;
  return { ...DEFAULT_A11Y, reduceMotion: reduce, highContrast: contrast };
}

interface Ctx {
  prefs: A11yPrefs;
  set: (patch: Partial<A11yPrefs>) => void;
  reset: () => void;
  /** Mensaje para el lector de pantalla (región aria-live). */
  say: (msg: string, urgent?: boolean) => void;
}

const A11yCtx = createContext<Ctx | null>(null);

export function A11yProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<A11yPrefs>(load);
  const [polite, setPolite] = useState('');
  const [assertive, setAssertive] = useState('');

  useEffect(() => {
    const root = document.documentElement;
    root.style.fontSize = `${prefs.textScale}%`;
    root.dataset.contrast = prefs.highContrast ? 'high' : 'normal';
    root.dataset.motion = prefs.reduceMotion ? 'reduce' : 'full';
    root.dataset.font = prefs.readableFont ? 'readable' : 'default';
    root.dataset.colors = prefs.colorSafe ? 'safe' : 'default';
    root.dataset.links = prefs.underlineLinks ? 'underline' : 'default';
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      /* sin almacenamiento */
    }
  }, [prefs]);

  const value = useMemo<Ctx>(
    () => ({
      prefs,
      set: (patch) => setPrefs((p) => ({ ...p, ...patch })),
      reset: () => setPrefs({ ...DEFAULT_A11Y }),
      say: (msg, urgent) => {
        if (!prefs.announce) return;
        const setter = urgent ? setAssertive : setPolite;
        setter('');
        setTimeout(() => setter(msg), 50);
      },
    }),
    [prefs],
  );

  return (
    <A11yCtx.Provider value={value}>
      {children}
      <div aria-live="polite" className="sr-only">
        {polite}
      </div>
      <div aria-live="assertive" className="sr-only">
        {assertive}
      </div>
    </A11yCtx.Provider>
  );
}

export function useA11y(): Ctx {
  const v = useContext(A11yCtx);
  if (!v) throw new Error('useA11y fuera de A11yProvider');
  return v;
}

/** Sonido corto generado (sin archivos): silbato o bocina de gol. */
export function playCue(kind: 'goal' | 'whistle' | 'win') {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    const t = ctx.currentTime;
    if (kind === 'goal') {
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(220, t);
      o.frequency.exponentialRampToValueAtTime(110, t + 0.9);
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1);
      o.start(t);
      o.stop(t + 1);
    } else if (kind === 'whistle') {
      o.type = 'sine';
      o.frequency.setValueAtTime(2600, t);
      g.gain.setValueAtTime(0.08, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      o.start(t);
      o.stop(t + 0.5);
    } else {
      o.type = 'triangle';
      o.frequency.setValueAtTime(523, t);
      o.frequency.setValueAtTime(659, t + 0.15);
      o.frequency.setValueAtTime(784, t + 0.3);
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
      o.start(t);
      o.stop(t + 0.8);
    }
  } catch {
    /* audio no disponible */
  }
}

export function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* sin vibración */
  }
}
