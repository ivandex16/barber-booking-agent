// Reglas de negocio de la barbería. Todo lo determinístico vive aquí, no en el prompt.
// El agente (o más adelante Express o MCP) solo llama estas funciones.

import {
  appointments,
  barbers,
  services,
  BUSINESS_HOURS,
  nextAppointmentId,
  type Appointment,
  type Weekday,
} from "./db";
import { bogotaDateTime, formatBogota, toBogotaParts, weekdayOf } from "./time";

export type ErrorCode =
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "OUTSIDE_HOURS"
  | "IN_PAST"
  | "CONFLICT"
  | "ALREADY_CANCELLED";

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; code: ErrorCode; message: string };

const fail = (
  code: ErrorCode,
  message: string,
): { ok: false; code: ErrorCode; message: string } => ({
  ok: false,
  code,
  message,
});

/** Lo que ve el modelo de una cita: fechas como texto con offset de Bogotá. */
export interface AppointmentView {
  id: string;
  barber: string;
  service: string;
  priceCOP: number;
  clientName: string;
  clientPhone: string;
  start: string;
  end: string;
  status: Appointment["status"];
}

function toView(a: Appointment): AppointmentView {
  const barber = barbers.find((b) => b.id === a.barberId);
  const service = services.find((s) => s.id === a.serviceId);
  return {
    id: a.id,
    barber: barber?.name ?? a.barberId,
    service: service?.name ?? a.serviceId,
    priceCOP: service?.priceCOP ?? 0,
    clientName: a.clientName,
    clientPhone: a.clientPhone,
    start: formatBogota(a.start),
    end: formatBogota(a.end),
    status: a.status,
  };
}

// ---------------------------------------------------------------------------
// REGLA 2: NO CRUZAR CITAS (la escribes tú)
// ---------------------------------------------------------------------------
/**
 * Devuelve true si el intervalo [start, end) del barbero se cruza con alguna
 * cita ACTIVA ('booked') de ese MISMO barbero. Las canceladas no cuentan.
 *
 * Una cita que termina exactamente cuando empieza otra NO se cruza
 * (10:00-10:30 y 10:30-11:00 son válidas una después de la otra).
 */
export function hayCruce(barberId: string, start: Date, end: Date): boolean {
  const cruce = appointments.some(
    (a) =>
      a.barberId === barberId &&
      a.status === "booked" &&
      start < a.end &&
      end > a.start,
  );

  return cruce;
}

// ---------------------------------------------------------------------------
// Reglas 1, 3 y 4 (horario, pasado, hora de fin)
// ---------------------------------------------------------------------------

/** Regla 1: la cita completa cae dentro del horario de la barbería y del día del barbero. */
function dentroDeHorario(
  barberWorkDays: Weekday[],
  start: Date,
  end: Date,
): string | null {
  const s = toBogotaParts(start);
  const e = toBogotaParts(end);
  const day = weekdayOf(s.date) as Weekday;

  if (!BUSINESS_HOURS.days.includes(day))
    return "La barbería abre de martes a sábado.";
  if (!barberWorkDays.includes(day)) return "Ese barbero no trabaja ese día.";
  if (s.date !== e.date) return "La cita debe empezar y terminar el mismo día.";
  if (
    s.minutes < BUSINESS_HOURS.openMin ||
    e.minutes > BUSINESS_HOURS.closeMin
  ) {
    return "La cita debe quedar completa entre 9:00 y 19:00.";
  }
  if (s.minutes % BUSINESS_HOURS.slotStepMin !== 0)
    return "La hora de inicio debe ir en bloques de 10 minutos.";
  return null;
}

// ---------------------------------------------------------------------------
// Funciones públicas (las que usan las herramientas del agente)
// ---------------------------------------------------------------------------

export function listarBarberosYServicios() {
  return {
    ok: true as const,
    data: {
      horario: "Martes a sábado, 9:00 a 19:00 (America/Bogota)",
      barberos: barbers.map((b) => ({
        id: b.id,
        nombre: b.name,
        diasDeTrabajo: b.workDays,
      })),
      servicios: services.map((s) => ({
        id: s.id,
        nombre: s.name,
        duracionMin: s.durationMin,
        precioCOP: s.priceCOP,
      })),
      nota: "diasDeTrabajo: 0=domingo, 1=lunes, 2=martes, 3=miércoles, 4=jueves, 5=viernes, 6=sábado",
    },
  };
}

/** Horarios de inicio libres para un barbero, un servicio y una fecha 'YYYY-MM-DD'. */
export function listarHorarios(
  input: { barberId: string; serviceId: string; date: string },
  now: Date = new Date(),
): Result<{ date: string; barber: string; service: string; slots: string[] }> {
  const barber = barbers.find((b) => b.id === input.barberId);
  if (!barber)
    return fail("NOT_FOUND", `No existe el barbero '${input.barberId}'.`);
  const service = services.find((s) => s.id === input.serviceId);
  if (!service)
    return fail("NOT_FOUND", `No existe el servicio '${input.serviceId}'.`);

  const slots: string[] = [];
  for (
    let m = BUSINESS_HOURS.openMin;
    m + service.durationMin <= BUSINESS_HOURS.closeMin;
    m += BUSINESS_HOURS.slotStepMin
  ) {
    const start = bogotaDateTime(input.date, m);
    const end = new Date(start.getTime() + service.durationMin * 60_000);
    if (start <= now) continue; // regla 3
    if (dentroDeHorario(barber.workDays, start, end)) continue; // regla 1
    if (hayCruce(barber.id, start, end)) continue; // regla 2
    slots.push(formatBogota(start));
  }
  return {
    ok: true,
    data: {
      date: input.date,
      barber: barber.name,
      service: service.name,
      slots,
    },
  };
}

export function reservarCita(
  input: {
    barberId: string;
    serviceId: string;
    start: string;
    clientName: string;
    clientPhone: string;
  },
  now: Date = new Date(),
): Result<AppointmentView> {
  const barber = barbers.find((b) => b.id === input.barberId);
  if (!barber)
    return fail("NOT_FOUND", `No existe el barbero '${input.barberId}'.`);
  const service = services.find((s) => s.id === input.serviceId);
  if (!service)
    return fail("NOT_FOUND", `No existe el servicio '${input.serviceId}'.`);

  const start = new Date(input.start);
  if (Number.isNaN(start.getTime()))
    return fail("INVALID_INPUT", "La fecha de inicio no es válida.");
  // Regla 4: el fin se calcula con la duración del servicio; el cliente no lo manda.
  const end = new Date(start.getTime() + service.durationMin * 60_000);

  if (start <= now)
    return fail("IN_PAST", "No se puede reservar en el pasado."); // regla 3
  const fueraDeHorario = dentroDeHorario(barber.workDays, start, end); // regla 1
  if (fueraDeHorario) return fail("OUTSIDE_HOURS", fueraDeHorario);
  if (hayCruce(barber.id, start, end)) {
    return fail(
      "CONFLICT",
      "Ese horario ya está ocupado para ese barbero. Consulta otros horarios.",
    ); // regla 2
  }

  const appointment: Appointment = {
    id: nextAppointmentId(),
    barberId: barber.id,
    serviceId: service.id,
    clientName: input.clientName,
    clientPhone: input.clientPhone,
    start,
    end,
    status: "booked",
  };
  appointments.push(appointment);
  return { ok: true, data: toView(appointment) };
}

/** Regla 5: solo se cancela una cita que exista y esté activa. */
export function cancelarCita(input: {
  appointmentId: string;
}): Result<AppointmentView> {
  const appointment = appointments.find((a) => a.id === input.appointmentId);
  if (!appointment)
    return fail("NOT_FOUND", `No existe la cita '${input.appointmentId}'.`);
  if (appointment.status !== "booked")
    return fail("ALREADY_CANCELLED", "Esa cita ya estaba cancelada.");
  appointment.status = "cancelled";
  return { ok: true, data: toView(appointment) };
}

export function misCitas(input: {
  clientPhone: string;
}): Result<AppointmentView[]> {
  const list = appointments
    .filter((a) => a.clientPhone === input.clientPhone)
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .map(toView);
  return { ok: true, data: list };
}
