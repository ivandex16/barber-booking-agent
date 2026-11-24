// Bucle del agente con Gemini (SDK @google/genai) y confirmación humana en código.
//
// Por cada mensaje del usuario:
//   1. Se manda a Gemini el historial + las declaraciones de herramientas.
//   2. Si responde con texto, se termina.
//   3. Si pide herramientas: se validan con Zod; si son reservarCita/cancelarCita
//      se muestra un resumen y solo se ejecutan si el usuario escribe "sí".
//   4. Los resultados vuelven al modelo y se repite, con un máximo de MAX_STEPS pasos.

import { ApiError, GoogleGenAI, type Content, type FunctionCall, type GenerateContentResponse, type Part } from '@google/genai';
import { appointments, barbers, services } from '../api/db';
import { TIME_ZONE, todayInBogota } from '../api/time';
import { functionDeclarations, REQUIRES_CONFIRMATION, runTool, validateArgs, type ToolName } from './tools';

export const MAX_STEPS = 6;

/** Muestra el resumen al usuario y devuelve true solo si confirma. La implementa el CLI. */
export type ConfirmFn = (summary: string) => Promise<boolean>;
/** Recibe una línea de log (herramientas, validación, tiempos, tokens). */
export type LogFn = (line: string) => void;

// ---------------------------------------------------------------------------
// System prompt: fecha y hora de HOY calculadas en Bogotá (no con toISOString, que da UTC).
// ---------------------------------------------------------------------------
export function buildSystemPrompt(now: Date = new Date()): string {
  const fechaLarga = new Intl.DateTimeFormat('es-CO', {
    timeZone: TIME_ZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now);
  const hora = new Intl.DateTimeFormat('es-CO', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now);

  return [
    'Eres el asistente de reservas de una barbería ficticia. Respondes en español, de forma breve y amable.',
    `Hoy es ${fechaLarga} (${todayInBogota(now)}) y son las ${hora}. Zona horaria: ${TIME_ZONE} (UTC-05:00).`,
    'Interpreta "hoy", "mañana", "el viernes", etc. a partir de esa fecha.',
    'La barbería abre de martes a sábado, de 9:00 a 19:00.',
    'Reglas:',
    '- Nunca inventes horarios, IDs ni precios: consúltalos con las herramientas.',
    '- Usa listarBarberosYServicios para conocer los IDs antes de consultar horarios o reservar.',
    '- Para reservar necesitas barbero, servicio, hora (de listarHorarios), nombre y celular del cliente. Pide lo que falte.',
    '- Las fechas van como YYYY-MM-DD y las horas como ISO con offset, ej. 2026-11-25T15:30:00-05:00.',
    '- Si una herramienta devuelve un error, explícalo con palabras simples y propone una alternativa.',
    '- Si el resultado es cancelled_by_user, el cliente no confirmó: no insistas, pregunta qué quiere cambiar.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Resumen legible para la confirmación humana
// ---------------------------------------------------------------------------
function formatFechaHora(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: TIME_ZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function buildConfirmationSummary(name: ToolName, args: Record<string, unknown>): string {
  if (name === 'reservarCita') {
    const barber = barbers.find((b) => b.id === args.barberId);
    const service = services.find((s) => s.id === args.serviceId);
    return [
      'Vas a RESERVAR esta cita:',
      `  Barbero:  ${barber?.name ?? String(args.barberId)}`,
      `  Servicio: ${service?.name ?? String(args.serviceId)}${service ? ` (${service.durationMin} min)` : ''}`,
      `  Fecha:    ${formatFechaHora(String(args.start))}`,
      `  Precio:   ${service ? `$${service.priceCOP.toLocaleString('es-CO')} COP` : 'desconocido'}`,
      `  Cliente:  ${String(args.clientName)} (${String(args.clientPhone)})`,
    ].join('\n');
  }
  if (name === 'cancelarCita') {
    const a = appointments.find((x) => x.id === args.appointmentId);
    if (!a) return `Vas a CANCELAR la cita ${String(args.appointmentId)}.`;
    const barber = barbers.find((b) => b.id === a.barberId);
    const service = services.find((s) => s.id === a.serviceId);
    return [
      `Vas a CANCELAR la cita ${a.id}:`,
      `  Barbero:  ${barber?.name ?? a.barberId}`,
      `  Servicio: ${service?.name ?? a.serviceId}`,
      `  Fecha:    ${formatFechaHora(a.start.toISOString())}`,
      `  Cliente:  ${a.clientName} (${a.clientPhone})`,
    ].join('\n');
  }
  return `Vas a ejecutar ${name}.`;
}

// ---------------------------------------------------------------------------
// El agente
// ---------------------------------------------------------------------------
export class BookingAgent {
  private history: Content[] = [];
  /** Modelo en uso. Solo cambia una vez: del principal al de respaldo, y se queda ahí. */
  private activeModel: string;
  private usingFallback = false;

  constructor(
    private readonly ai: GoogleGenAI,
    model: string,
    private readonly confirm: ConfirmFn,
    private readonly log: LogFn = () => {},
    private readonly fallbackModel?: string,
  ) {
    this.activeModel = model;
  }

  /** Procesa un mensaje del usuario y devuelve la respuesta final del agente. */
  async send(userText: string): Promise<string> {
    const checkpoint = this.history.length; // para deshacer el turno si Gemini falla
    this.history.push({ role: 'user', parts: [{ text: userText }] });

    try {
      for (let step = 1; step <= MAX_STEPS; step++) {
        const res = await this.generate(step);
        const calls = res.functionCalls ?? [];
        const modelContent = res.candidates?.[0]?.content;

        if (calls.length === 0) {
          const text = res.text ?? '';
          this.history.push(modelContent ?? { role: 'model', parts: [{ text }] });
          return text.trim() || '(El modelo no devolvió texto.)';
        }

        // Guardamos el contenido del modelo TAL CUAL llegó: trae las thoughtSignature
        // que Gemini necesita para continuar el razonamiento en el siguiente paso.
        this.history.push(modelContent ?? { role: 'model', parts: calls.map((c) => ({ functionCall: c })) });

        // Todas las respuestas de este paso van juntas en un solo turno 'user'.
        const responses: Part[] = [];
        for (const call of calls) {
          const output = await this.handleCall(call);
          responses.push({ functionResponse: { id: call.id, name: call.name, response: { output } } });
        }
        this.history.push({ role: 'user', parts: responses });
      }

      const fallback = 'No pude completar la solicitud en pocos pasos. ¿Puedes decírmelo de otra forma?';
      this.history.push({ role: 'model', parts: [{ text: fallback }] });
      this.log(`límite de ${MAX_STEPS} pasos alcanzado`);
      return fallback;
    } catch (err) {
      this.history.length = checkpoint; // el turno fallido no queda a medias en el historial
      this.log(`error de Gemini: ${err instanceof Error ? err.message : String(err)}`);
      return 'Lo siento, tuve un problema para responder. ¿Lo intentamos de nuevo?';
    }
  }

  /**
   * Llama a Gemini. Los reintentos con backoff exponencial los hace el SDK (retryOptions en cli.ts).
   * Si aun así el modelo está saturado (429 o 5xx), se pasa al modelo de respaldo, pero SOLO:
   *   - en el paso 1 del turno (todavía no hay functionCall de este turno en el historial), y
   *   - una vez por sesión (después no se vuelve a cambiar).
   * Si falla a mitad del bucle, no se cambia de modelo: el error sube y send() responde con una disculpa.
   */
  private async generate(step: number): Promise<GenerateContentResponse> {
    try {
      return await this.callModel(this.activeModel, step);
    } catch (err) {
      const canFallBack = step === 1 && !this.usingFallback && !!this.fallbackModel && isOverloaded(err);
      if (!canFallBack) throw err;
      this.log(
        `modelo ${this.activeModel} no disponible (HTTP ${(err as ApiError).status}); ` +
          `usando modelo de respaldo ${this.fallbackModel} el resto de la sesión`,
      );
      this.usingFallback = true;
      this.activeModel = this.fallbackModel!;
      this.stripThoughtSignatures();
      return await this.callModel(this.activeModel, step);
    }
  }

  private async callModel(model: string, step: number): Promise<GenerateContentResponse> {
    const t0 = Date.now();
    const res = await this.ai.models.generateContent({
      model,
      contents: this.history,
      config: {
        systemInstruction: buildSystemPrompt(),
        tools: [{ functionDeclarations }],
      },
    });
    const u = res.usageMetadata;
    this.log(
      `paso ${step} [${model}]: ${Date.now() - t0} ms, tokens in=${u?.promptTokenCount ?? '?'} out=${u?.candidatesTokenCount ?? '?'} total=${u?.totalTokenCount ?? '?'}`,
    );
    return res;
  }

  /**
   * Las thoughtSignature son del modelo que las generó. Al cambiar de modelo se quitan del
   * historial (y las partes de razonamiento interno), para que el respaldo no reciba firmas ajenas.
   * Los textos, functionCall y functionResponse se conservan, así no se pierde la conversación.
   */
  private stripThoughtSignatures(): void {
    this.history = this.history
      .map((c) => ({
        ...c,
        parts: (c.parts ?? []).filter((p) => !p.thought).map(({ thoughtSignature: _sig, ...rest }) => rest),
      }))
      .filter((c) => c.parts.length > 0);
  }

  /** Valida, pide confirmación si hace falta y ejecuta una llamada a herramienta. */
  private async handleCall(call: FunctionCall): Promise<unknown> {
    const name = call.name ?? '';
    const v = validateArgs(name, call.args);
    if (!v.ok) {
      this.log(`${name}(${JSON.stringify(call.args)}) -> validación FALLÓ: ${JSON.stringify(v.output.details)}`);
      return v.output; // el modelo recibe el error y puede corregirse; no se ejecuta nada
    }

    if (REQUIRES_CONFIRMATION.has(v.name)) {
      const ok = await this.confirm(buildConfirmationSummary(v.name, v.args));
      if (!ok) {
        this.log(`${v.name} -> cancelada por el usuario`);
        return { cancelled_by_user: true };
      }
    }

    const t0 = Date.now();
    const output = runTool(v.name, v.args);
    this.log(`${v.name}(${JSON.stringify(v.args)}) -> ${Date.now() - t0} ms ${JSON.stringify(output).slice(0, 200)}`);
    return output;
  }
}

/** 429 (cuota/saturación) o 5xx (servidor): vale la pena intentar con otro modelo. Un 400 no. */
function isOverloaded(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 429 || err.status >= 500);
}
