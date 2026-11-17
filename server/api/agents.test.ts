import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import { createAgentApiRouter, type AgentApiIdentity, type AgentApiServices } from "./agents";
import { createAgentToken, hashAgentToken, tokenFromAuthorizationHeader } from "../agents/credentials";

const credential = createAgentToken();
let server: Server;
let baseUrl = "";
let identity: AgentApiIdentity;
let services: AgentApiServices;
let lookupCredential: ReturnType<typeof vi.fn>;
let createPost: ReturnType<typeof vi.fn>;
let createDraft: ReturnType<typeof vi.fn>;
let submitComment: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  identity = {
    credentialId: 12,
    id: 9,
    name: "Research agent",
    organization: "Example org",
    verificationStatus: "verified",
    scopes: ["agents:read", "posts:read", "posts:write", "notifications:read", "feedback:write", "comments:write", "drafts:write", "reports:write"],
  };
  lookupCredential = vi.fn(async (hash: string) => hash === credential.tokenHash ? identity : null);
  createPost = vi.fn(async (input) => ({ id: 101, status: "published", routingStatus: "queued", agentId: input.agentId }));
  createDraft = vi.fn(async () => ({ id: 303, status: "draft", body: "Editable private reply" }));
  submitComment = vi.fn(async () => true);
  services = {
    lookupCredential,
    touchCredential: vi.fn(async () => undefined),
    listFeed: vi.fn(async () => []),
    createPost,
    listNotifications: vi.fn(async () => []),
    markNotificationRead: vi.fn(async () => true),
    submitFeedback: vi.fn(async () => true),
    createDraft,
    submitComment,
    listComments: vi.fn(async () => []),
    createReport: vi.fn(async () => true),
  };
  const app = express();
  app.use("/api/v1", express.json({ limit: "64kb" }), createAgentApiRouter(services));
  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test listener did not bind");
  baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

function auth(token = credential.token) {
  return { Authorization: `Bearer ${token}` };
}

describe("agent REST authentication and authorization", () => {
  it("hashes a strict bearer token before credential lookup and never returns token material", async () => {
    const response = await fetch(`${baseUrl}/me`, { headers: auth() });
    expect(response.status).toBe(200);
    expect(lookupCredential).toHaveBeenCalledWith(hashAgentToken(credential.token));
    const body = await response.text();
    expect(body).toContain("Research agent");
    expect(body).not.toContain(credential.token);
    expect(body).not.toContain(credential.tokenHash);
    expect(body).not.toContain("tokenHash");
  });

  it("rejects malformed or whitespace-padded bearer values without looking them up", async () => {
    expect(tokenFromAuthorizationHeader(`Bearer ${credential.token} `)).toBeNull();
    const response = await fetch(`${baseUrl}/me`, { headers: { Authorization: `Bearer  ${credential.token}` } });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "unauthorized" } });
    expect(lookupCredential).not.toHaveBeenCalled();
  });

  it("enforces required scopes and verified-state gating before side effects", async () => {
    identity = { ...identity, scopes: ["posts:write"], verificationStatus: "pending" };
    const response = await fetch(`${baseUrl}/posts`, {
      method: "POST", headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Title", body: "Body", tags: [] }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "agent_not_verified" } });
    expect(createPost).not.toHaveBeenCalled();

    identity = { ...identity, scopes: ["posts:read"] };
    const missingScope = await fetch(`${baseUrl}/posts`, {
      method: "POST", headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Title", body: "Body", tags: [] }),
    });
    expect(missingScope.status).toBe(403);
    expect(await missingScope.json()).toMatchObject({ error: { code: "missing_scope" } });
  });

  it("blocks suspended agents, including identity reads", async () => {
    identity = { ...identity, verificationStatus: "suspended" };
    const response = await fetch(`${baseUrl}/me`, { headers: auth() });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "agent_suspended" } });
  });

  it("validates bounded post requests before calling the repository service", async () => {
    const response = await fetch(`${baseUrl}/posts`, {
      method: "POST", headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x".repeat(201), body: "Valid body", tags: [] }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "validation_error" } });
    expect(createPost).not.toHaveBeenCalled();
  });

  it("rejects page limits above the configured maximum", async () => {
    const response = await fetch(`${baseUrl}/feed?limit=101`, { headers: auth() });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "validation_error" } });
  });

  it("returns a persisted reply as a private draft and does not submit it", async () => {
    const response = await fetch(`${baseUrl}/drafts`, {
      method: "POST", headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ postId: 44 }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: 303, status: "draft", body: "Editable private reply" });
    expect(createDraft).toHaveBeenCalledWith({ agentId: identity.id, postId: 44 });
    expect(submitComment).not.toHaveBeenCalled();
  });
});
