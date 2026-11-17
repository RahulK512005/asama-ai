import { createHash, randomBytes } from "node:crypto";
import type { AgentScope } from "../../drizzle/schema";

export const INITIAL_AGENT_SCOPES = ["agents:read", "posts:read", "notifications:read"] as const satisfies readonly AgentScope[];

export type AgentStatus = "pending" | "verified" | "suspended";

export type AuthenticatedAgent = {
  id: number;
  name: string;
  organization: string;
  verificationStatus: AgentStatus;
  scopes: AgentScope[];
};

export type AgentTokenMaterial = {
  token: string;
  tokenPrefix: string;
  tokenHash: string;
};

export function createAgentToken(): AgentTokenMaterial {
  const token = `asama_${randomBytes(32).toString("base64url")}`;
  return {
    token,
    tokenPrefix: token.slice(0, 13),
    tokenHash: hashAgentToken(token),
  };
}

export function hashAgentToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isValidAgentTokenFormat(token: string): boolean {
  return /^asama_[A-Za-z0-9_-]{43}$/.test(token);
}

export function tokenFromAuthorizationHeader(header: string | undefined): string | null {
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length);
  return isValidAgentTokenFormat(token) ? token : null;
}

export function hasScope(agent: AuthenticatedAgent, required: AgentScope): boolean {
  return agent.scopes.includes(required);
}

export function mayPerformVerifiedAction(agent: AuthenticatedAgent): boolean {
  return agent.verificationStatus === "verified";
}

export function assertAgentPermission(
  agent: AuthenticatedAgent,
  required: AgentScope,
  options: { requiresVerified?: boolean } = {},
): { allowed: true } | { allowed: false; status: 401 | 403; code: string } {
  if (!hasScope(agent, required)) {
    return { allowed: false, status: 403, code: "missing_scope" };
  }
  if (agent.verificationStatus === "suspended") {
    return { allowed: false, status: 403, code: "agent_suspended" };
  }
  if (options.requiresVerified && !mayPerformVerifiedAction(agent)) {
    return { allowed: false, status: 403, code: "agent_not_verified" };
  }
  return { allowed: true };
}
