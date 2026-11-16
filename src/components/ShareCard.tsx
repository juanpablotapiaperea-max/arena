// Tarjeta compartible de un equipo: se dibuja en un canvas y se comparte
// con el menú nativo (iPad/teléfono) o se descarga como PNG.
import { useState } from 'react';
import { Share2 } from 'lucide-react';
import type { Team } from '@/lib/types';
import { textOn } from '@/lib/theme';
import { APP_NAME } from '@shared/config';
import { Button } from './ui';

export interface ShareLine {
  label: string;
  value: string;
}

async function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function drawShield(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, team: Team) {
  const path = (inset: number) => {
    const p = new Path2D();
    const k = s / 100;
    p.moveTo(x + 50 * k, y + (3 + inset) * k);
    p.lineTo(x + (95 - inset) * k, y + (18 + inset) * k);
    p.lineTo(x + (95 - inset) * k, y + 55 * k);
    p.bezierCurveTo(x + (95 - inset) * k, y + 82 * k, x + 74 * k, y + (100 - inset) * k, x + 50 * k, y + (107 - inset) * k);
    p.bezierCurveTo(x + 26 * k, y + (100 - inset) * k, x + (5 + inset) * k, y + 82 * k, x + (5 + inset) * k, y + 55 * k);
    p.lineTo(x + (5 + inset) * k, y + (18 + inset) * k);
    p.closePath();
    return p;
  };
  ctx.fillStyle = team.secondary_color;
  ctx.fill(path(0));
  ctx.fillStyle = team.primary_color;
  ctx.fill(path(8));
  ctx.fillStyle = textOn(team.primary_color);
  ctx.font = `bold ${s * 0.32}px "Barlow Condensed", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(team.short_name.slice(0, 3), x + s / 2, y + s * 0.62);
}

export async function renderTeamCard(team: Team, lines: ShareLine[], subtitle: string): Promise<Blob | null> {
  const W = 1080;
  const H = 1350;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  await document.fonts?.ready;

  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, team.primary_color);
  g.addColorStop(1, '#0b0f17');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // Rayas diagonales sutiles
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = team.secondary_color;
  for (let i = -H; i < W; i += 90) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 40, 0);
    ctx.lineTo(i + 40 + H, H);
    ctx.lineTo(i + H, H);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const crest = team.crest_url ? await loadImage(team.crest_url) : null;
  if (crest) ctx.drawImage(crest, W / 2 - 170, 110, 340, 340);
  else drawShield(ctx, W / 2 - 160, 100, 320, team);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 120px "Barlow Condensed", system-ui, sans-serif';
  ctx.fillText(team.name.toUpperCase(), W / 2, 590, W - 80);
  ctx.font = '500 40px Inter, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText(subtitle, W / 2, 650, W - 80);

  const cols = 2;
  const cw = (W - 160) / cols;
  lines.slice(0, 6).forEach((l, i) => {
    const cx = 80 + (i % cols) * cw;
    const cy = 730 + Math.floor(i / cols) * 170;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.roundRect(cx + 10, cy, cw - 20, 150, 24);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = '600 30px Inter, system-ui, sans-serif';
    ctx.fillText(l.label.toUpperCase(), cx + cw / 2, cy + 50, cw - 40);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 64px "Barlow Condensed", system-ui, sans-serif';
    ctx.fillText(l.value, cx + cw / 2, cy + 120, cw - 40);
  });

  ctx.fillStyle = team.secondary_color;
  ctx.fillRect(0, H - 110, W, 110);
  ctx.fillStyle = textOn(team.secondary_color);
  ctx.font = 'bold 56px "Barlow Condensed", system-ui, sans-serif';
  ctx.fillText(APP_NAME, W / 2, H - 38);

  return new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/png'));
}

export function ShareTeamButton({ team, lines, subtitle }: { team: Team; lines: ShareLine[]; subtitle: string }) {
  const [busy, setBusy] = useState(false);
  const share = async () => {
    setBusy(true);
    try {
      const blob = await renderTeamCard(team, lines, subtitle);
      if (!blob) return;
      const file = new File([blob], `${team.key}-arena.png`, { type: 'image/png' });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: team.name, text: `${team.name} en ${APP_NAME}` }).catch(() => undefined);
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size="sm" variant="ghost" onClick={share} disabled={busy} aria-label={`Compartir tarjeta de ${team.name}`}>
      <Share2 size={14} /> {busy ? 'Creando…' : 'Compartir'}
    </Button>
  );
}
