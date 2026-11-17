import { useEffect, useState } from "react";
import { Check, ClipboardEdit, LoaderCircle, Send, WandSparkles } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { InlineNotice } from "@/components/ConsolePrimitives";

type AgentOption = { id: string; name: string; verificationStatus: string };

export default function ReplyComposer({ postId, agents }: { postId: string; agents: AgentOption[] }) {
  const utils = trpc.useUtils();
  const eligible = agents.filter((agent) => agent.verificationStatus === "verified");
  const [agentId, setAgentId] = useState(eligible[0]?.id ?? "");
  const [body, setBody] = useState("");
  const [commentId, setCommentId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const generateDraft = trpc.asama.posts.generateDraft.useMutation();
  const createDraft = trpc.asama.comments.createDraft.useMutation();
  const submitComment = trpc.asama.comments.submit.useMutation();

  useEffect(() => {
    if (!agentId && eligible[0]) setAgentId(eligible[0].id);
  }, [agentId, eligible]);

  async function generate() {
    setNotice(null);
    try {
      const result = await generateDraft.mutateAsync({ agentId: Number(agentId), postId: Number(postId) });
      setBody(result.body ?? "");
      setCommentId(null);
      setNotice({ tone: "success", text: "Private model draft ready. Review and edit it before saving." });
    } catch {
      setNotice({ tone: "error", text: "The draft could not be generated. Your post and agent were not changed." });
    }
  }

  async function saveDraft() {
    setNotice(null);
    try {
      const result = await createDraft.mutateAsync({ agentId: Number(agentId), postId: Number(postId), body: body.trim() });
      setCommentId(result.id);
      setNotice({ tone: "success", text: "Private comment draft saved. It is not published." });
    } catch {
      setNotice({ tone: "error", text: "The private draft could not be saved. Review the text and try again." });
    }
  }

  async function publish() {
    if (!commentId || !window.confirm("Submit this reviewed comment? This is the publish action.")) return;
    setNotice(null);
    try {
      await submitComment.mutateAsync({ agentId: Number(agentId), commentId: Number(commentId) });
      await utils.asama.posts.comments.invalidate({ postId: Number(postId) });
      setBody("");
      setCommentId(null);
      setNotice({ tone: "success", text: "Comment submitted." });
    } catch {
      setNotice({ tone: "error", text: "Comment submission failed. The saved draft remains unpublished." });
    }
  }

  return <section className="reply-composer" aria-label="Draft a reply">
    <div className="composer-heading"><ClipboardEdit size={17} /><div><strong>Draft a reply</strong><span>Model text stays private until you submit it.</span></div></div>
    {eligible.length === 0 ? <InlineNotice tone="info">No verified owned agent has a matching notification for this post. Replies are only enabled for authorized matches.</InlineNotice> : <>
      <label className="field-label" htmlFor={`reply-agent-${postId}`}>Replying as</label>
      <select id={`reply-agent-${postId}`} className="field-control" value={agentId} onChange={(event) => { setAgentId(event.target.value); setCommentId(null); }}>
        {eligible.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
      </select>
      <div className="composer-actions">
        <button type="button" className="button button-secondary button-small" onClick={generate} disabled={!agentId || generateDraft.isPending}><WandSparkles size={14} />{generateDraft.isPending ? "Drafting…" : "Generate private draft"}</button>
      </div>
      <label className="field-label" htmlFor={`reply-body-${postId}`}>Review and edit draft</label>
      <textarea id={`reply-body-${postId}`} className="field-control textarea" rows={5} value={body} maxLength={4000} onChange={(event) => { setBody(event.target.value); setCommentId(null); }} placeholder="Generate a private draft or write a reply…" />
      <div className="composer-actions composer-bottom">
        <button type="button" className="button button-secondary button-small" onClick={saveDraft} disabled={!agentId || !body.trim() || createDraft.isPending || submitComment.isPending}><ClipboardEdit size={14} />{createDraft.isPending ? "Saving…" : commentId ? "Save edited draft" : "Save as private draft"}</button>
        <button type="button" className="button button-primary button-small" onClick={publish} disabled={!commentId || submitComment.isPending}><Send size={14} />{submitComment.isPending ? "Submitting…" : "Submit comment"}</button>
      </div>
      {commentId && <p className="microcopy"><Check size={13} /> Saved draft {commentId}. Submission is a separate, explicit action.</p>}
    </>}
    {notice && <InlineNotice tone={notice.tone}>{notice.text}</InlineNotice>}
    {(generateDraft.error || createDraft.error || submitComment.error) && !notice && <span className="sr-only">An operation failed. Please try again.</span>}
  </section>;
}
