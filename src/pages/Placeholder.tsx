import { Construction } from 'lucide-react';
import { SectionTitle } from '@/components/ui';

/** Secciones que se construyen en fases posteriores (sección 18). */
export function Placeholder({ title, phase, description }: { title: string; phase: number; description: string }) {
  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      <div className="card flex flex-col items-center gap-3 p-10 text-center">
        <Construction className="text-primary" size={32} aria-hidden />
        <p className="max-w-md text-sm text-muted">{description}</p>
        <span className="rounded-md bg-surface-2 px-2 py-1 text-xs font-semibold text-muted">Fase {phase} de 5</span>
      </div>
    </div>
  );
}
