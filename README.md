# Barber Booking Agent

A console chat agent that books barbershop appointments in natural language, built with **Gemini function calling** (`@google/genai`) on top of a small TypeScript booking service.

> Personal demo project with fictional data (barbers, services and clients are made up).

```
Tú: con carlos para hoy a las 4 pm
  [log] listarHorarios({"barberId":"carlos","serviceId":"corte","date":"2026-11-25"}) -> 68 ms {...}
Agente: Para confirmar tu cita con Carlos para hoy a las 4:00 PM, indícame tu nombre completo y tu celular.
Tú: ivan cabeza, telefono es 3218816736

Vas a RESERVAR esta cita:
  Barbero:  Carlos
  Servicio: Corte (30 min)
  Fecha:    miércoles, 25 de noviembre, 4:00 p. m.
  Precio:   $25.000 COP
¿Confirmas? Escribe "sí" para continuar: si
Agente: ¡Listo! Tu cita ha quedado reservada (ID A001).
```

## How it works

1. The user writes a message in the console (`src/cli.ts`).
2. The agent (`src/agent/agent.ts`) sends the conversation, a system prompt with today's date in `America/Bogota`, and five tool declarations to Gemini.
3. The model either answers with text or asks to call a tool.
4. **My code validates the arguments with Zod** (`src/agent/tools.ts`). Invalid arguments never reach the business logic; the validation error goes back to the model so it can correct itself.
5. Before `reservarCita` or `cancelarCita`, the CLI shows a summary and **only runs it if the user types "sí"**.
6. The booking service (`src/api/booking.service.ts`) applies the business rules and returns a result or a typed error (`CONFLICT`, `OUTSIDE_HOURS`, `IN_PAST`...).
7. The result goes back to the model, up to **6 steps per message**.

Key idea: **the model decides what to do; the code decides whether it can be done.** The rules live in code, not in the prompt.

## Tech stack

Node.js 22+, TypeScript, `tsx`, `@google/genai` (Gemini function calling), Zod 4. Data is in memory.

## Tools exposed to the model

| Tool | What it does |
| --- | --- |
| `listarBarberosYServicios` | Barbers, working days, services, duration and price |
| `listarHorarios` | Free start times for a barber, service and date |
| `reservarCita` | Books an appointment (requires confirmation) |
| `cancelarCita` | Cancels an active appointment (requires confirmation) |
| `misCitas` | Lists a client's appointments by phone |

The Gemini declarations are generated from the Zod schemas with `z.toJSONSchema()`, so the same schema validates the input and describes it to the model.

## Guardrails

- **Deterministic business rules:** inside business hours (Tue–Sat, 9:00–19:00 Bogotá) and the barber's working days, no overlapping active appointments for the same barber, no bookings in the past, end time computed from the service duration, only active appointments can be cancelled.
- **Argument validation with Zod** before any tool runs (IDs as enums, ISO dates, datetimes with offset, phone format).
- **Human confirmation in code**, not just in the prompt.
- **Step limit** of 6 model calls per message.
- **Retries:** SDK `retryOptions` with exponential backoff for 408/429/5xx, plus an optional fallback model.
- **Logs:** every step logs the model, latency and token usage; every tool call logs its arguments and whether validation passed.

## How to run

```bash
git clone https://github.com/ivandex16/barber-booking-agent.git
cd barber-booking-agent
npm install
cp .env.example .env      # then set GEMINI_API_KEY (and optionally GEMINI_FALLBACK_MODEL)
npm run agent
```

Other scripts:

```bash
npm run try:booking   # checks the booking rules without calling Gemini
npm run try:tools     # checks the Zod schemas without calling Gemini
npm run typecheck
```

Set `AGENT_LOGS=off` to hide the `[log]` lines.

## What broke first (and how I fixed it)

Real problems found while building and testing this project:

1. **"Today" was the wrong day after 7 PM.** The first version built the date with `new Date().toISOString()`, which returns the UTC date. In Bogotá (UTC-5) that is already tomorrow from 7 PM on, so "mañana" would have meant the day after. *Fix:* compute the date with `Intl.DateTimeFormat` in `America/Bogota`.
2. **Loose schemas let bad input crash the service.** With `z.string()` everywhere, `date: "mañana"` passed validation and crashed `listarHorarios` with `RangeError: Invalid time value`, and a phone like `12345` was booked. *Fix:* strict Zod schemas (`z.iso.date()`, enums for IDs, regex for phone and appointment ID).
3. **Times without an offset changed meaning by machine.** `2026-12-01T10:00:00` (no offset) was parsed in the machine's time zone; on a UTC machine it became 5:00 AM in Bogotá and the user got a confusing "outside business hours" error. *Fix:* `z.iso.datetime({ offset: true })` rejects it, and the model resends the time with `-05:00`.
4. **Gemini returned 503 "high demand" and one retry was not enough.** *Fix:* enabled the SDK's built-in exponential backoff (`httpOptions.retryOptions`) and added an optional fallback model. To avoid mixing models inside a tool-calling turn, the fallback only kicks in at the first step of a turn, only once per session, and the previous model's thought signatures are stripped from the history when it switches.
5. **The model assumed a service.** When the user said "con Carlos para hoy a las 4 pm" without choosing a service, the model picked "corte" on its own. The confirmation step caught it before booking, but it should ask. *Fix:* added an explicit prompt rule to never assume the service or the barber.

Observed latency with the fallback model: 1–15 s per model step, so a booking takes several seconds end to end.

## Next steps

- Express REST API in front of the booking service, and SQLite instead of in-memory data.
- Automated tests with Jest (booking rules and the agent loop with a mocked model).
- MCP server exposing the same tools.
- Streaming responses to reduce perceived latency.
