// Utilidades de fecha y hora para America/Bogota.
// Colombia no tiene horario de verano: el offset es siempre -05:00.
// Por eso podemos construir fechas con un offset fijo sin librerías externas.

export const TIME_ZONE = 'America/Bogota';
export const UTC_OFFSET = '-05:00';

/** Fecha de hoy en Bogotá como 'YYYY-MM-DD'. No usa toISOString(), que da la fecha en UTC. */
export function todayInBogota(now: Date = new Date()): string {
  // 'en-CA' formatea como YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Día de la semana de una fecha 'YYYY-MM-DD' (0 = domingo ... 6 = sábado). */
export function weekdayOf(date: string): number {
  // Medianoche UTC de ese día calendario: getUTCDay da el día de esa fecha, sin depender de la zona.
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Construye el instante de una hora local de Bogotá. minutes = minutos desde las 00:00 (ej. 9:30 = 570). */
export function bogotaDateTime(date: string, minutes: number): Date {
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return new Date(`${date}T${hh}:${mm}:00${UTC_OFFSET}`);
}

/** Descompone un instante en fecha y minutos del día según la hora de Bogotá. */
export function toBogotaParts(instant: Date): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/** Formatea un instante como ISO con offset de Bogotá: '2026-11-24T15:30:00-05:00'. */
export function formatBogota(instant: Date): string {
  const { date, minutes } = toBogotaParts(instant);
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `${date}T${hh}:${mm}:00${UTC_OFFSET}`;
}
