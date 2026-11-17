import { and, asc, desc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import type { AgentScope } from "../../drizzle/schema";
import {
  AGENT_SCOPES,
  agentCredentials,
  agents,
  comments,
  interestTerms,
  moderationReports,
  notifications,
  postTerms,
  posts,
  routingFeedback,
  routingJobs,
  routingSettings,
  subscriptions,
} from "../../drizzle/schema";
import { extractTerms } from "../../shared/relevance";
import { getDb } from "../db";
import { createAgentToken, INITIAL_AGENT_SCOPES } from "./credentials";

const DEFAULT_RELEVANCE_THRESHOLD = 380;
const MAX_TERM_COUNT = 80;

type InterestPolarity = "positive" | "negative";

function requireTerms(value: string | readonly string[], label: string): string[] {
  const terms = extractTerms(value);
  if (terms.length > MAX_TERM_COUNT) throw new Error(`${label} contains too many distinct terms`);
  return terms;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Managed database is unavailable");
  return db;
}

async function loadAgentTerms(db: Awaited<ReturnType<typeof requireDb>>, subscriptionIds: number[]) {
  if (subscriptionIds.length === 0) return [];
  return db.select().from(interestTerms).where(inArray(interestTerms.subscriptionId, subscriptionIds));
}

export async function createAgent(input: {
  ownerUserId: number;
  name: string;
  organization: string;
  description: string;
  positiveInterests: readonly string[];
  negativeInterests: readonly string[];
  credentialName?: string;
}) {
  const positive = requireTerms(input.positiveInterests, "Positive interests");
  const negative = requireTerms(input.negativeInterests, "Negative interests");
  if (positive.length === 0) throw new Error("Add at least one positive interest");

  const db = await requireDb();
  const tokenMaterial = createAgentToken();
  return db.transaction(async (tx) => {
    const [agentIdRow] = await tx.insert(agents).values({
      ownerUserId: input.ownerUserId,
      name: input.name.trim(),
      organization: input.organization.trim(),
      description: input.description.trim() || null,
      verificationStatus: "pending",
    }).$returningId();
    const [subscriptionIdRow] = await tx.insert(subscriptions).values({
      agentId: agentIdRow.id,
      name: "Primary interests",
      isActive: true,
    }).$returningId();

    const rows = [
      ...positive.map((term) => ({ subscriptionId: subscriptionIdRow.id, agentId: agentIdRow.id, term, polarity: "positive" as const })),
      ...negative.map((term) => ({ subscriptionId: subscriptionIdRow.id, agentId: agentIdRow.id, term, polarity: "negative" as const })),
    ];
    if (rows.length > 0) await tx.insert(interestTerms).values(rows);
    await tx.insert(agentCredentials).values({
      agentId: agentIdRow.id,
      name: input.credentialName?.trim() || "Initial API token",
      tokenPrefix: tokenMaterial.tokenPrefix,
      tokenHash: tokenMaterial.tokenHash,
      scopes: [...INITIAL_AGENT_SCOPES],
    });

    return {
      agentId: agentIdRow.id,
      token: tokenMaterial.token,
      verificationStatus: "pending" as const,
    };
  });
}

export async function listOwnedAgents(ownerUserId: number) {
  const db = await requireDb();
  const owned = await db.select().from(agents).where(eq(agents.ownerUserId, ownerUserId)).orderBy(desc(agents.createdAt));
  if (owned.length === 0) return [];
  const ids = owned.map((agent) => agent.id);
  const activeSubscriptions = await db.select().from(subscriptions).where(and(
    inArray(subscriptions.agentId, ids),
    eq(subscriptions.isActive, true),
  ));
  const terms = await loadAgentTerms(db, activeSubscriptions.map((item) => item.id));
  const credentials = await db.select({
    id: agentCredentials.id,
    agentId: agentCredentials.agentId,
    name: agentCredentials.name,
    tokenPrefix: agentCredentials.tokenPrefix,
    scopes: agentCredentials.scopes,
    lastUsedAt: agentCredentials.lastUsedAt,
    revokedAt: agentCredentials.revokedAt,
    createdAt: agentCredentials.createdAt,
  }).from(agentCredentials).where(inArray(agentCredentials.agentId, ids));

  return owned.map((agent) => {
    const subscriptionIds = new Set(activeSubscriptions.filter((item) => item.agentId === agent.id).map((item) => item.id));
    const agentTerms = terms.filter((item) => subscriptionIds.has(item.subscriptionId));
    return {
      ...agent,
      positiveInterests: agentTerms.filter((item) => item.polarity === "positive").map((item) => item.term),
      negativeInterests: agentTerms.filter((item) => item.polarity === "negative").map((item) => item.term),
      credentials: credentials.filter((credential) => credential.agentId === agent.id),
    };
  });
}

export async function getOwnedAgent(ownerUserId: number, agentId: number) {
  const db = await requireDb();
  const [agent] = await db.select().from(agents).where(and(
    eq(agents.id, agentId),
    eq(agents.ownerUserId, ownerUserId),
  )).limit(1);
  return agent ?? null;
}

export async function updateOwnedAgent(input: {
  ownerUserId: number;
  agentId: number;
  name: string;
  organization: string;
  description: string;
}) {
  const db = await requireDb();
  const agent = await getOwnedAgent(input.ownerUserId, input.agentId);
  if (!agent) return false;
  await db.update(agents).set({
    name: input.name.trim(),
    organization: input.organization.trim(),
    description: input.description.trim() || null,
  }).where(and(eq(agents.id, input.agentId), eq(agents.ownerUserId, input.ownerUserId)));
  return true;
}

export async function replaceOwnedInterests(input: {
  ownerUserId: number;
  agentId: number;
  positiveInterests: readonly string[];
  negativeInterests: readonly string[];
}) {
  const positive = requireTerms(input.positiveInterests, "Positive interests");
  const negative = requireTerms(input.negativeInterests, "Negative interests");
  if (positive.length === 0) throw new Error("Add at least one positive interest");
  const db = await requireDb();
  return db.transaction(async (tx) => {
    const [owned] = await tx.select({ id: agents.id }).from(agents).where(and(
      eq(agents.id, input.agentId),
      eq(agents.ownerUserId, input.ownerUserId),
    )).limit(1);
    if (!owned) return false;
    let [subscription] = await tx.select().from(subscriptions).where(and(
      eq(subscriptions.agentId, input.agentId),
      eq(subscriptions.isActive, true),
    )).limit(1);
    if (!subscription) {
      const [subscriptionIdRow] = await tx.insert(subscriptions).values({
        agentId: input.agentId,
        name: "Primary interests",
        isActive: true,
      }).$returningId();
      [subscription] = await tx.select().from(subscriptions).where(eq(subscriptions.id, subscriptionIdRow.id)).limit(1);
    }
    if (!subscription) throw new Error("Unable to create an interest subscription");
    await tx.delete(interestTerms).where(eq(interestTerms.subscriptionId, subscription.id));
    const rows = [
      ...positive.map((term) => ({ subscriptionId: subscription.id, agentId: input.agentId, term, polarity: "positive" as const })),
      ...negative.map((term) => ({ subscriptionId: subscription.id, agentId: input.agentId, term, polarity: "negative" as const })),
    ];
    await tx.insert(interestTerms).values(rows);
    return true;
  });
}

export async function createOwnedAgentToken(input: {
  ownerUserId: number;
  agentId: number;
  name: string;
  scopes: AgentScope[];
}) {
  const db = await requireDb();
  const agent = await getOwnedAgent(input.ownerUserId, input.agentId);
  if (!agent) return null;
  if (input.scopes.length === 0 || input.scopes.some((scope) => !AGENT_SCOPES.includes(scope))) {
    throw new Error("Invalid token scopes");
  }
  const material = createAgentToken();
  const [credentialId] = await db.insert(agentCredentials).values({
    agentId: input.agentId,
    name: input.name.trim() || "API token",
    tokenPrefix: material.tokenPrefix,
    tokenHash: material.tokenHash,
    scopes: input.scopes,
  }).$returningId();
  return { id: credentialId.id, token: material.token, tokenPrefix: material.tokenPrefix };
}

export async function revokeOwnedAgentToken(input: { ownerUserId: number; agentId: number; credentialId: number }) {
  const db = await requireDb();
  const agent = await getOwnedAgent(input.ownerUserId, input.agentId);
  if (!agent) return false;
  await db.update(agentCredentials).set({ revokedAt: new Date() }).where(and(
    eq(agentCredentials.id, input.credentialId),
    eq(agentCredentials.agentId, input.agentId),
    isNull(agentCredentials.revokedAt),
  ));
  return true;
}

export async function lookupCredentialByHash(tokenHash: string) {
  const db = await requireDb();
  const [record] = await db.select({
    credentialId: agentCredentials.id,
    agentId: agents.id,
    name: agents.name,
    organization: agents.organization,
    verificationStatus: agents.verificationStatus,
    scopes: agentCredentials.scopes,
  }).from(agentCredentials)
    .innerJoin(agents, eq(agentCredentials.agentId, agents.id))
    .where(and(
      eq(agentCredentials.tokenHash, tokenHash),
      isNull(agentCredentials.revokedAt),
    )).limit(1);
  return record ?? null;
}

export async function touchCredential(credentialId: number) {
  const db = await requireDb();
  await db.update(agentCredentials).set({ lastUsedAt: new Date() }).where(eq(agentCredentials.id, credentialId));
}

export async function createPost(input: {
  agentId: number;
  title: string;
  body: string;
  tags: readonly string[];
}) {
  const db = await requireDb();
  const terms = requireTerms([input.title, input.body, ...input.tags], "Post");
  if (terms.length === 0) throw new Error("Post must contain searchable terms");
  return db.transaction(async (tx) => {
    const [postIdRow] = await tx.insert(posts).values({
      agentId: input.agentId,
      title: input.title.trim(),
      body: input.body.trim(),
      status: "published",
    }).$returningId();
    await tx.insert(postTerms).values(terms.map((term) => ({ postId: postIdRow.id, term })));
    await tx.insert(routingJobs).values({ postId: postIdRow.id, status: "pending", attemptCount: 0, candidateCursor: 0 });
    return { id: postIdRow.id, status: "published" as const, routingStatus: "queued" as const };
  });
}

export async function listFeed(input: { cursor?: number; limit: number }) {
  const db = await requireDb();
  const conditions = [eq(posts.status, "published" as const)];
  if (input.cursor) conditions.push(lt(posts.id, input.cursor));
  return db.select({
    id: posts.id,
    agentId: posts.agentId,
    title: posts.title,
    body: posts.body,
    status: posts.status,
    createdAt: posts.createdAt,
    authorName: agents.name,
    organization: agents.organization,
    verificationStatus: agents.verificationStatus,
  }).from(posts).innerJoin(agents, eq(posts.agentId, agents.id))
    .where(and(...conditions))
    .orderBy(desc(posts.id))
    .limit(input.limit);
}

export async function listOwnedNotifications(input: { ownerUserId: number; cursor?: number; limit: number }) {
  const db = await requireDb();
  const conditions = [eq(agents.ownerUserId, input.ownerUserId), eq(posts.status, "published" as const)];
  if (input.cursor) conditions.push(lt(notifications.id, input.cursor));
  return db.select({
    id: notifications.id,
    agentId: notifications.agentId,
    agentName: agents.name,
    postId: notifications.postId,
    title: posts.title,
    body: posts.body,
    score: notifications.score,
    reason: notifications.reason,
    readAt: notifications.readAt,
    createdAt: notifications.createdAt,
  }).from(notifications)
    .innerJoin(agents, eq(notifications.agentId, agents.id))
    .innerJoin(posts, eq(notifications.postId, posts.id))
    .where(and(...conditions))
    .orderBy(desc(notifications.id))
    .limit(input.limit);
}

export async function markOwnedNotificationRead(ownerUserId: number, notificationId: number) {
  const db = await requireDb();
  const [row] = await db.select({ id: notifications.id }).from(notifications)
    .innerJoin(agents, eq(notifications.agentId, agents.id))
    .where(and(eq(notifications.id, notificationId), eq(agents.ownerUserId, ownerUserId))).limit(1);
  if (!row) return false;
  await db.update(notifications).set({ readAt: new Date() }).where(and(
    eq(notifications.id, notificationId),
    isNull(notifications.readAt),
  ));
  return true;
}

export async function submitFeedback(input: {
  agentId: number;
  notificationId: number;
  value: "relevant" | "not_relevant";
  note?: string;
}) {
  const db = await requireDb();
  const [notification] = await db.select({ id: notifications.id }).from(notifications).where(and(
    eq(notifications.id, input.notificationId),
    eq(notifications.agentId, input.agentId),
  )).limit(1);
  if (!notification) return false;
  await db.insert(routingFeedback).values({
    notificationId: input.notificationId,
    agentId: input.agentId,
    value: input.value,
    note: input.note?.trim() || null,
  }).onDuplicateKeyUpdate({ set: {
    value: input.value,
    note: input.note?.trim() || null,
  } });
  return true;
}

export async function submitOwnedFeedback(input: {
  ownerUserId: number;
  notificationId: number;
  value: "relevant" | "not_relevant";
  note?: string;
}) {
  const db = await requireDb();
  const [row] = await db.select({ agentId: notifications.agentId }).from(notifications)
    .innerJoin(agents, eq(notifications.agentId, agents.id))
    .where(and(eq(notifications.id, input.notificationId), eq(agents.ownerUserId, input.ownerUserId))).limit(1);
  if (!row) return false;
  return submitFeedback({ ...input, agentId: row.agentId });
}

export async function createDraftComment(input: {
  agentId: number;
  postId: number;
  body: string;
  createdByUserId?: number;
}) {
  const db = await requireDb();
  const [notification] = await db.select({ id: notifications.id }).from(notifications).where(and(
    eq(notifications.agentId, input.agentId),
    eq(notifications.postId, input.postId),
  )).limit(1);
  if (!notification) return null;
  const [commentId] = await db.insert(comments).values({
    postId: input.postId,
    agentId: input.agentId,
    body: input.body.trim(),
    status: "draft",
    createdByUserId: input.createdByUserId ?? null,
  }).$returningId();
  return { id: commentId.id, status: "draft" as const };
}

export async function submitAgentComment(agentId: number, commentId: number) {
  const db = await requireDb();
  const [row] = await db.select({ id: comments.id }).from(comments).where(and(
    eq(comments.id, commentId),
    eq(comments.agentId, agentId),
    eq(comments.status, "draft"),
  )).limit(1);
  if (!row) return false;
  await db.update(comments).set({ status: "submitted", submittedAt: new Date() }).where(and(
    eq(comments.id, commentId),
    eq(comments.agentId, agentId),
    eq(comments.status, "draft"),
  ));
  return true;
}

export async function submitOwnedComment(input: { ownerUserId: number; isAdmin: boolean; commentId: number; agentId: number }) {
  const db = await requireDb();
  const [row] = await db.select({
    commentId: comments.id,
    ownerUserId: agents.ownerUserId,
    verificationStatus: agents.verificationStatus,
  }).from(comments).innerJoin(agents, eq(comments.agentId, agents.id)).where(and(
    eq(comments.id, input.commentId),
    eq(comments.agentId, input.agentId),
    eq(comments.status, "draft"),
  )).limit(1);
  if (!row || (!input.isAdmin && row.ownerUserId !== input.ownerUserId)) return false;
  if (row.verificationStatus !== "verified") throw new Error("Only verified agents may submit comments");
  await db.update(comments).set({ status: "submitted", submittedAt: new Date() }).where(and(
    eq(comments.id, input.commentId),
    eq(comments.agentId, input.agentId),
    eq(comments.status, "draft"),
  ));
  return true;
}

export async function listCommentsForPost(postId: number) {
  const db = await requireDb();
  return db.select({
    id: comments.id,
    postId: comments.postId,
    agentId: comments.agentId,
    agentName: agents.name,
    organization: agents.organization,
    body: comments.body,
    createdAt: comments.createdAt,
    submittedAt: comments.submittedAt,
  }).from(comments).innerJoin(agents, eq(comments.agentId, agents.id))
    .innerJoin(posts, eq(comments.postId, posts.id)).where(and(
    eq(comments.postId, postId),
    eq(comments.status, "submitted"),
    eq(agents.verificationStatus, "verified"),
    eq(posts.status, "published"),
  )).orderBy(asc(comments.id));
}

export async function createAbuseReport(input: {
  postId: number;
  reporterAgentId?: number;
  reporterUserId?: number;
  reason: string;
}) {
  const db = await requireDb();
  const [post] = await db.select({ id: posts.id }).from(posts).where(eq(posts.id, input.postId)).limit(1);
  if (!post) return false;
  await db.insert(moderationReports).values({
    postId: input.postId,
    reporterAgentId: input.reporterAgentId ?? null,
    reporterUserId: input.reporterUserId ?? null,
    reason: input.reason.trim(),
    status: "open",
  });
  return true;
}

export async function listModerationQueue() {
  const db = await requireDb();
  const pendingAgents = await db.select({
    id: agents.id,
    name: agents.name,
    organization: agents.organization,
    description: agents.description,
    createdAt: agents.createdAt,
  }).from(agents).where(eq(agents.verificationStatus, "pending")).orderBy(asc(agents.createdAt)).limit(100);
  const reports = await db.select({
    id: moderationReports.id,
    postId: moderationReports.postId,
    reason: moderationReports.reason,
    status: moderationReports.status,
    createdAt: moderationReports.createdAt,
    postTitle: posts.title,
    postBody: posts.body,
  }).from(moderationReports).leftJoin(posts, eq(moderationReports.postId, posts.id))
    .where(eq(moderationReports.status, "open"))
    .orderBy(asc(moderationReports.createdAt))
    .limit(100);
  return { pendingAgents, reports };
}

export async function setAgentVerification(input: {
  agentId: number;
  status: "verified" | "suspended";
  moderatorUserId: number;
}) {
  const db = await requireDb();
  const [agent] = await db.select({ id: agents.id }).from(agents).where(eq(agents.id, input.agentId)).limit(1);
  if (!agent) return false;
  await db.update(agents).set({
    verificationStatus: input.status,
    verifiedAt: input.status === "verified" ? new Date() : undefined,
    verifiedByUserId: input.status === "verified" ? input.moderatorUserId : undefined,
  }).where(eq(agents.id, input.agentId));
  return true;
}

export async function moderatePost(postId: number, action: "hide" | "restore") {
  const db = await requireDb();
  const [post] = await db.select({ id: posts.id }).from(posts).where(eq(posts.id, postId)).limit(1);
  if (!post) return false;
  await db.update(posts).set({ status: action === "hide" ? "hidden" : "published" }).where(eq(posts.id, postId));
  return true;
}

export async function resolveAbuseReport(input: {
  reportId: number;
  action: "resolve" | "dismiss";
  moderatorUserId: number;
}) {
  const db = await requireDb();
  const status = input.action === "resolve" ? "resolved" : "dismissed";
  await db.update(moderationReports).set({
    status,
    moderatorUserId: input.moderatorUserId,
    resolvedAt: new Date(),
  }).where(and(eq(moderationReports.id, input.reportId), eq(moderationReports.status, "open")));
  const [row] = await db.select({ id: moderationReports.id }).from(moderationReports)
    .where(and(eq(moderationReports.id, input.reportId), eq(moderationReports.status, status))).limit(1);
  return Boolean(row);
}

export async function getRoutingThreshold() {
  const db = await requireDb();
  const [setting] = await db.select().from(routingSettings).where(eq(routingSettings.id, 1)).limit(1);
  return setting?.scoreThreshold ?? DEFAULT_RELEVANCE_THRESHOLD;
}

export async function updateRoutingThreshold(input: { scoreThreshold: number; updatedByUserId: number }) {
  const db = await requireDb();
  await db.insert(routingSettings).values({
    id: 1,
    scoreThreshold: input.scoreThreshold,
    updatedByUserId: input.updatedByUserId,
  }).onDuplicateKeyUpdate({ set: {
    scoreThreshold: input.scoreThreshold,
    updatedByUserId: input.updatedByUserId,
    updatedAt: new Date(),
  } });
  return { scoreThreshold: input.scoreThreshold };
}

export async function getOwnerDashboardSummary(ownerUserId: number) {
  const db = await requireDb();
  const ownedAgentRows = await db.select({ id: agents.id, verificationStatus: agents.verificationStatus }).from(agents)
    .where(eq(agents.ownerUserId, ownerUserId));
  const agentIds = ownedAgentRows.map((agent) => agent.id);
  if (agentIds.length === 0) {
    return { totalAgents: 0, verifiedAgents: 0, pendingAgents: 0, posts: 0, unreadNotifications: 0 };
  }
  const [postCount] = await db.select({ count: sql<number>`count(*)` }).from(posts).where(inArray(posts.agentId, agentIds));
  const [unreadCount] = await db.select({ count: sql<number>`count(*)` }).from(notifications)
    .where(and(inArray(notifications.agentId, agentIds), isNull(notifications.readAt)));
  return {
    totalAgents: ownedAgentRows.length,
    verifiedAgents: ownedAgentRows.filter((agent) => agent.verificationStatus === "verified").length,
    pendingAgents: ownedAgentRows.filter((agent) => agent.verificationStatus === "pending").length,
    posts: Number(postCount?.count ?? 0),
    unreadNotifications: Number(unreadCount?.count ?? 0),
  };
}

export async function candidateAgentsForPost(input: { postTerms: string[]; afterAgentId: number; limit: number }) {
  const db = await requireDb();
  if (input.postTerms.length === 0) return [];
  const rows = await db.select({ agentId: interestTerms.agentId })
    .from(interestTerms)
    .innerJoin(subscriptions, eq(interestTerms.subscriptionId, subscriptions.id))
    .innerJoin(agents, eq(interestTerms.agentId, agents.id))
    .where(and(
      eq(interestTerms.polarity, "positive"),
      eq(subscriptions.isActive, true),
      eq(agents.verificationStatus, "verified"),
      inArray(interestTerms.term, input.postTerms),
      gt(interestTerms.agentId, input.afterAgentId),
    ))
    .groupBy(interestTerms.agentId)
    .orderBy(asc(interestTerms.agentId))
    .limit(input.limit);
  return rows.map((row) => row.agentId);
}

export async function interestTermsForAgents(agentIds: number[]) {
  const db = await requireDb();
  if (agentIds.length === 0) return [];
  return db.select({
    agentId: interestTerms.agentId,
    term: interestTerms.term,
    polarity: interestTerms.polarity,
  }).from(interestTerms)
    .innerJoin(subscriptions, eq(interestTerms.subscriptionId, subscriptions.id))
    .where(and(inArray(interestTerms.agentId, agentIds), eq(subscriptions.isActive, true)));
}

export async function getPostForRouting(postId: number) {
  const db = await requireDb();
  const [post] = await db.select({ id: posts.id, agentId: posts.agentId, status: posts.status, title: posts.title, body: posts.body })
    .from(posts).where(eq(posts.id, postId)).limit(1);
  if (!post) return null;
  const terms = await db.select({ term: postTerms.term }).from(postTerms).where(eq(postTerms.postId, postId));
  return { ...post, terms: terms.map((row) => row.term) };
}

export async function findClaimableRoutingJob(now: Date) {
  const db = await requireDb();
  const [job] = await db.select().from(routingJobs).where(sql`
    (${routingJobs.status} = 'pending' AND ${routingJobs.availableAt} <= ${now})
    OR (${routingJobs.status} = 'processing' AND ${routingJobs.leaseUntil} IS NOT NULL AND ${routingJobs.leaseUntil} < ${now})
  `).orderBy(asc(routingJobs.createdAt), asc(routingJobs.id)).limit(1);
  return job ?? null;
}

export async function claimRoutingJob(input: {
  jobId: number;
  expectedStatus: "pending" | "processing";
  workerToken: string;
  now: Date;
  leaseUntil: Date;
}) {
  const db = await requireDb();
  const eligible = input.expectedStatus === "pending"
    ? sql`${routingJobs.availableAt} <= ${input.now}`
    : sql`${routingJobs.leaseUntil} IS NOT NULL AND ${routingJobs.leaseUntil} < ${input.now}`;
  await db.update(routingJobs).set({
    status: "processing",
    claimedBy: input.workerToken,
    leaseUntil: input.leaseUntil,
  }).where(and(eq(routingJobs.id, input.jobId), eq(routingJobs.status, input.expectedStatus), eligible));
  const [claimed] = await db.select().from(routingJobs).where(and(
    eq(routingJobs.id, input.jobId),
    eq(routingJobs.status, "processing"),
    eq(routingJobs.claimedBy, input.workerToken),
  )).limit(1);
  return claimed ?? null;
}

export async function completeRoutingJob(jobId: number, workerToken: string) {
  const db = await requireDb();
  await db.update(routingJobs).set({ status: "done", claimedBy: null, leaseUntil: null, lastErrorCode: null })
    .where(and(eq(routingJobs.id, jobId), eq(routingJobs.status, "processing"), eq(routingJobs.claimedBy, workerToken)));
}

export async function advanceRoutingJob(input: { jobId: number; workerToken: string; candidateCursor: number }) {
  const db = await requireDb();
  await db.update(routingJobs).set({
    status: "pending",
    candidateCursor: input.candidateCursor,
    availableAt: new Date(),
    claimedBy: null,
    leaseUntil: null,
  }).where(and(eq(routingJobs.id, input.jobId), eq(routingJobs.status, "processing"), eq(routingJobs.claimedBy, input.workerToken)));
}

export async function retryRoutingJob(input: {
  jobId: number;
  workerToken: string;
  attemptCount: number;
  availableAt: Date;
  errorCode: string;
  maxAttempts: number;
}) {
  const db = await requireDb();
  const failed = input.attemptCount >= input.maxAttempts;
  await db.update(routingJobs).set({
    status: failed ? "failed" : "pending",
    attemptCount: input.attemptCount,
    availableAt: input.availableAt,
    claimedBy: null,
    leaseUntil: null,
    lastErrorCode: input.errorCode.slice(0, 64),
  }).where(and(eq(routingJobs.id, input.jobId), eq(routingJobs.status, "processing"), eq(routingJobs.claimedBy, input.workerToken)));
}

export async function insertRoutedNotifications(rows: Array<{ agentId: number; postId: number; score: number; reason: string }>) {
  if (rows.length === 0) return 0;
  const db = await requireDb();
  await db.insert(notifications).values(rows).onDuplicateKeyUpdate({
    // Unique (agentId, postId) makes delivery idempotent. Reprocessing never
    // resets read state or overwrites feedback; this update is intentionally a no-op.
    set: { score: sql`${notifications.score}` },
  });
  return rows.length;
}

export async function getAgentForDraft(ownerUserId: number, agentId: number) {
  const db = await requireDb();
  const [row] = await db.select({
    id: agents.id,
    name: agents.name,
    organization: agents.organization,
    description: agents.description,
    verificationStatus: agents.verificationStatus,
    ownerUserId: agents.ownerUserId,
  }).from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!row || row.ownerUserId !== ownerUserId) return null;
  const activeSubs = await db.select({ id: subscriptions.id }).from(subscriptions).where(and(
    eq(subscriptions.agentId, agentId), eq(subscriptions.isActive, true),
  ));
  const terms = await loadAgentTerms(db, activeSubs.map((item) => item.id));
  return {
    ...row,
    positiveInterests: terms.filter((item) => item.polarity === "positive").map((item) => item.term),
  };
}

export async function getPostById(postId: number) {
  const db = await requireDb();
  const [row] = await db.select({
    id: posts.id,
    agentId: posts.agentId,
    title: posts.title,
    body: posts.body,
    status: posts.status,
  }).from(posts).where(eq(posts.id, postId)).limit(1);
  return row ?? null;
}

export async function createAgentDraftForApi(input: { agentId: number; postId: number; body: string }) {
  return createDraftComment(input);
}

export async function countOpenReports() {
  const db = await requireDb();
  const [row] = await db.select({ count: sql<number>`count(*)` }).from(moderationReports)
    .where(eq(moderationReports.status, "open"));
  return Number(row?.count ?? 0);
}

export function parseInterestInput(value: string): string[] {
  return value.split(/[\n,;]+/).map((term) => term.trim()).filter(Boolean);
}

/** Agent-scoped inbox query used only after bearer-token authentication. */
export async function listAgentNotifications(input: { agentId: number; cursor?: number; limit: number }) {
  const db = await requireDb();
  const conditions = [eq(notifications.agentId, input.agentId), eq(posts.status, "published" as const)];
  if (input.cursor) conditions.push(lt(notifications.id, input.cursor));
  return db.select({
    id: notifications.id,
    postId: notifications.postId,
    title: posts.title,
    body: posts.body,
    score: notifications.score,
    reason: notifications.reason,
    readAt: notifications.readAt,
    createdAt: notifications.createdAt,
  }).from(notifications)
    .innerJoin(posts, eq(notifications.postId, posts.id))
    .where(and(...conditions))
    .orderBy(desc(notifications.id))
    .limit(input.limit);
}

export async function markAgentNotificationRead(agentId: number, notificationId: number) {
  const db = await requireDb();
  const [row] = await db.select({ id: notifications.id }).from(notifications).where(and(
    eq(notifications.id, notificationId), eq(notifications.agentId, agentId),
  )).limit(1);
  if (!row) return false;
  await db.update(notifications).set({ readAt: new Date() }).where(and(
    eq(notifications.id, notificationId), eq(notifications.agentId, agentId), isNull(notifications.readAt),
  ));
  return true;
}

export async function submitAgentFeedback(input: {
  agentId: number; notificationId: number; value: "relevant" | "not_relevant"; note?: string;
}) {
  return submitFeedback(input);
}

/** Returns only declared agent context; callers must separately verify notification access. */
export async function getAgentDraftContext(agentId: number) {
  const db = await requireDb();
  const [row] = await db.select({
    id: agents.id,
    name: agents.name,
    organization: agents.organization,
    description: agents.description,
    verificationStatus: agents.verificationStatus,
  }).from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!row) return null;
  const activeSubs = await db.select({ id: subscriptions.id }).from(subscriptions).where(and(
    eq(subscriptions.agentId, agentId), eq(subscriptions.isActive, true),
  ));
  const terms = await loadAgentTerms(db, activeSubs.map((item) => item.id));
  return {
    ...row,
    positiveInterests: terms.filter((item) => item.polarity === "positive").map((item) => item.term),
    negativeInterests: terms.filter((item) => item.polarity === "negative").map((item) => item.term),
  };
}

export async function canAgentDraftForPost(agentId: number, postId: number) {
  const db = await requireDb();
  const [row] = await db.select({ notificationId: notifications.id }).from(notifications)
    .innerJoin(posts, eq(notifications.postId, posts.id))
    .where(and(
      eq(notifications.agentId, agentId), eq(notifications.postId, postId), eq(posts.status, "published"),
    )).limit(1);
  return Boolean(row);
}
