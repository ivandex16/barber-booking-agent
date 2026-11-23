// Datos ficticios en memoria. Se reinician cada vez que arranca el programa.
// Más adelante este archivo se puede reemplazar por SQLite sin tocar booking.service.ts.

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = domingo ... 6 = sábado

export interface Barber {
  id: string;
  name: string;
  workDays: Weekday[];
}

export interface Service {
  id: string;
  name: string;
  durationMin: number;
  priceCOP: number;
}

export type AppointmentStatus = 'booked' | 'cancelled';

export interface Appointment {
  id: string;
  barberId: string;
  serviceId: string;
  clientName: string;
  clientPhone: string;
  start: Date;
  end: Date;
  status: AppointmentStatus;
}

/** Horario de la barbería: martes a sábado, 9:00 a 19:00 (hora de Bogotá), bloques de 10 minutos. */
export const BUSINESS_HOURS = {
  days: [2, 3, 4, 5, 6] as Weekday[],
  openMin: 9 * 60,
  closeMin: 19 * 60,
  slotStepMin: 10,
} as const;

export const barbers: Barber[] = [
  { id: 'carlos', name: 'Carlos', workDays: [2, 3, 4, 5, 6] },
  { id: 'andres', name: 'Andrés', workDays: [2, 3, 4, 5] },
  { id: 'luis', name: 'Luis', workDays: [3, 4, 5, 6] },
];

export const services: Service[] = [
  { id: 'corte', name: 'Corte', durationMin: 30, priceCOP: 25000 },
  { id: 'barba', name: 'Barba', durationMin: 20, priceCOP: 15000 },
  { id: 'corte-barba', name: 'Corte + barba', durationMin: 50, priceCOP: 35000 },
];

export const appointments: Appointment[] = [];

let lastId = 0;
export function nextAppointmentId(): string {
  lastId += 1;
  return `A${String(lastId).padStart(3, '0')}`;
}
