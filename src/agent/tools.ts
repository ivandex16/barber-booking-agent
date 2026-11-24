// Puente entre Gemini y booking.service.ts.
// 1) Esquemas Zod: validan lo que manda el modelo (los escribe ivan).
// 2) Declaraciones para Gemini: se generan desde esos mismos esquemas con z.toJSONSchema().
// 3) validateArgs / runTool / executeTool: validan y, solo si pasa, llaman al servicio.

import { z } from "zod";
import type { FunctionDeclaration } from "@google/genai";
import {
  cancelarCita,
  listarBarberosYServicios,
  listarHorarios,
  misCitas,
  reservarCita,
} from "../api/booking.service";

// ---------------------------------------------------------------------------
// 1) ESQUEMAS ZOD (los escribes tú)
// Cada campo necesita .describe('...'): ese texto es lo que lee el modelo.
// Los nombres de los campos deben coincidir con lo que reciben las funciones del servicio.
// ---------------------------------------------------------------------------

const BarberId = z
  .enum(["carlos", "andres", "luis"])
  .describe("Id del barbero , ej. carlos");

const ClientPhone = z
  .string()
  .regex(/^3\d{9}$/)
  .describe("Celular colombiano de 10 dígitos, ej. 3001234567");

// Sin argumentos.
export const ListarBarberosYServiciosArgs = z.object({}); // TODO(ivan): ¿hace falta algo más aquí?

// barberId, serviceId, date ('YYYY-MM-DD').
export const ListarHorariosArgs = z.object({
  barberId: BarberId,
  serviceId: z.string(),
  date: z.iso.date().describe("Fecha en formato YYYY-MM-DD, ej. 2026-11-25"),
}); // TODO(ivan)

// barberId, serviceId, start (ISO con offset, ej. 2026-11-24T15:30:00-05:00), clientName, clientPhone (3 + 9 dígitos).
export const ReservarCitaArgs = z.object({
  barberId: BarberId,
  serviceId: z.string(),
  start: z.iso.datetime({ offset: true }),
  clientName: z.string().min(2),
  clientPhone: ClientPhone,
});

// appointmentId (formato A001).
export const CancelarCitaArgs = z.object({
  appointmentId: z.string().regex(/^A\d+$/),
});

// clientPhone.
export const MisCitasArgs = z.object({
  clientPhone: ClientPhone,
});

// ---------------------------------------------------------------------------
// 2) Registro de herramientas. La descripción de cada herramienta también es "prompt".
// ---------------------------------------------------------------------------

interface ToolDef {
  description: string;
  schema: z.ZodType;
  // Recibe args YA validados por Zod. El cast a cada función es seguro por eso.
  run: (args: any) => unknown;
}

const TOOLS = {
  listarBarberosYServicios: {
    description:
      "Lista los barberos (id, nombre, días de trabajo) y los servicios (id, nombre, duración en minutos, precio en COP). " +
      "Úsala primero para conocer los IDs válidos antes de consultar horarios o reservar.",
    schema: ListarBarberosYServiciosArgs,
    run: () => listarBarberosYServicios(),
  },
  listarHorarios: {
    description:
      "Devuelve las horas de inicio libres de un barbero para un servicio en una fecha. " +
      "La fecha va en formato YYYY-MM-DD (hora de Bogotá). Nunca inventes horarios: usa siempre esta herramienta.",
    schema: ListarHorariosArgs,
    run: (args) => listarHorarios(args),
  },
  reservarCita: {
    description:
      "Reserva una cita. start es la hora de inicio en ISO 8601 con offset de Bogotá (ej. 2026-11-24T15:30:00-05:00) " +
      "y debe ser uno de los horarios que devolvió listarHorarios. La hora de fin la calcula el sistema. " +
      "Pide nombre y celular al cliente antes de usarla.",
    schema: ReservarCitaArgs,
    run: (args) => reservarCita(args),
  },
  cancelarCita: {
    description:
      "Cancela una cita activa por su id (ej. A001). Si no conoces el id, usa primero misCitas con el celular del cliente.",
    schema: CancelarCitaArgs,
    run: (args) => cancelarCita(args),
  },
  misCitas: {
    description:
      "Lista las citas (activas y canceladas) de un cliente por su número de celular.",
    schema: MisCitasArgs,
    run: (args) => misCitas(args),
  },
} satisfies Record<string, ToolDef>;

export type ToolName = keyof typeof TOOLS;

/** Herramientas que cambian datos: el agente pide "sí" antes de ejecutarlas. */
export const REQUIRES_CONFIRMATION: ReadonlySet<ToolName> = new Set<ToolName>([
  "reservarCita",
  "cancelarCita",
]);

export function isToolName(name: string): name is ToolName {
  return Object.hasOwn(TOOLS, name);
}

/** Convierte un esquema Zod al JSON Schema que acepta parametersJsonSchema. */
function toGeminiSchema(schema: z.ZodType): unknown {
  const { $schema, ...rest } = z.toJSONSchema(schema) as Record<
    string,
    unknown
  >;
  void $schema; // Gemini no necesita la URL del dialecto.
  return rest;
}

export const functionDeclarations: FunctionDeclaration[] = Object.entries(
  TOOLS,
).map(([name, t]) => ({
  name,
  description: t.description,
  parametersJsonSchema: toGeminiSchema(t.schema),
}));

// ---------------------------------------------------------------------------
// 3) Validación y ejecución
// ---------------------------------------------------------------------------

export type Validation =
  | { ok: true; name: ToolName; args: Record<string, unknown> }
  | { ok: false; output: { error: string; details?: unknown } };

/** Valida nombre y argumentos. No ejecuta nada. */
export function validateArgs(name: string, rawArgs: unknown): Validation {
  if (!isToolName(name)) {
    return {
      ok: false,
      output: {
        error: "unknown_tool",
        details: `No existe la herramienta '${name}'.`,
      },
    };
  }
  const schema: z.ZodType = TOOLS[name].schema; // tipo común para que flattenError acepte cualquier esquema
  const parsed = schema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      output: {
        error: "invalid_arguments",
        details: z.flattenError(parsed.error),
      },
    };
  }
  return { ok: true, name, args: parsed.data as Record<string, unknown> };
}

/** Ejecuta una herramienta con argumentos ya validados. */
export function runTool(
  name: ToolName,
  args: Record<string, unknown>,
): unknown {
  return TOOLS[name].run(args);
}

/** Valida y ejecuta. Si la validación falla, devuelve el error sin llamar al servicio. */
export function executeTool(name: string, rawArgs: unknown): unknown {
  const v = validateArgs(name, rawArgs);
  return v.ok ? runTool(v.name, v.args) : v.output;
}
