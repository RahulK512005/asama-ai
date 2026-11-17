import { describe, expect, it, vi } from "vitest";
import { createReplyDraft, type DraftServiceDependencies } from "./draftService";
import { buildDraftMessages, validateDraftOutput } from "./drafts";

describe("private reply draft flow", () => {
  const agent = {
    id: 4,
    name: "Research agent",
    organization: "Example org",
    description: "Tracks payment systems",
    verificationStatus: "verified" as const,
    positiveInterests: ["payments"],
    negativeInterests: ["gambling"],
  };
  const post = { id: 8, agentId: 9, title: "Payment update", body: "A new payment feature", status: "published" as const };

  it("generates, persists, and returns an editable draft without a submission operation", async () => {
    const persist = vi.fn(async ({ body }: { agentId: number; postId: number; body: string }) => ({ id: 88, status: "draft" as const, body }));
    const dependencies: DraftServiceDependencies = {
      getAgent: async () => agent,
      canDraft: async () => true,
      getPost: async () => post,
      generate: async () => "  We are exploring this payment approach.  ",
      persist,
    };
    const result = await createReplyDraft({ agentId: agent.id, postId: post.id }, dependencies);
    expect(result).toEqual({ id: 88, status: "draft", body: "We are exploring this payment approach." });
    expect(persist).toHaveBeenCalledWith({ agentId: 4, postId: 8, body: "We are exploring this payment approach." });
    expect(result.status).toBe("draft");
  });

  it("refuses pending agents and does not call generation or persistence", async () => {
    const generate = vi.fn(async () => "reply");
    const persist = vi.fn(async () => ({ id: 1, status: "draft" as const }));
    const dependencies: DraftServiceDependencies = {
      getAgent: async () => ({ ...agent, verificationStatus: "pending" }),
      canDraft: async () => true,
      getPost: async () => post,
      generate,
      persist,
    };
    await expect(createReplyDraft({ agentId: agent.id, postId: post.id }, dependencies)).rejects.toThrow("verified");
    expect(generate).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it("sends only post and declared profile context and validates nonempty bounded text", () => {
    const messages = buildDraftMessages(post, agent);
    const serialized = JSON.stringify(messages);
    expect(serialized).toContain("Payment update");
    expect(serialized).toContain("payments");
    expect(serialized).not.toMatch(/hardware|cpu|gpu|serial number/i);
    expect(validateDraftOutput("  Reviewed text  ")).toBe("Reviewed text");
    expect(() => validateDraftOutput("  ")).toThrow("invalid");
    expect(() => validateDraftOutput("x".repeat(4_001))).toThrow("invalid");
  });
});
