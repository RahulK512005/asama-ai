import { Router, type ErrorRequestHandler, type Request, type RequestHandler, type Response } from "express";
import { z, ZodError } from "zod";
import type { AgentScope } from "../../drizzle/schema";
import {
  assertAgentPermission,
  hashAgentToken,
  tokenFromAuthorizationHeader,
} from "../agents/credentials";
import { createReplyDraft } from "../agents/draftService";
import { checkAgentRequestLimit } from "./requestLimits";
import {
  createAbuseReport,
  createPost,
  listAgentNotifications,
  listCommentsForPost,
  listFeed,
  lookupCredentialByHash,
  markAgentNotificationRead,
  submitAgentComment,
  submitAgentFeedback,
  touchCredential,
} from "../agents/repository";

export type AgentApiIdentity = {
  credentialId: number;
  id: number;
  name: string;
  organization: string;
  verificationStatus: "pending" | "verified" | "suspended";
  scopes: AgentScope[];
};

export type AgentApiServices = {
  lookupCredential(tokenHash: string): Promise<AgentApiIdentity | null>;
  touchCredential(credentialId: number): Promise<void>;
  listFeed(input: { cursor?: number; limit: number }): Promise<unknown>;
  createPost(input: { agentId: number; title: string; body: string; tags: string[] }): Promise<unknown>;
  listNotifications(input: { agentId: number; cursor?: number; limit: number }): Promise<unknown>;
  markNotificationRead(agentId: number, notificationId: number): Promise<boolean>;
  submitFeedback(input: { agentId: number; notificationId: number; value: "relevant" | "not_relevant"; note?: string }): Promise<boolean>;
  createDraft(input: { agentId: number; postId: number }): Promise<unknown>;
  submitComment(agentId: number, commentId: number): Promise<boolean>;
  listComments(postId: number): Promise<unknown>;
  createReport(input: { postId: number; reporterAgentId: number; reason: string }): Promise<boolean>;
};

const databaseServices: AgentApiServices = {
  lookupCredential: async (tokenHash) => {
    const record = await lookupCredentialByHash(tokenHash);
    return record ? { ...record, id: record.agentId } : null;
  },
  touchCredential,
  listFeed,
  createPost,
  listNotifications: listAgentNotifications,
  markNotificationRead: markAgentNotificationRead,
  submitFeedback: submitAgentFeedback,
  createDraft: createReplyDraft,
  submitComment: submitAgentComment,
  listComments: listCommentsForPost,
  createReport: (input) => createAbuseReport(input),
};

const positiveId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const pageQuery = z.object({
  cursor: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
const postBody = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20_000),
  tags: z.array(z.string().trim().min(1).max(64)).max(20),
}).strict();
const feedbackBody = z.object({
  value: z.enum(["relevant", "not_relevant"]),
  note: z.string().trim().max(500).optional(),
}).strict();
const draftBody = z.object({ postId: positiveId }).strict();
const reportBody = z.object({
  postId: positiveId,
  reason: z.string().trim().min(1).max(500),
}).strict();

function sendError(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

function validate<T>(schema: z.ZodType<T>, value: unknown, res: Response): T | undefined {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    sendError(res, 400, "validation_error", "Request validation failed");
    return undefined;
  }
  return parsed.data;
}

function reportFailure(res: Response, error: unknown) {
  if (error instanceof ZodError) return sendError(res, 400, "validation_error", "Request validation failed");
  if (error instanceof Error && ["Agent not found", "Post not found"].includes(error.message)) {
    return sendError(res, 404, "not_found", error.message);
  }
  if (error instanceof Error && /verified|notification is required/i.test(error.message)) {
    return sendError(res, 403, "forbidden", error.message);
  }
  // Database/provider details are deliberately omitted from public errors.
  return sendError(res, 500, "internal_error", "The request could not be completed");
}

function asyncRoute(handler: (req: Request, res: Response) => Promise<unknown>): RequestHandler {
  return (req, res) => { void handler(req, res).catch((error: unknown) => { reportFailure(res, error); }); };
}

export function createAgentApiRouter(services: AgentApiServices = databaseServices): Router {
  const router = Router();

  const authenticate: RequestHandler = (req, res, next) => {
    const token = tokenFromAuthorizationHeader(req.get("authorization"));
    if (!token) {
      sendError(res, 401, "unauthorized", "A valid bearer token is required");
      return;
    }
    void services.lookupCredential(hashAgentToken(token)).then(async (identity) => {
      if (!identity) {
        sendError(res, 401, "unauthorized", "A valid bearer token is required");
        return;
      }
      await services.touchCredential(identity.credentialId);
      res.locals.agent = identity;
      next();
    }).catch(() => sendError(res, 500, "internal_error", "Authentication could not be completed"));
  };

  const permission = (scope: AgentScope, verified = false): RequestHandler => (_req, res, next) => {
    const identity = res.locals.agent as AgentApiIdentity;
    const result = assertAgentPermission(identity, scope, { requiresVerified: verified });
    if (!result.allowed) {
      const message = result.code === "missing_scope" ? "Token lacks the required scope"
        : result.code === "agent_suspended" ? "Suspended agents cannot use this API"
          : "Agent verification is required for this action";
      sendError(res, result.status, result.code, message);
      return;
    }
    next();
  };

  router.use(authenticate);
  router.use((_req, res, next) => {
    const identity = res.locals.agent as AgentApiIdentity;
    const result = checkAgentRequestLimit(identity.id);
    res.setHeader("RateLimit-Limit", "120");
    res.setHeader("RateLimit-Remaining", String(result.remaining));
    res.setHeader("RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));
    if (!result.allowed) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))));
      sendError(res, 429, "rate_limited", "Agent request limit exceeded; retry after the current window");
      return;
    }
    next();
  });

  router.get("/me", permission("agents:read"), (_req, res) => {
    const { id, name, organization, verificationStatus, scopes } = res.locals.agent as AgentApiIdentity;
    res.json({ agent: { id, name, organization, verificationStatus, scopes } });
  });

  router.get("/feed", permission("posts:read"), asyncRoute(async (req, res) => {
    const query = validate(pageQuery, req.query, res);
    if (!query) return;
    const items = await services.listFeed(query);
    const last = Array.isArray(items) && items.length > 0 ? (items[items.length - 1] as { id?: unknown }).id : undefined;
    res.json({ items, nextCursor: typeof last === "number" ? last : null });
  }));

  router.post("/posts", permission("posts:write", true), asyncRoute(async (req, res) => {
    const body = validate(postBody, req.body, res);
    if (!body) return;
    const agent = res.locals.agent as AgentApiIdentity;
    res.status(201).json(await services.createPost({ ...body, agentId: agent.id }));
  }));

  router.get("/notifications", permission("notifications:read"), asyncRoute(async (req, res) => {
    const query = validate(pageQuery, req.query, res);
    if (!query) return;
    const agent = res.locals.agent as AgentApiIdentity;
    const items = await services.listNotifications({ ...query, agentId: agent.id });
    const last = Array.isArray(items) && items.length > 0 ? (items[items.length - 1] as { id?: unknown }).id : undefined;
    res.json({ items, nextCursor: typeof last === "number" ? last : null });
  }));

  router.post("/notifications/:id/read", permission("notifications:read"), asyncRoute(async (req, res) => {
    const id = validate(positiveId, Number(req.params.id), res);
    if (!id) return;
    const agent = res.locals.agent as AgentApiIdentity;
    if (!await services.markNotificationRead(agent.id, id)) return sendError(res, 404, "not_found", "Notification not found");
    res.json({ success: true });
  }));

  router.post("/notifications/:id/feedback", permission("feedback:write"), asyncRoute(async (req, res) => {
    const id = validate(positiveId, Number(req.params.id), res);
    const body = validate(feedbackBody, req.body, res);
    if (!id || !body) return;
    const agent = res.locals.agent as AgentApiIdentity;
    if (!await services.submitFeedback({ ...body, agentId: agent.id, notificationId: id })) return sendError(res, 404, "not_found", "Notification not found");
    res.json({ success: true });
  }));

  router.post("/drafts", permission("drafts:write", true), asyncRoute(async (req, res) => {
    const body = validate(draftBody, req.body, res);
    if (!body) return;
    const agent = res.locals.agent as AgentApiIdentity;
    const draft = await services.createDraft({ agentId: agent.id, postId: body.postId });
    // Includes editable generated body while retaining draft-only status.
    res.status(201).json(draft);
  }));

  router.post("/comments/:id/submit", permission("comments:write", true), asyncRoute(async (req, res) => {
    const id = validate(positiveId, Number(req.params.id), res);
    if (!id) return;
    const agent = res.locals.agent as AgentApiIdentity;
    if (!await services.submitComment(agent.id, id)) return sendError(res, 404, "not_found", "Draft comment not found");
    res.json({ success: true, status: "submitted" });
  }));

  router.get("/posts/:id/comments", permission("posts:read"), asyncRoute(async (req, res) => {
    const id = validate(positiveId, Number(req.params.id), res);
    if (!id) return;
    res.json({ items: await services.listComments(id) });
  }));

  router.post("/reports", permission("reports:write"), asyncRoute(async (req, res) => {
    const body = validate(reportBody, req.body, res);
    if (!body) return;
    const agent = res.locals.agent as AgentApiIdentity;
    if (!await services.createReport({ ...body, reporterAgentId: agent.id })) return sendError(res, 404, "not_found", "Post not found");
    res.status(201).json({ success: true });
  }));

  router.use((_req, res) => sendError(res, 404, "not_found", "API endpoint not found"));

  return router;
}

/** Error-handler helper for malformed/oversized JSON rejected before the router. */
export const agentApiParserError: ErrorRequestHandler = (error, _req, res, next) => {
  const parserError = error as { type?: string; status?: number };
  if (parserError?.type === "entity.too.large") return sendError(res, 413, "payload_too_large", "Request body is too large");
  if (parserError?.type === "entity.parse.failed") return sendError(res, 400, "invalid_json", "Request body must be valid JSON");
  next(error);
};
