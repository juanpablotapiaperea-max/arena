import { describe, expect, it } from 'vitest';
import { generateGossip, GOSSIP_TEMPLATE_COUNT, type GossipPlayer } from '../shared/press/gossip';
import { createRng } from '../shared/engine/rng';

const pl = (id: string, team: string): GossipPlayer => ({ id, name: `Nombre${id} Apellido${id}`, position: 'F', number: 9, age: 24, rating: 88, teamId: team, teamName: `Equipo ${team}` });

describe('chismes', () => {
  it('genera notas completas, sin huecos', () => {
    const rng = createRng(7);
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const g = generateGossip(rng, { player: pl('1', 'a'), mate: pl('2', 'a'), other: pl('3', 'b'), rival: { id: 'c', name: 'Rival' } });
      expect(g.title.length).toBeGreaterThan(10);
      expect(g.body.length).toBeGreaterThan(80);
      expect(`${g.title} ${g.body}`).not.toMatch(/undefined|NaN|\$\{/);
      expect(g.playerId).toBe('1');
      seen.add(g.category);
    }
    expect(GOSSIP_TEMPLATE_COUNT).toBeGreaterThanOrEqual(25);
    expect(seen.size).toBeGreaterThanOrEqual(7);
  });
});
