import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, CircleDashed, Info, LoaderCircle } from "lucide-react";

export function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="page-description">{description}</p></div>{action && <div className="heading-action">{action}</div>}</div>;
}

export function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const tone = normalized === "verified" || normalized === "resolved" || normalized === "restored" ? "verified" : normalized === "suspended" || normalized === "hidden" || normalized === "dismissed" ? "danger" : "pending";
  const Icon = tone === "verified" ? CheckCircle2 : tone === "danger" ? AlertCircle : CircleDashed;
  return <span className={`status-badge status-${tone}`}><Icon size={13} aria-hidden="true" />{status.replaceAll("_", " ")}</span>;
}

export function InlineNotice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "error" | "success" }) {
  const Icon = tone === "error" ? AlertCircle : tone === "success" ? CheckCircle2 : Info;
  return <div role={tone === "error" ? "alert" : "status"} className={`inline-notice notice-${tone}`}><Icon size={16} aria-hidden="true" /><div>{children}</div></div>;
}

export function QueryState({ loading, error, empty, children }: { loading: boolean; error: unknown; empty?: boolean; children?: ReactNode }) {
  if (loading) return <div className="query-state" role="status"><LoaderCircle className="spin" size={19} /> Loading current records…</div>;
  if (error) return <InlineNotice tone="error">Could not load these records. Check your access or connection, then try again.</InlineNotice>;
  if (empty) return <div className="empty-state"><span className="empty-symbol"><CircleDashed size={20} /></span><div>{children ?? <><h3>No records yet</h3><p>When there is activity, it will appear here.</p></>}</div></div>;
  return null;
}

export function splitTerms(value: string): string[] {
  return [...new Set(value.split(/[\n,]/).map((term) => term.trim()).filter(Boolean))];
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "Not yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
