import { describe, expect, it, vi } from "vitest";
import { runRoutingWorkerTick, scoreCandidateBatch, type RoutingWorkerDependencies } from "./routingWorker";

const post = {
  id: 7,
  agentId: 1,
  status: "published" as const,
  title: "Payment offer",
  body: "Cashback on payments",
  terms: ["cashback", "diwali"],
};

function setup(overrides: Partial<RoutingWorkerDependencies> = {}) {
  let job: Record<string, unknown> = {
    id: 21, postId: post.id, status: "pending", attemptCount: 0, candidateCursor: 0,
  };
  const inserted: Array<Array<{ agentId: number; postId: number; score: number; reason: string }>> = [];
  const findJob = vi.fn(async () => job as never);
  const claim = vi.fn(async () => job as never);
  const getPost = vi.fn(async () => post as never);
  const getCandidates = overrides.getCandidates ?? vi.fn(async () => [2, 3]);
  const getInterestTerms = vi.fn(async (ids: number[]) => ids.map((agentId) => ({ agentId, term: "payments", polarity: "positive" as const })));
  const getThreshold = vi.fn(async () => 380);
  const insertNotifications = vi.fn(async (rows: typeof inserted[number]) => { inserted.push(rows); return rows.length; });
  const advance = vi.fn(async ({ candidateCursor }: { candidateCursor: number }) => { job = { ...job, status: "pending", candidateCursor }; });
  const complete = vi.fn(async () => { job = { ...job, status: "done" }; });
  const retry = vi.fn(async ({ attemptCount }: { attemptCount: number }) => { job = { ...job, status: "pending", attemptCount }; });
  const deps = {
    findJob, claim, getPost, getCandidates, getInterestTerms, getThreshold,
    insertNotifications, advance, complete, retry,
    ...overrides,
  } as unknown as RoutingWorkerDependencies;
  return { deps, job: () => job, inserted, findJob, claim, getPost, getCandidates, getInterestTerms, getThreshold, insertNotifications, advance, complete, retry };
}

describe("database-backed routing worker decisions", () => {
  it("never notifies the author and applies negative-interest exclusion with explanations", () => {
    const rows = scoreCandidateBatch({
      post,
      candidateAgentIds: [post.agentId, 2, 3],
      interestTerms: [
        { agentId: 2, term: "payments", polarity: "positive" },
        { agentId: 3, term: "cashback", polarity: "negative" },
        { agentId: 3, term: "payments", polarity: "positive" },
      ],
      threshold: 380,
    });
    expect(rows.map((row) => row.agentId)).toEqual([2]);
    expect(rows[0].reason).toContain("Matched interests");
    expect(rows[0].postId).toBe(post.id);
  });

  it("queries synonym-expanded indexed terms in a bounded page and persists a continuation cursor", async () => {
    const ids = Array.from({ length: 50 }, (_, index) => index + 2);
    const state = setup({ getCandidates: vi.fn(async () => ids) });
    const result = await runRoutingWorkerTick(state.deps, { now: new Date("2026-01-01T00:00:00Z"), workerToken: "worker-test" });
    expect(result.state).toBe("continued");
    expect(state.getCandidates).toHaveBeenCalledWith(expect.objectContaining({
      postTerms: expect.arrayContaining(["payment", "payments", "cashback", "offer"]),
      afterAgentId: 0,
      limit: 50,
    }));
    expect(state.advance).toHaveBeenCalledWith({ jobId: 21, workerToken: "worker-test", candidateCursor: 51 });
  });

  it("completes a final partial candidate page and routes only scored candidates", async () => {
    const state = setup({ getCandidates: vi.fn(async () => [2, 3]) });
    const result = await runRoutingWorkerTick(state.deps, { workerToken: "worker-final" });
    expect(result.state).toBe("completed");
    expect(state.complete).toHaveBeenCalledWith(21, "worker-final");
    expect(state.insertNotifications).toHaveBeenCalledOnce();
    expect(state.inserted[0].every((row) => row.agentId !== post.agentId)).toBe(true);
    expect(state.inserted[0].every((row) => row.reason.includes("Matched interests"))).toBe(true);
  });

  it("records a sanitized retry with bounded exponential backoff when routing fails", async () => {
    const state = setup({ getPost: vi.fn(async () => { throw new Error("sensitive SQL/password/post text"); }) });
    const now = new Date("2026-01-01T00:00:00Z");
    const result = await runRoutingWorkerTick(state.deps, { now, workerToken: "worker-retry" });
    expect(result.state).toBe("retried");
    expect(state.retry).toHaveBeenCalledWith({
      jobId: 21,
      workerToken: "worker-retry",
      attemptCount: 1,
      availableAt: new Date(now.getTime() + 2_000),
      errorCode: "routing_processing_error",
      maxAttempts: 8,
    });
    expect(state.retry.mock.calls[0][0]).not.toHaveProperty("error");
  });

  it("replays stable recipient/post identities so the database unique key can make delivery idempotent", async () => {
    let insertCalls = 0;
    const stored = new Map<string, { agentId: number; postId: number; score: number; reason: string }>();
    const state = setup({
      insertNotifications: vi.fn(async (rows) => {
        insertCalls += 1;
        for (const row of rows) stored.set(`${row.agentId}:${row.postId}`, row);
        if (insertCalls === 1) throw new Error("commit acknowledgement lost");
        return rows.length;
      }),
    });
    await runRoutingWorkerTick(state.deps, { workerToken: "worker-idempotent" });
    await runRoutingWorkerTick(state.deps, { workerToken: "worker-idempotent-2" });
    expect(insertCalls).toBe(2);
    expect(stored.size).toBe(2);
    expect([...stored.values()].every((row) => row.postId === post.id)).toBe(true);
    expect(state.retry).toHaveBeenCalledTimes(1);
  });
});
