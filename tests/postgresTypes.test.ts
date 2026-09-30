import postgres from 'postgres';
import { expect, it } from 'vitest';

it('retains scalar and nested JSON/JSONB parsing without array-type discovery', async () => {
  // Client construction is lazy; no socket or real database is used.
  const normal = postgres('postgres://test:placeholder@types.invalid/test');
  const worker = postgres('postgres://test:placeholder@types.invalid/test', { fetch_types: false });
  try {
    const json = JSON.stringify({
      tieRules: ['points', 'gd'],
      manualOrder: ['one', 'two'],
      nested: { penalties: [3, 4] },
    });
    for (const [oid, value] of [
      [114, json],
      [3802, json],
      [23, '42'],
      [16, 't'],
      [1184, '2026-10-01T00:00:00.000Z'],
    ] as const) {
      expect(worker.options.parsers[oid](value)).toEqual(normal.options.parsers[oid](value));
    }
    expect(worker.options.parsers[3802](json)).toEqual(JSON.parse(json));
    expect(worker.options.serializers[3802]({ array: [1, 2] })).toBe('{"array":[1,2]}');
  } finally {
    await Promise.all([normal.end(), worker.end()]);
  }
});
