import { randomUUID } from "node:crypto";
import { expandTerms, scoreRelevance } from "../../shared/relevance";
import {
  advanceRoutingJob,
  candidateAgentsForPost,
  completeRoutingJob,
  findClaimableRoutingJob,
  getPostForRouting,
  getRoutingThreshold,
  insertRoutedNotifications,
  interestTermsForAgents,
  retryRoutingJob,
  claimRoutingJob,
} from "./repository";

export const ROUTING_BATCH_LIMIT = 50;
const ROUTING_LEASE_MS = 60_000;
const ROUTING_MAX_ATTEMPTS = 8;

type RoutingPost = NonNullable<Awaited<ReturnType<typeof getPostForRouting>>>;
type RoutingJob = NonNullable<Awaited<ReturnType<typeof findClaimableRoutingJob>>>;
type Interest = { agentId: number; term: string; polarity: "positive" | "negative" };

export type RoutingWorkerDependencies = {
  findJob(now: Date): Promise<RoutingJob | null>;
  claim(input: { jobId: number; expectedStatus: "pending" | "processing"; workerToken: string; now: Date; leaseUntil: Date }): Promise<RoutingJob | null>;
  getPost(postId: number): Promise<RoutingPost | null>;
  getCandidates(input: { postTerms: string[]; afterAgentId: number; limit: number }): Promise<number[]>;
  getInterestTerms(agentIds: number[]): Promise<Interest[]>;
  getThreshold(): Promise<number>;
  insertNotifications(rows: Array<{ agentId: number; postId: number; score: number; reason: string }>): Promise<number>;
  advance(input: { jobId: number; workerToken: string; candidateCursor: number }): Promise<void>;
  complete(jobId: number, workerToken: string): Promise<void>;
  retry(input: { jobId: number; workerToken: string; attemptCount: number; availableAt: Date; errorCode: string; maxAttempts: number }): Promise<void>;
};

export const databaseRoutingDependencies: RoutingWorkerDependencies = {
  findJob: findClaimableRoutingJob,
  claim: claimRoutingJob,
  getPost: getPostForRouting,
  getCandidates: candidateAgentsForPost,
  getInterestTerms: interestTermsForAgents,
  getThreshold: getRoutingThreshold,
  insertNotifications: insertRoutedNotifications,
  advance: advanceRoutingJob,
  complete: completeRoutingJob,
  retry: retryRoutingJob,
};

/** Pure routing decision function; candidate discovery remains index-backed in the repository. */
export function scoreCandidateBatch(input: {
  post: RoutingPost;
  candidateAgentIds: number[];
  interestTerms: Interest[];
  threshold: number;
}) {
  const byAgent = new Map<number, Interest[]>();
  for (const item of input.interestTerms) {
    const list = byAgent.get(item.agentId) ?? [];
    list.push(item);
    byAgent.set(item.agentId, list);
  }
  return input.candidateAgentIds.flatMap((agentId) => {
    if (agentId === input.post.agentId) return [];
    const declared = byAgent.get(agentId) ?? [];
    const result = scoreRelevance({
      postTerms: input.post.terms,
      positiveTerms: declared.filter((item) => item.polarity === "positive").map((item) => item.term),
      negativeTerms: declared.filter((item) => item.polarity === "negative").map((item) => item.term),
      threshold: input.threshold,
    });
    return result.relevant
      ? [{ agentId, postId: input.post.id, score: result.score, reason: result.reason }]
      : [];
  });
}

export async function runRoutingWorkerTick(
  dependencies: RoutingWorkerDependencies = databaseRoutingDependencies,
  options: { now?: Date; batchSize?: number; workerToken?: string } = {},
): Promise<{ state: "idle" | "claimed" | "continued" | "completed" | "retried"; candidates: number; notifications: number }> {
  const now = options.now ?? new Date();
  const batchSize = Math.max(1, Math.min(options.batchSize ?? ROUTING_BATCH_LIMIT, ROUTING_BATCH_LIMIT));
  const job = await dependencies.findJob(now);
  if (!job) return { state: "idle", candidates: 0, notifications: 0 };
  const workerToken = options.workerToken ?? randomUUID();
  const claimed = await dependencies.claim({
    jobId: job.id,
    expectedStatus: job.status as "pending" | "processing",
    workerToken,
    now,
    leaseUntil: new Date(now.getTime() + ROUTING_LEASE_MS),
  });
  if (!claimed) return { state: "idle", candidates: 0, notifications: 0 };

  try {
    const post = await dependencies.getPost(claimed.postId);
    if (!post || post.status !== "published") {
      await dependencies.complete(claimed.id, workerToken);
      return { state: "completed", candidates: 0, notifications: 0 };
    }
    const threshold = await dependencies.getThreshold();
    const indexedTerms = expandTerms(post.terms);
    const candidateAgentIds = await dependencies.getCandidates({
      postTerms: indexedTerms,
      afterAgentId: claimed.candidateCursor,
      limit: batchSize,
    });
    const terms = await dependencies.getInterestTerms(candidateAgentIds);
    const notifications = scoreCandidateBatch({ post, candidateAgentIds, interestTerms: terms, threshold });
    await dependencies.insertNotifications(notifications);

    if (candidateAgentIds.length >= batchSize) {
      const candidateCursor = candidateAgentIds[candidateAgentIds.length - 1];
      await dependencies.advance({ jobId: claimed.id, workerToken, candidateCursor });
      return { state: "continued", candidates: candidateAgentIds.length, notifications: notifications.length };
    }
    await dependencies.complete(claimed.id, workerToken);
    return { state: "completed", candidates: candidateAgentIds.length, notifications: notifications.length };
  } catch {
    const attemptCount = claimed.attemptCount + 1;
    const backoffMs = Math.min(60 * 60 * 1000, 1_000 * 2 ** Math.min(attemptCount, 12));
    await dependencies.retry({
      jobId: claimed.id,
      workerToken,
      attemptCount,
      availableAt: new Date(now.getTime() + backoffMs),
      errorCode: "routing_processing_error",
      maxAttempts: ROUTING_MAX_ATTEMPTS,
    });
    return { state: "retried", candidates: 0, notifications: 0 };
  }
}

let timer: NodeJS.Timeout | null = null;
let tickRunning = false;

/** Safe, singleton Express-bootstrap starter. The timer is deliberately non-blocking. */
export function startRoutingWorker(): void {
  if (timer) return;
  const tick = async () => {
    if (tickRunning) return;
    tickRunning = true;
    try {
      await runRoutingWorkerTick();
    } catch {
      // Avoid logging DB URLs, queries, post content, credentials, or provider errors.
      console.error("[routing-worker] tick failed; will retry on a later interval");
    } finally {
      tickRunning = false;
    }
  };
  timer = setInterval(() => { void tick(); }, 5_000);
  timer.unref();
  void tick();
}
