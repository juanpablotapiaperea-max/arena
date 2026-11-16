// Panel de accesibilidad: disponible para todos desde el perfil y el botón ♿.
import { Accessibility, RotateCcw } from 'lucide-react';
import { useA11y, type A11yPrefs } from '@/lib/a11y';
import { cn } from './ui';

const SWITCHES: [keyof A11yPrefs, string, string][] = [
  ['highContrast', 'Alto contraste', 'Fondo negro, texto blanco y bordes marcados.'],
  ['reduceMotion', 'Menos movimiento', 'Quita animaciones, confeti y transiciones.'],
  ['readableFont', 'Letra de lectura fácil', 'Usa Atkinson Hyperlegible, diseñada para baja visión.'],
  ['colorSafe', 'Colores para daltonismo', 'Azul y naranja en lugar de verde y rojo, con símbolos ▲ ▼.'],
  ['underlineLinks', 'Subrayar enlaces', 'Marca todos los enlaces con una línea.'],
  ['announce', 'Narrar en el lector de pantalla', 'Anuncia goles, resultados y avisos con VoiceOver o TalkBack.'],
  ['sound', 'Sonidos', 'Bocina en los goles y silbato al apostar.'],
  ['haptics', 'Vibración', 'Vibra cuando anota tu equipo estelar (en celulares compatibles).'],
];

export function AccessibilityPanel({ compact = false }: { compact?: boolean }) {
  const { prefs, set, reset } = useA11y();
  return (
    <section aria-labelledby="a11y-title" className={cn(!compact && 'card p-4')}>
      <h3 id="a11y-title" className="mb-1 flex items-center gap-2 font-semibold">
        <Accessibility size={18} className="text-primary" aria-hidden /> Accesibilidad
      </h3>
      <p className="mb-4 text-sm text-muted">Se guarda en este dispositivo.</p>

      <fieldset className="mb-4">
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Tamaño del texto</legend>
        <div className="grid grid-cols-4 gap-1.5">
          {([100, 115, 130, 150] as const).map((s) => (
            <button
              key={s}
              onClick={() => set({ textScale: s })}
              aria-pressed={prefs.textScale === s}
              className={cn('focus-ring min-h-11 rounded-xl border font-semibold', prefs.textScale === s ? 'border-primary bg-primary/15 text-primary' : 'border-line bg-surface-2')}
              style={{ fontSize: `${0.75 + (s - 100) / 160}rem` }}
            >
              A<span className="sr-only"> {s}%</span>
            </button>
          ))}
        </div>
      </fieldset>

      <ul className="space-y-1">
        {SWITCHES.map(([key, label, hint]) => {
          const on = !!prefs[key];
          return (
            <li key={key}>
              <button
                role="switch"
                aria-checked={on}
                onClick={() => set({ [key]: !on } as Partial<A11yPrefs>)}
                className="focus-ring flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-surface-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-xs text-muted">{hint}</span>
                </span>
                <span className={cn('relative h-7 w-12 shrink-0 rounded-full transition', on ? 'bg-primary' : 'border border-line bg-surface-2')} aria-hidden>
                  <span className={cn('absolute top-1 h-5 w-5 rounded-full bg-white transition-all', on ? 'left-6' : 'left-1')} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <button onClick={reset} className="focus-ring mt-3 inline-flex items-center gap-1.5 rounded text-sm text-muted hover:text-fg">
        <RotateCcw size={14} /> Restablecer
      </button>
    </section>
  );
}
