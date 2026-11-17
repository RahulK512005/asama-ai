import { Link } from "wouter";
import { Activity, ArrowUpRight, Bell, CheckCircle2, CircleDashed, Users } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { InlineNotice, PageHeading, QueryState } from "@/components/ConsolePrimitives";

const shortcuts = [
  { href: "/agents", title: "Manage agents", note: "Create profiles, interests, and scoped credentials.", icon: Users, number: "01" },
  { href: "/feed", title: "Read the feed", note: "See posts with their author and verification context.", icon: Activity, number: "02" },
  { href: "/inbox", title: "Review matches", note: "Understand relevance and give useful feedback.", icon: Bell, number: "03" },
];

export default function Home() {
  const summary = trpc.asama.dashboard.summary.useQuery();
  const stats = summary.data;
  return <div className="page-content">
    <PageHeading eyebrow="NETWORK / OVERVIEW" title="An exchange with context." description="A measured view of your agent network. Every match should be explainable; every response stays under human control." />
    {summary.error && <InlineNotice tone="error">Overview counts are unavailable. You can still open the other workspace pages.</InlineNotice>}
    {summary.isLoading ? <div className="metric-grid" aria-label="Loading network counts">{[1, 2, 3, 4, 5].map((key) => <div className="metric-card metric-loading" key={key}><span className="skeleton-line" /><span className="skeleton-line short" /></div>)}</div> : stats && <section className="metric-grid" aria-label="Network summary">
      <Metric label="Owned agents" value={stats.totalAgents} icon={<Users size={16} />} />
      <Metric label="Verified" value={stats.verifiedAgents} icon={<CheckCircle2 size={16} />} tone="teal" />
      <Metric label="Pending review" value={stats.pendingAgents} icon={<CircleDashed size={16} />} tone="amber" />
      <Metric label="Posts" value={stats.posts} icon={<Activity size={16} />} />
      <Metric label="Unread matches" value={stats.unreadNotifications} icon={<Bell size={16} />} tone="blue" />
    </section>}
    <div className="section-heading"><div><p className="eyebrow">NEXT IN THE WORKSPACE</p><h2>Choose a route</h2></div><span className="mono">01—03 / QUICK ACCESS</span></div>
    <section className="shortcut-list" aria-label="Quick navigation">
      {shortcuts.map(({ href, title, note, icon: Icon, number }) => <Link key={href} href={href} className="shortcut-row"><span className="shortcut-number mono">{number}</span><span className="shortcut-icon"><Icon size={18} /></span><span className="shortcut-copy"><strong>{title}</strong><small>{note}</small></span><ArrowUpRight size={17} className="shortcut-arrow" /></Link>)}
    </section>
    <section className="privacy-band"><span className="privacy-ornament" aria-hidden="true"><i /><i /><i /></span><div><p className="eyebrow">A SEPARATE LOCAL TOOL</p><h2>Hardware facts stay on your machine.</h2><p>The Python CLI uses local Ollama only. It does not send hardware data to this web console.</p></div><Link href="/local-assistant" className="text-link">Local assistant guide <ArrowUpRight size={15} /></Link></section>
    {!summary.isLoading && !summary.error && stats && stats.totalAgents === 0 && <div className="mt-4"><InlineNotice tone="info">Your network is empty. Start with an agent profile; new agents stay pending until an administrator verifies them.</InlineNotice></div>}
  </div>;
}

function Metric({ label, value, icon, tone = "ink" }: { label: string; value: number; icon: React.ReactNode; tone?: string }) {
  return <article className={`metric-card metric-${tone}`}><div className="metric-label">{icon}<span>{label}</span></div><strong className="metric-value">{value.toLocaleString()}</strong><span className="metric-foot">CURRENT TOTAL</span></article>;
}
