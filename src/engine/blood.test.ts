import { describe, expect, it } from 'vitest';
import { activeTrail, bloodTrails } from './blood';

const pin = (id: string, created: string, coord: [number, number], kind = 'blood', workspace = 'club') => ({ id, kind: kind as 'blood', coord, created, workspace });

describe('blood trails', () => {
  const pins = [
    pin('c', '2026-11-01T17:20:00Z', [-87.3, 34.3009]),
    pin('a', '2026-11-01T17:00:00Z', [-87.3, 34.3]),
    pin('b', '2026-11-01T17:10:00Z', [-87.3, 34.3]),
    pin('x', '2026-11-01T17:05:00Z', [-87.2, 34.3], 'rub'),
    pin('d', '2026-11-03T06:00:00Z', [-87.1, 34.3]),
    pin('o', '2026-11-01T17:15:00Z', [-86.7, 33.7], 'blood', 'wma'),
  ];
  it('orders drops by time, ignores other pins, and splits on a 12 h gap', () => {
    const t = bloodTrails(pins, 'club');
    expect(t.map((x) => x.drops.map((d) => d.id))).toEqual([['a', 'b', 'c'], ['d']]);
    expect(t[0].lengthM).toBeGreaterThan(95);
    expect(t[0].lengthM).toBeLessThan(105);
  });
  it('the latest trail is active for a day after its last drop', () => {
    const t = bloodTrails(pins, 'club');
    expect(activeTrail(t, Date.parse('2026-11-03T20:00:00Z'))?.id).toBe('d');
    expect(activeTrail(t, Date.parse('2026-11-04T07:00:00Z'))).toBeNull();
  });
});
