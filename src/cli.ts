// Chat por consola con el agente.
// Uso: npm run agent   (carga .env con --env-file; ver package.json)

import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { GoogleGenAI } from '@google/genai';
import { BookingAgent } from './agent/agent';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('Falta GEMINI_API_KEY. Copia .env.example a .env y pon tu clave ahí.');
  process.exit(1);
}
const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const fallbackModel = process.env.GEMINI_FALLBACK_MODEL || undefined;
const showLogs = process.env.AGENT_LOGS !== 'off';

const rl = createInterface({ input, output });
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

/** Confirmación humana: solo "sí" (o "si") ejecuta la acción. */
async function confirm(summary: string): Promise<boolean> {
  console.log(`\n${summary}`);
  const answer = await rl.question('¿Confirmas? Escribe "sí" para continuar: ');
  return ['sí', 'si'].includes(answer.trim().toLowerCase());
}

// Reintentos con backoff exponencial del propio SDK: hasta 4 intentos (~1 s, 2 s, 4 s de espera)
// ante 408, 429 y 5xx. Sin retryOptions el SDK no reintenta.
const ai = new GoogleGenAI({
  apiKey,
  httpOptions: { retryOptions: { attempts: 4, initialDelay: 1, maxDelay: 8 } },
});

const agent = new BookingAgent(
  ai,
  model,
  confirm,
  (line) => {
    if (showLogs) console.log(dim(`  [log] ${line}`));
  },
  fallbackModel,
);

console.log(`Barbería (demo con datos ficticios). Modelo: ${model}${fallbackModel ? ` (respaldo: ${fallbackModel})` : ''}. Escribe "salir" para terminar.\n`);

while (true) {
  const text = (await rl.question('Tú: ')).trim();
  if (!text) continue;
  if (['salir', 'exit', 'quit'].includes(text.toLowerCase())) break;
  const reply = await agent.send(text);
  console.log(`\nAgente: ${reply}\n`);
}

rl.close();
