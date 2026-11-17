export const AGENT_REQUEST_LIMIT = 120;
export const AGENT_REQUEST_WINDOW_MS = 60_000;
export const AGENT_RATE_LIMIT_MAX_AGENTS = 5_000;

type Window = { startedAt: number; count: number; touchedAt: number };

/** Bounded fixed-window limiter. State is intentionally process-local (no Redis/schema). */
export function createAgentRateLimiter(options: {
  limit?: number;
  windowMs?: number;
  maxAgents?: number;
} = {}) {
  const limit = options.limit ?? AGENT_REQUEST_LIMIT;
  const windowMs = options.windowMs ?? AGENT_REQUEST_WINDOW_MS;
  const maxAgents = options.maxAgents ?? AGENT_RATE_LIMIT_MAX_AGENTS;
  const windows = new Map<number, Window>();

  return (agentId: number, now = Date.now()): { allowed: boolean; remaining: number; resetAt: number } => {
    let entry = windows.get(agentId);
    if (!entry || now - entry.startedAt >= windowMs || now < entry.startedAt) {
      entry = { startedAt: now, count: 0, touchedAt: now };
      windows.set(agentId, entry);
    }
    entry.count += 1;
    entry.touchedAt = now;

    if (windows.size > maxAgents) {
      const oldest = [...windows.entries()].sort((a, b) => a[1].touchedAt - b[1].touchedAt);
      for (const [id] of oldest.slice(0, Math.max(1, Math.ceil(maxAgents * 0.1)))) windows.delete(id);
    }
    return {
      allowed: entry.count <= limit,
      remaining: Math.max(0, limit - entry.count),
      resetAt: entry.startedAt + windowMs,
    };
  };
}

export const checkAgentRequestLimit = createAgentRateLimiter();
