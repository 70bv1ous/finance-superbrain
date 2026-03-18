/**
 * Briefing & Feedback routes (#4 + #6).
 *
 *  GET  /v1/briefing          — upcoming macro events + pre-event analysis
 *  POST /v1/outcome           — mark a past prediction correct/incorrect
 *  GET  /v1/accuracy          — brain accuracy stats
 *  GET  /v1/usage             — daily query usage (cost guard status)
 */

import type { FastifyInstance } from "fastify";
import type { AppServices }     from "../lib/services.js";
import { getUpcomingEvents, formatUpcomingEvents } from "../lib/eventCalendar.js";
import { resolveOutcome, getAccuracyStats }        from "../lib/predictionTracker.js";
import { getDailyUsage }                           from "../lib/chatService.js";
import { processChat }                             from "../lib/chatService.js";

export const registerBriefingRoutes = async (
  server: FastifyInstance,
  services: AppServices,
): Promise<void> => {

  // ── GET /v1/briefing ──────────────────────────────────────────────────────
  server.get("/v1/briefing", async (_request, reply) => {
    const events    = getUpcomingEvents(14);
    const formatted = formatUpcomingEvents(events);

    // If there's an ANTHROPIC_API_KEY, also generate AI analysis for the next event
    const apiKey = process.env.ANTHROPIC_API_KEY;
    let aiAnalysis: any = null;

    if (apiKey && events.length > 0) {
      const nextEvent = events[0];
      try {
        aiAnalysis = await processChat(
          {
            query: `Pre-event briefing: ${nextEvent.name} is ${
              Math.ceil((nextEvent.date.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
            } day(s) away. ${nextEvent.description} What are the key scenarios, historical precedents, and trade setups to watch?`,
          },
          services.repository,
          apiKey,
        );
      } catch {
        aiAnalysis = null;
      }
    }

    return reply.send({
      upcoming_events: events.map(e => ({
        name:        e.name,
        event_type:  e.event_type,
        date:        e.date.toISOString(),
        days_away:   Math.ceil((e.date.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
        description: e.description,
      })),
      formatted_summary: formatted,
      next_event_analysis: aiAnalysis,
    });
  });

  // ── POST /v1/outcome ──────────────────────────────────────────────────────
  server.post("/v1/outcome", async (request, reply) => {
    const body = request.body as any;
    const { session_id, outcome, notes } = body ?? {};

    if (!session_id || typeof session_id !== "string") {
      return reply.status(400).send({ error: "session_id required" });
    }
    if (!["correct", "incorrect", "partial"].includes(outcome)) {
      return reply.status(400).send({ error: "outcome must be 'correct', 'incorrect', or 'partial'" });
    }

    const updated = await resolveOutcome(session_id, outcome, notes ?? "");
    if (!updated) {
      return reply.status(404).send({ error: "prediction not found or already resolved" });
    }

    return reply.send({ ok: true, session_id, outcome });
  });

  // ── GET /v1/accuracy ─────────────────────────────────────────────────────
  server.get("/v1/accuracy", async (_request, reply) => {
    const stats = await getAccuracyStats();
    return reply.send(stats);
  });

  // ── GET /v1/usage ─────────────────────────────────────────────────────────
  server.get("/v1/usage", async (_request, reply) => {
    const usage = getDailyUsage();
    return reply.send({
      ...usage,
      cost_estimate_usd: parseFloat((usage.used * 0.0015).toFixed(4)),
      reset_time: "midnight UTC",
    });
  });
};
