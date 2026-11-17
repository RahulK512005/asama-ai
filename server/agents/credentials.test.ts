import { describe, expect, it } from "vitest";
import {
  assertAgentPermission,
  createAgentToken,
  hashAgentToken,
  INITIAL_AGENT_SCOPES,
  isValidAgentTokenFormat,
  tokenFromAuthorizationHeader,
} from "./credentials";
import type { AgentScope } from "../../drizzle/schema";

const scopes: AgentScope[] = ["posts:write", "notifications:read"];
const baseAgent = {
  id: 7,
  name: "PhonePe",
  organization: "PhonePe",
  verificationStatus: "verified" as const,
  scopes,
};

describe("agent credentials and permission policy", () => {
  it("generates unguessable token material and exposes only a one-way hash for storage", () => {
    const a = createAgentToken();
    const b = createAgentToken();
    expect(a.token).not.toBe(b.token);
    expect(isValidAgentTokenFormat(a.token)).toBe(true);
    expect(a.tokenHash).toBe(hashAgentToken(a.token));
    expect(a.tokenHash).not.toContain(a.token);
    expect(a.tokenPrefix).toBe(a.token.slice(0, 13));
  });

  it("accepts only a correctly formatted bearer token", () => {
    const token = createAgentToken().token;
    expect(tokenFromAuthorizationHeader(`Bearer ${token}`)).toBe(token);
    expect(tokenFromAuthorizationHeader("Basic abc")).toBeNull();
    expect(tokenFromAuthorizationHeader("Bearer nope")).toBeNull();
  });

  it("keeps the initial agent credential read-only", () => {
    expect(INITIAL_AGENT_SCOPES).toEqual(["agents:read", "posts:read", "notifications:read"]);
    expect(INITIAL_AGENT_SCOPES).not.toContain("posts:write");
    expect(INITIAL_AGENT_SCOPES).not.toContain("comments:write");
  });

  it("requires both the requested scope and verification for posting", () => {
    expect(assertAgentPermission(baseAgent, "posts:write", { requiresVerified: true }))
      .toEqual({ allowed: true });
    expect(assertAgentPermission({ ...baseAgent, scopes: ["agents:read"] }, "posts:write"))
      .toMatchObject({ allowed: false, status: 403, code: "missing_scope" });
    expect(assertAgentPermission({ ...baseAgent, verificationStatus: "pending" }, "posts:write", { requiresVerified: true }))
      .toMatchObject({ allowed: false, status: 403, code: "agent_not_verified" });
    expect(assertAgentPermission({ ...baseAgent, verificationStatus: "suspended" }, "posts:write"))
      .toMatchObject({ allowed: false, status: 403, code: "agent_suspended" });
  });
});
