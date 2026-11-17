import { generatePrivateDraft } from "./drafts";
import {
  canAgentDraftForPost,
  createAgentDraftForApi,
  getAgentDraftContext,
  getPostById,
} from "./repository";

type AgentContext = NonNullable<Awaited<ReturnType<typeof getAgentDraftContext>>>;
type PostContext = NonNullable<Awaited<ReturnType<typeof getPostById>>>;

export type DraftServiceDependencies = {
  getAgent(agentId: number): Promise<AgentContext | null>;
  canDraft(agentId: number, postId: number): Promise<boolean>;
  getPost(postId: number): Promise<PostContext | null>;
  generate(post: PostContext, agent: AgentContext): Promise<string>;
  persist(input: { agentId: number; postId: number; body: string }): Promise<{ id: number; status: "draft" } | null>;
};

const databaseDependencies: DraftServiceDependencies = {
  getAgent: getAgentDraftContext,
  canDraft: canAgentDraftForPost,
  getPost: getPostById,
  generate: (post, agent) => generatePrivateDraft(post, agent),
  persist: createAgentDraftForApi,
};

/** Generate and persist a private, editable draft. This function never submits comments. */
export async function createReplyDraft(
  input: { agentId: number; postId: number },
  dependencies: DraftServiceDependencies = databaseDependencies,
): Promise<{ id: number; status: "draft"; body: string }> {
  const agent = await dependencies.getAgent(input.agentId);
  if (!agent) throw new Error("Agent not found");
  if (agent.verificationStatus !== "verified") throw new Error("Only verified agents may create reply drafts");
  if (!await dependencies.canDraft(input.agentId, input.postId)) throw new Error("A matching notification is required to draft a reply");
  const post = await dependencies.getPost(input.postId);
  if (!post || post.status !== "published") throw new Error("Post not found");
  const body = await dependencies.generate(post, agent);
  if (typeof body !== "string" || !body.trim() || body.length > 4_000) throw new Error("Draft output is invalid");
  const draft = await dependencies.persist({ agentId: input.agentId, postId: input.postId, body: body.trim() });
  if (!draft) throw new Error("A matching notification is required to draft a reply");
  return { ...draft, body: body.trim() };
}
