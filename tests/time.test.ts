// Primeras pruebas: utilidades de fecha de Bogotá (src/api/time.ts).
// Molde de una prueba: describe agrupa, test es un caso, expect compara lo obtenido con lo esperado.

import { bogotaDateTime, formatBogota, todayInBogota, toBogotaParts, weekdayOf } from '../src/api/time';

describe('todayInBogota', () => {
  test('a las 8 pm de Bogotá sigue siendo hoy, aunque en UTC ya sea mañana', () => {
    // What broke first #1: toISOString() daba la fecha en UTC.
    const now = new Date('2026-11-24T20:00:00-05:00'); // = 2026-11-25T01:00Z
    expect(now.toISOString().slice(0, 10)).toBe('2026-11-25'); // el bug
    expect(todayInBogota(now)).toBe('2026-11-24'); // lo correcto
  });
});

describe('weekdayOf', () => {
  test('2026-12-01 es martes (2)', () => {
    expect(weekdayOf('2026-12-01')).toBe(2);
  });
});

describe('bogotaDateTime y formatBogota', () => {
  test('9:30 en Bogotá es 14:30 en UTC', () => {
    const d = bogotaDateTime('2026-12-01', 9 * 60 + 30);
    expect(d.toISOString()).toBe('2026-12-01T14:30:00.000Z');
  });

  test('formatBogota devuelve ISO con offset -05:00', () => {
    const d = new Date('2026-12-01T14:30:00Z');
    expect(formatBogota(d)).toBe('2026-12-01T09:30:00-05:00');
  });

  test('toBogotaParts da fecha y minutos del día en Bogotá', () => {
    expect(toBogotaParts(new Date('2026-12-02T01:00:00Z'))).toEqual({ date: '2026-12-01', minutes: 20 * 60 });
  });
});
