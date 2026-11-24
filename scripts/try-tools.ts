// Prueba los esquemas Zod sin llamar a Gemini.
// Uso: npm run try:tools
import { executeTool, functionDeclarations } from '../src/agent/tools';
import { todayInBogota, weekdayOf } from '../src/api/time';

// Próximo martes (la barbería abre ese día y trabajan Carlos y Andrés).
const today = todayInBogota();
let d = new Date(`${today}T12:00:00Z`);
do d = new Date(d.getTime() + 86_400_000); while (weekdayOf(d.toISOString().slice(0, 10)) !== 2);
const tuesday = d.toISOString().slice(0, 10);

console.log('--- Lo que ve Gemini (declaraciones) ---');
console.log(JSON.stringify(functionDeclarations, null, 2));

const cases: [string, string, unknown, 'valid' | 'invalid'][] = [
  ['listar catálogo', 'listarBarberosYServicios', {}, 'valid'],
  ['horarios válidos', 'listarHorarios', { barberId: 'carlos', serviceId: 'corte', date: tuesday }, 'valid'],
  ['fecha "mañana"', 'listarHorarios', { barberId: 'carlos', serviceId: 'corte', date: 'mañana' }, 'invalid'],
  ['barbero inventado', 'listarHorarios', { barberId: 'pedro', serviceId: 'corte', date: tuesday }, 'invalid'],
  ['falta serviceId', 'listarHorarios', { barberId: 'carlos', date: tuesday }, 'invalid'],
  ['reserva válida', 'reservarCita', { barberId: 'carlos', serviceId: 'corte', start: `${tuesday}T10:00:00-05:00`, clientName: 'Cliente Demo', clientPhone: '3001234567' }, 'valid'],
  ['hora sin offset', 'reservarCita', { barberId: 'carlos', serviceId: 'corte', start: `${tuesday}T10:00:00`, clientName: 'Cliente Demo', clientPhone: '3001234567' }, 'invalid'],
  ['celular corto', 'reservarCita', { barberId: 'carlos', serviceId: 'corte', start: `${tuesday}T11:00:00-05:00`, clientName: 'Cliente Demo', clientPhone: '12345' }, 'invalid'],
  ['nombre vacío', 'reservarCita', { barberId: 'carlos', serviceId: 'corte', start: `${tuesday}T11:00:00-05:00`, clientName: '', clientPhone: '3001234567' }, 'invalid'],
  ['cancelar id válido', 'cancelarCita', { appointmentId: 'A001' }, 'valid'],
  ['cancelar id raro', 'cancelarCita', { appointmentId: 'cita-1' }, 'invalid'],
  ['mis citas', 'misCitas', { clientPhone: '3001234567' }, 'valid'],
  ['herramienta inexistente', 'borrarTodo', {}, 'invalid'],
];

console.log('\n--- Validación ---');
for (const [label, name, args, expected] of cases) {
  const out = executeTool(name, args) as { error?: string };
  const got = out && typeof out === 'object' && 'error' in out && (out.error === 'invalid_arguments' || out.error === 'unknown_tool') ? 'invalid' : 'valid';
  console.log(`${got === expected ? 'OK  ' : 'FAIL'} ${label} -> ${got} (esperado ${expected})`);
  if (got !== expected) console.log('     ', JSON.stringify(out));
}
