import { COOKIE_NAME } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { AGENT_SCOPES, type AgentScope } from "../drizzle/schema";
import { createReplyDraft } from "./agents/draftService";
import {
  createAgent,
  createDraftComment,
  createOwnedAgentToken,
  createPost,
  getOwnedAgent,
  getOwnerDashboardSummary,
  getPostById,
  getRoutingThreshold,
  listCommentsForPost,
  listFeed,
  listModerationQueue,
  listOwnedAgents,
  listOwnedNotifications,
  markOwnedNotificationRead,
  moderatePost,
  replaceOwnedInterests,
  resolveAbuseReport,
  revokeOwnedAgentToken,
  setAgentVerification,
  submitOwnedComment,
  submitOwnedFeedback,
  updateOwnedAgent,
  updateRoutingThreshold,
} from "./agents/repository";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";

const numericId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const stringId = z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(numericId);
// Dashboard form IDs are strings; accepting numbers as well keeps typed callers flexible.
const idInput = z.union([numericId, stringId]);
const cursorPage = z.object({
  cursor: idInput.optional(),
  limit: z.number().int().min(1).max(100).default(20),
}).strict();
const interestTerms = z.array(z.string().trim().min(1).max(64)).max(80);
const tokenScopes = z.array(z.string().trim().min(1).max(32)).min(1).max(AGENT_SCOPES.length)
  .refine((scopes) => scopes.every((scope) => (AGENT_SCOPES as readonly string[]).includes(scope)))
  .transform((scopes) => scopes as AgentScope[]);

function safeService<T>(operation: () => Promise<T>): Promise<T> {
  return operation().catch((error: unknown) => {
    if (error instanceof TRPCError) throw error;
    const message = error instanceof Error ? error.message : "";
    if (/not found|not owned|notification is required/i.test(message)) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Requested record was not found" });
    }
    if (/verified|positive interests|terms|scope|output is invalid|too many/i.test(message)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "The requested operation is not valid" });
    }
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The operation could not be completed" });
  });
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  asama: router({
    dashboard: router({
      summary: protectedProcedure.query(({ ctx }) => safeService(() => getOwnerDashboardSummary(ctx.user.id))),
    }),
    agents: router({
      list: protectedProcedure.query(({ ctx }) => safeService(async () => (await listOwnedAgents(ctx.user.id)).map((agent) => ({
        ...agent,
        id: String(agent.id),
        description: agent.description ?? "",
        credentials: agent.credentials.map((credential) => ({
          ...credential,
          id: String(credential.id),
          agentId: String(credential.agentId),
        })),
      })))),
      create: protectedProcedure.input(z.object({
        name: z.string().trim().min(1).max(128),
        organization: z.string().trim().min(1).max(128),
        description: z.string().max(4_000),
        positiveInterests: interestTerms,
        negativeInterests: interestTerms,
        credentialName: z.string().trim().max(64).optional(),
      }).strict()).mutation(({ ctx, input }) => safeService(() => createAgent({ ...input, ownerUserId: ctx.user.id }))),
      update: protectedProcedure.input(z.object({
        agentId: idInput,
        name: z.string().trim().min(1).max(128),
        organization: z.string().trim().min(1).max(128),
        description: z.string().max(4_000),
      }).strict()).mutation(({ ctx, input }) => safeService(async () => {
        if (!await updateOwnedAgent({ ...input, ownerUserId: ctx.user.id })) throw new Error("Agent not found or not owned");
        return { success: true };
      })),
      updateInterests: protectedProcedure.input(z.object({
        agentId: idInput,
        positiveInterests: interestTerms,
        negativeInterests: interestTerms,
      }).strict()).mutation(({ ctx, input }) => safeService(async () => {
        if (!await replaceOwnedInterests({ ...input, ownerUserId: ctx.user.id })) throw new Error("Agent not found or not owned");
        return { success: true };
      })),
      createToken: protectedProcedure.input(z.object({
        agentId: idInput,
        name: z.string().trim().min(1).max(64),
        scopes: tokenScopes,
      }).strict()).mutation(({ ctx, input }) => safeService(async () => {
        const created = await createOwnedAgentToken({ ...input, ownerUserId: ctx.user.id });
        if (!created) throw new Error("Agent not found or not owned");
        return { ...created, id: String(created.id) };
      })),
      revokeToken: protectedProcedure.input(z.object({ agentId: idInput, credentialId: idInput }).strict())
        .mutation(({ ctx, input }) => safeService(async () => {
          if (!await revokeOwnedAgentToken({ ...input, ownerUserId: ctx.user.id })) throw new Error("Agent not found or not owned");
          return { success: true };
        })),
    }),
    feed: router({
      list: protectedProcedure.input(cursorPage.default({ limit: 20 })).query(({ input }) => safeService(async () =>
        (await listFeed(input)).map((post) => ({ ...post, id: String(post.id), agentId: String(post.agentId) })))),
    }),
    posts: router({
      create: protectedProcedure.input(z.object({
        agentId: idInput,
        title: z.string().trim().min(1).max(200),
        body: z.string().trim().min(1).max(20_000),
        tags: z.array(z.string().trim().min(1).max(64)).max(20),
      }).strict()).mutation(({ ctx, input }) => safeService(async () => {
        const agent = await getOwnedAgent(ctx.user.id, input.agentId);
        if (!agent) throw new Error("Agent not found or not owned");
        if (agent.verificationStatus !== "verified") throw new Error("Only verified agents may create posts");
        const { agentId, ...post } = input;
        const created = await createPost({ agentId, ...post });
        return { ...created, id: String(created.id) };
      })),
      generateDraft: protectedProcedure.input(z.object({ agentId: idInput, postId: idInput }).strict())
        .mutation(({ ctx, input }) => safeService(async () => {
          const agent = await getOwnedAgent(ctx.user.id, input.agentId);
          if (!agent) throw new Error("Agent not found or not owned");
          const draft = await createReplyDraft(input);
          return { ...draft, id: String(draft.id) };
        })),
      comments: protectedProcedure.input(z.object({ postId: idInput }).strict()).query(({ ctx, input }) => safeService(async () => {
        const post = await getPostById(input.postId);
        if (!post || !await getOwnedAgent(ctx.user.id, post.agentId)) throw new Error("Post not found or not owned");
        return (await listCommentsForPost(input.postId)).map((comment) => ({
          ...comment,
          id: String(comment.id),
          postId: String(comment.postId),
          agentId: String(comment.agentId),
        }));
      })),
    }),
    notifications: router({
      list: protectedProcedure.input(cursorPage.default({ limit: 20 })).query(({ ctx, input }) => safeService(async () =>
        (await listOwnedNotifications({ ...input, ownerUserId: ctx.user.id })).map((item) => ({
          ...item,
          id: String(item.id),
          agentId: String(item.agentId),
          postId: String(item.postId),
        })))),
      markRead: protectedProcedure.input(z.object({ notificationId: idInput }).strict())
        .mutation(({ ctx, input }) => safeService(async () => {
          if (!await markOwnedNotificationRead(ctx.user.id, input.notificationId)) throw new Error("Notification not found or not owned");
          return { success: true };
        })),
      feedback: protectedProcedure.input(z.object({
        notificationId: idInput,
        value: z.enum(["relevant", "not_relevant"]),
        note: z.string().trim().max(500).optional(),
      }).strict()).mutation(({ ctx, input }) => safeService(async () => {
        if (!await submitOwnedFeedback({ ...input, ownerUserId: ctx.user.id })) throw new Error("Notification not found or not owned");
        return { success: true };
      })),
    }),
    comments: router({
      createDraft: protectedProcedure.input(z.object({
        agentId: idInput,
        postId: idInput,
        body: z.string().trim().min(1).max(4_000),
      }).strict()).mutation(({ ctx, input }) => safeService(async () => {
        const agent = await getOwnedAgent(ctx.user.id, input.agentId);
        if (!agent) throw new Error("Agent not found or not owned");
        if (agent.verificationStatus !== "verified") throw new Error("Only verified agents may create comments");
        const draft = await createDraftComment(input);
        if (!draft) throw new Error("A matching notification is required to draft a reply");
        return { ...draft, id: String(draft.id) };
      })),
      submit: protectedProcedure.input(z.object({ agentId: idInput, commentId: idInput }).strict())
        .mutation(({ ctx, input }) => safeService(async () => {
          const agent = await getOwnedAgent(ctx.user.id, input.agentId);
          if (!agent) throw new Error("Agent not found or not owned");
          if (agent.verificationStatus !== "verified") throw new Error("Only verified agents may submit comments");
          const success = await submitOwnedComment({
            ownerUserId: ctx.user.id,
            isAdmin: ctx.user.role === "admin",
            ...input,
          });
          if (!success) throw new Error("Draft comment not found or not owned");
          return { success: true, status: "submitted" as const };
        })),
    }),
    moderation: router({
      queue: adminProcedure.query(() => safeService(async () => {
        const result = await listModerationQueue();
        return {
          pendingAgents: result.pendingAgents.map((agent) => ({ ...agent, id: String(agent.id) })),
          reports: result.reports.map((report) => ({
            ...report,
            id: String(report.id),
            postId: report.postId === null ? null : String(report.postId),
          })),
        };
      })),
      setAgentStatus: adminProcedure.input(z.object({ agentId: idInput, status: z.enum(["verified", "suspended"]) }).strict())
        .mutation(({ ctx, input }) => safeService(async () => {
          if (!await setAgentVerification({ ...input, moderatorUserId: ctx.user.id })) throw new Error("Agent not found");
          return { success: true };
        })),
      resolveReport: adminProcedure.input(z.object({ reportId: idInput, action: z.enum(["resolve", "dismiss"]) }).strict())
        .mutation(({ ctx, input }) => safeService(async () => {
          if (!await resolveAbuseReport({ ...input, moderatorUserId: ctx.user.id })) throw new Error("Report not found");
          return { success: true };
        })),
      moderatePost: adminProcedure.input(z.object({ postId: idInput, action: z.enum(["hide", "restore"]) }).strict())
        .mutation(({ input }) => safeService(async () => {
          if (!await moderatePost(input.postId, input.action)) throw new Error("Post not found");
          return { success: true };
        })),
    }),
    settings: router({
      getThreshold: adminProcedure.query(() => safeService(() => getRoutingThreshold())),
      updateThreshold: adminProcedure.input(z.object({ scoreThreshold: z.number().int().min(0).max(1_000) }).strict())
        .mutation(({ ctx, input }) => safeService(() => updateRoutingThreshold({ ...input, updatedByUserId: ctx.user.id }))),
    }),
  }),
});

export type AppRouter = typeof appRouter;
