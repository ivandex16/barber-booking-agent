// Prueba manual rápida de las reglas (no es Jest; eso viene después).
// Uso: npm run try:booking
import { reservarCita, listarHorarios, cancelarCita } from '../src/api/booking.service';

const now = new Date('2026-11-23T12:00:00-05:00'); // lunes 23 a mediodía
const base = { clientName: 'Cliente Demo', clientPhone: '3001234567' };

const check = (label: string, got: unknown, expected: unknown) =>
  console.log(`${got === expected ? 'OK  ' : 'FAIL'} ${label} -> ${String(got)} (esperado ${String(expected)})`);

const r1 = reservarCita({ ...base, barberId: 'carlos', serviceId: 'corte', start: '2026-11-24T10:00:00-05:00' }, now);
check('reserva libre', r1.ok, true);

const r2 = reservarCita({ ...base, barberId: 'carlos', serviceId: 'barba', start: '2026-11-24T10:20:00-05:00' }, now);
check('cruce con otra cita', r2.ok ? 'ok' : r2.code, 'CONFLICT');

const r3 = reservarCita({ ...base, barberId: 'carlos', serviceId: 'barba', start: '2026-11-24T10:30:00-05:00' }, now);
check('pegada justo al final (no se cruza)', r3.ok, true);

const r4 = reservarCita({ ...base, barberId: 'andres', serviceId: 'corte', start: '2026-11-24T10:00:00-05:00' }, now);
check('mismo horario, otro barbero', r4.ok, true);

const r5 = reservarCita({ ...base, barberId: 'carlos', serviceId: 'corte-barba', start: '2026-11-24T18:30:00-05:00' }, now);
check('termina después de las 19:00', r5.ok ? 'ok' : r5.code, 'OUTSIDE_HOURS');

const r6 = reservarCita({ ...base, barberId: 'carlos', serviceId: 'corte', start: '2026-11-21T10:00:00-05:00' }, now);
check('en el pasado', r6.ok ? 'ok' : r6.code, 'IN_PAST');

const slots = listarHorarios({ barberId: 'carlos', serviceId: 'corte', date: '2026-11-24' }, now);
check('disponibilidad no muestra 10:00', slots.ok && slots.data.slots.includes('2026-11-24T10:00:00-05:00'), false);

if (r1.ok) {
  check('cancelar activa', cancelarCita({ appointmentId: r1.data.id }).ok, true);
  const again = cancelarCita({ appointmentId: r1.data.id });
  check('cancelar dos veces', again.ok ? 'ok' : again.code, 'ALREADY_CANCELLED');
  const r7 = reservarCita({ ...base, barberId: 'carlos', serviceId: 'corte', start: '2026-11-24T10:00:00-05:00' }, now);
  check('la cancelada ya no bloquea', r7.ok, true);
}
