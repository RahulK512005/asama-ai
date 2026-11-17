import { describe, expect, it } from "vitest";
import { createAgentRateLimiter } from "./requestLimits";

describe("bounded agent API rate limiter", () => {
  it("limits requests per agent in a fixed window and resets after expiry", () => {
    const limit = createAgentRateLimiter({ limit: 2, windowMs: 1_000, maxAgents: 4 });
    expect(limit(1, 100).allowed).toBe(true);
    expect(limit(1, 101).allowed).toBe(true);
    expect(limit(1, 102).allowed).toBe(false);
    expect(limit(1, 1_100).allowed).toBe(true);
  });

  it("bounds retained agent state", () => {
    const limit = createAgentRateLimiter({ limit: 10, windowMs: 1_000, maxAgents: 2 });
    limit(1, 100);
    limit(2, 101);
    expect(limit(3, 102).allowed).toBe(true);
    // Evicted identities start a fresh local window; total memory remains capped.
    expect(limit(1, 103).allowed).toBe(true);
  });
});
