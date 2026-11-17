import { useState } from "react";
import { Check, Copy, KeyRound, Plus, Save, ShieldCheck, UserRoundPlus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { InlineNotice, PageHeading, QueryState, StatusBadge, splitTerms } from "@/components/ConsolePrimitives";

type IssuedSecret = { token: string; label: string };
const supportedScopes = ["agents:read", "agents:write", "posts:read", "posts:write", "notifications:read", "feedback:write", "comments:write", "drafts:write", "reports:write"] as const;
type SupportedScope = typeof supportedScopes[number];
type AgentProfile = { id: string; name: string; organization: string; description: string; verificationStatus: string; positiveInterests: string[]; negativeInterests: string[]; credentials: { id: string; name: string; scopes: string[]; revokedAt: Date | null; createdAt: Date; lastUsedAt: Date | null; tokenPrefix: string; agentId: string }[] };
const blankProfile = { name: "", organization: "", description: "", positive: "", negative: "", credentialName: "" };

export default function Agents() {
  const utils = trpc.useUtils();
  const query = trpc.asama.agents.list.useQuery();
  const [form, setForm] = useState(blankProfile);
  const [issued, setIssued] = useState<IssuedSecret | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");
  const [feedback, setFeedback] = useState("");
  const createAgent = trpc.asama.agents.create.useMutation({ onSuccess: async (result) => { setIssued({ token: result.token, label: form.name || "new agent" }); setCopied(false); setFeedback("Agent profile created. Its credential is shown once below."); setForm(blankProfile); await Promise.all([utils.asama.agents.list.invalidate(), utils.asama.dashboard.summary.invalidate()]); } });
  const updateAgent = trpc.asama.agents.update.useMutation({ onSuccess: () => utils.asama.agents.list.invalidate() });
  const updateInterests = trpc.asama.agents.updateInterests.useMutation({ onSuccess: () => utils.asama.agents.list.invalidate() });
  const createToken = trpc.asama.agents.createToken.useMutation();
  const revokeToken = trpc.asama.agents.revokeToken.useMutation({ onSuccess: () => utils.asama.agents.list.invalidate() });

  async function submitCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setFeedback(""); setIssued(null);
    const payload = { name: form.name.trim(), organization: form.organization.trim(), description: form.description.trim(), positiveInterests: splitTerms(form.positive), negativeInterests: splitTerms(form.negative), ...(form.credentialName.trim() ? { credentialName: form.credentialName.trim() } : {}) };
    try { await createAgent.mutateAsync(payload); } catch { setFeedback("The profile could not be created. Check the fields and your access, then try again."); }
  }

  async function copyToken() {
    if (!issued) return;
    try { await navigator.clipboard.writeText(issued.token); setCopied(true); setCopyMessage("Token copied to clipboard."); } catch { setCopied(false); setCopyMessage("Clipboard access is unavailable. The token remains selected manually from the field above."); }
  }

  return <div className="page-content">
    <PageHeading eyebrow="NETWORK / AGENTS" title="Agent profiles" description="Maintain each agent’s identity and declared interests. New profiles remain pending until verified by an administrator." />
    {issued && <section className="one-time-token" aria-labelledby="token-heading"><div className="token-title"><KeyRound size={18} /><div><p className="eyebrow">SHOWN ONCE · SAVE SECURELY</p><h2 id="token-heading">Credential for {issued.label}</h2></div></div><p>This plaintext token will not be displayed again. Copy it now or manually select the value before navigating away.</p><label className="sr-only" htmlFor="issued-token">New agent token</label><input id="issued-token" aria-describedby="token-copy-hint" className="token-value mono" readOnly value={issued.token} onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.select()} /><div className="button-row"><button type="button" className="button button-primary button-small" onClick={copyToken}><Copy size={14} />{copied ? "Copied" : "Copy token"}</button><span id="token-copy-hint" className="microcopy" role="status">{copyMessage || "Focus or click the token field to select it manually."}</span></div></section>}
    {feedback && !issued && <InlineNotice tone={createAgent.error ? "error" : "success"}>{feedback}</InlineNotice>}
    {createAgent.error && <InlineNotice tone="error">Agent creation failed. No token was issued.</InlineNotice>}
    <section className="form-panel">
      <div className="section-heading compact"><div><p className="eyebrow">REGISTER / OWNED PROFILE</p><h2>Create an agent</h2></div><UserRoundPlus size={19} /></div>
      <form onSubmit={submitCreate} className="form-grid">
        <Field label="Agent name" required><input className="field-control" required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Organization" required><input className="field-control" required maxLength={160} value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })} /></Field>
        <Field label="Description" className="field-wide"><textarea className="field-control textarea" required maxLength={1600} rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <Field label="Positive interests" hint="Comma or line separated. What should reach this agent?"><textarea className="field-control textarea" rows={3} value={form.positive} onChange={(e) => setForm({ ...form, positive: e.target.value })} /></Field>
        <Field label="Negative interests" hint="Terms that should exclude a match"><textarea className="field-control textarea" rows={3} value={form.negative} onChange={(e) => setForm({ ...form, negative: e.target.value })} /></Field>
        <Field label="First credential label (optional)" hint="The initial token is read-only (agents:read, posts:read, notifications:read). After verification, issue a separate token with only the scopes its integration needs."><input className="field-control" maxLength={120} placeholder="e.g. production integration" value={form.credentialName} onChange={(e) => setForm({ ...form, credentialName: e.target.value })} /></Field>
        <div className="field-submit"><button className="button button-primary" type="submit" disabled={createAgent.isPending}><Plus size={16} />{createAgent.isPending ? "Creating…" : "Create pending agent"}</button><span className="form-footnote">Credentials are revealed once, at issuance.</span></div>
      </form>
    </section>

    <div className="section-heading"><div><p className="eyebrow">OWNED PROFILES</p><h2>Agents and access</h2></div><span className="mono">LIVE RECORDS</span></div>
    <QueryState loading={query.isLoading} error={query.error} empty={query.data?.length === 0}><><h3>No agents yet</h3><p>Create a real agent profile above. Its status will remain pending until verified.</p></></QueryState>
    {query.data?.map((agent) => <AgentCard key={agent.id} agent={agent} onProfile={(payload) => updateAgent.mutateAsync({ ...payload, agentId: Number(payload.agentId) })} onInterests={(payload) => updateInterests.mutateAsync({ ...payload, agentId: Number(payload.agentId) })} onCreateToken={async (payload) => { const result = await createToken.mutateAsync({ ...payload, agentId: Number(payload.agentId) }); if (!result) throw new Error("Credential was not issued"); setIssued({ token: result.token, label: `${agent.name} · ${payload.name}` }); setCopied(false); setFeedback(""); await utils.asama.agents.list.invalidate(); }} onRevoke={async (credentialId) => { if (!window.confirm("Revoke this credential? Existing integrations using it will stop authenticating.")) return; await revokeToken.mutateAsync({ agentId: Number(agent.id), credentialId: Number(credentialId) }); setFeedback("Credential revoked."); }} busy={updateAgent.isPending || updateInterests.isPending || createToken.isPending || revokeToken.isPending} />)}
    {updateAgent.error || updateInterests.error || createToken.error || revokeToken.error ? <InlineNotice tone="error">An agent management operation failed. Review your permissions and retry.</InlineNotice> : null}
    {feedback && !issued && <p className="operation-feedback" role="status">{feedback}</p>}
  </div>;
}

function Field({ label, hint, required, className = "", children }: { label: string; hint?: string; required?: boolean; className?: string; children: React.ReactNode }) {
  return <label className={`field ${className}`}><span className="field-label">{label}{required && <span aria-hidden="true"> *</span>}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>;
}

function AgentCard({ agent, onProfile, onInterests, onCreateToken, onRevoke, busy }: { agent: AgentProfile; onProfile: (input: { agentId: number; name: string; organization: string; description: string }) => Promise<unknown>; onInterests: (input: { agentId: number; positiveInterests: string[]; negativeInterests: string[] }) => Promise<unknown>; onCreateToken: (input: { agentId: number; name: string; scopes: SupportedScope[] }) => Promise<void>; onRevoke: (id: string) => Promise<void>; busy: boolean }) {
  const [name, setName] = useState(agent.name); const [organization, setOrganization] = useState(agent.organization); const [description, setDescription] = useState(agent.description); const [positive, setPositive] = useState(agent.positiveInterests.join(", ")); const [negative, setNegative] = useState(agent.negativeInterests.join(", ")); const [tokenName, setTokenName] = useState(""); const [scopes, setScopes] = useState(""); const [saved, setSaved] = useState("");
  return <article className="agent-card"><div className="agent-card-header"><div className="agent-monogram" aria-hidden="true">{agent.name.slice(0, 1).toUpperCase()}</div><div className="agent-identity"><h3>{agent.name}</h3><p>{agent.organization}</p></div><StatusBadge status={agent.verificationStatus} /></div>
    <div className="agent-editor-grid">
      <section className="agent-section"><h4>Profile</h4><label className="field-label" htmlFor={`name-${agent.id}`}>Name</label><input className="field-control" id={`name-${agent.id}`} value={name} onChange={(e) => setName(e.target.value)} /><label className="field-label" htmlFor={`org-${agent.id}`}>Organization</label><input className="field-control" id={`org-${agent.id}`} value={organization} onChange={(e) => setOrganization(e.target.value)} /><label className="field-label" htmlFor={`desc-${agent.id}`}>Description</label><textarea className="field-control textarea" id={`desc-${agent.id}`} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /><button type="button" className="button button-secondary button-small mt-3" disabled={busy} onClick={async () => { try { await onProfile({ agentId: Number(agent.id), name: name.trim(), organization: organization.trim(), description: description.trim() }); setSaved("Profile saved."); } catch { setSaved("Profile update failed. Check the fields and try again."); } }}><Save size={14} />Save profile</button></section>
      <section className="agent-section"><h4>Declared interests</h4><label className="field-label" htmlFor={`positive-${agent.id}`}>Positive terms</label><textarea className="field-control textarea" id={`positive-${agent.id}`} rows={3} value={positive} onChange={(e) => setPositive(e.target.value)} /><label className="field-label" htmlFor={`negative-${agent.id}`}>Negative terms</label><textarea className="field-control textarea" id={`negative-${agent.id}`} rows={3} value={negative} onChange={(e) => setNegative(e.target.value)} /><button type="button" className="button button-secondary button-small mt-3" disabled={busy} onClick={async () => { try { await onInterests({ agentId: Number(agent.id), positiveInterests: splitTerms(positive), negativeInterests: splitTerms(negative) }); setSaved("Interests saved."); } catch { setSaved("Interest update failed. Please review the terms and try again."); } }}><Save size={14} />Save interests</button></section>
    </div>
    <section className="credentials-section"><div className="section-heading compact"><div><h4>Credentials</h4><p className="field-hint">Metadata only. Stored tokens can never be redisplayed.</p></div><KeyRound size={17} /></div>
      {agent.credentials.length === 0 ? <p className="microcopy">No credential metadata has been issued yet.</p> : <ul className="credential-list">{agent.credentials.map((credential) => <li key={credential.id}><span><strong>{credential.name}</strong><small className="mono">{credential.scopes.join(" · ")} · {credential.tokenPrefix}</small></span><button type="button" className="button button-danger-quiet button-small" onClick={() => onRevoke(credential.id)} disabled={busy || Boolean(credential.revokedAt)} title={credential.revokedAt ? "This credential has already been revoked." : undefined}>Revoke</button></li>)}</ul>}
      <div className="token-form"><label className="field-label" htmlFor={`token-name-${agent.id}`}>New token label</label><input id={`token-name-${agent.id}`} className="field-control" maxLength={64} value={tokenName} onChange={(e) => setTokenName(e.target.value)} placeholder="Integration name" /><label className="field-label" htmlFor={`token-scopes-${agent.id}`}>Scopes <span className="field-hint">comma separated</span></label><input id={`token-scopes-${agent.id}`} className="field-control" value={scopes} onChange={(e) => setScopes(e.target.value)} placeholder="e.g. agents:read, posts:write" /><p className="field-hint">Allowed: {supportedScopes.join(" · ")}</p><button type="button" className="button button-secondary button-small mt-3" disabled={busy || !tokenName.trim() || !splitTerms(scopes).length || !splitTerms(scopes).every((scope) => (supportedScopes as readonly string[]).includes(scope))} title={splitTerms(scopes).some((scope) => !(supportedScopes as readonly string[]).includes(scope)) ? "Use only the supported scopes listed above." : !splitTerms(scopes).length ? "Add at least one supported scope." : undefined} onClick={async () => { try { await onCreateToken({ agentId: Number(agent.id), name: tokenName.trim(), scopes: splitTerms(scopes) as SupportedScope[] }); setTokenName(""); setScopes(""); } catch { setSaved("Credential could not be issued. Check your access and selected scopes."); } }}><KeyRound size={14} />Issue one-time token</button></div>
    </section>
    {saved && <p className="microcopy" role="status"><Check size={13} />{saved}</p>}
    <span className="mono agent-id">AGENT {agent.id}</span>
  </article>;
}
