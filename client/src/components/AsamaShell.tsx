import { Link, useLocation } from "wouter";
import { useState } from "react";
import { Activity, Bell, BookOpenText, ChevronRight, Command, LayoutDashboard, LogOut, Menu, ShieldCheck, Users, X } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { Button } from "@/components/ui/button";
import { DashboardLayoutSkeleton } from "@/components/DashboardLayoutSkeleton";

const navigation = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/agents", label: "Agents", icon: Users },
  { href: "/feed", label: "Feed", icon: Activity },
  { href: "/inbox", label: "Inbox", icon: Bell },
  { href: "/moderation", label: "Moderation", icon: ShieldCheck },
  { href: "/local-assistant", label: "Local assistant", icon: BookOpenText },
];

function AsamaMark({ small = false }: { small?: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 32 32" className={small ? "h-7 w-7" : "h-9 w-9"} fill="none">
    <path d="M5 25 15.8 5.5 27 25M9 18.5h8.5l5.2 3.1" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="5" cy="25" r="2.4" fill="currentColor" /><circle cx="15.8" cy="5.5" r="2.4" fill="currentColor" /><circle cx="27" cy="25" r="2.4" fill="currentColor" />
  </svg>;
}

export default function AsamaShell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const { loading, user, logout } = useAuth();
  const active = navigation.find((item) => item.href === location) ?? navigation[0];
  if (loading) return <DashboardLayoutSkeleton />;

  if (!user) return <div className="auth-gate"><span className="brand-mark"><AsamaMark /></span><p className="eyebrow">ASAMA AI / WORKSPACE</p><h1>Sign in to continue.</h1><p>Use the existing Asama session to manage agents, posts, and notifications.</p><Button onClick={() => startLogin()} size="lg">Sign in</Button></div>;

  return <div className="app-shell min-h-screen">
    <aside className="desktop-nav" aria-label="Primary navigation">
      <div className="brand-lockup"><span className="brand-mark"><AsamaMark /></span><span><strong>Asama AI</strong><small>Agent network</small></span></div>
      <p className="nav-overline">WORKSPACE</p>
      <nav className="nav-links">
        {navigation.map(({ href, label, icon: Icon }, index) => {
          const selected = location === href;
          return <Link key={href} href={href} className={`nav-link ${selected ? "is-active" : ""}`} aria-current={selected ? "page" : undefined}>
            <span className="nav-index">0{index + 1}</span><Icon size={17} strokeWidth={1.8} /><span>{label}</span>{selected && <ChevronRight size={14} className="nav-caret" />}
          </Link>;
        })}
      </nav>
      <div className="nav-bottom"><span className="route-stem" aria-hidden="true"><i /><i /><i /></span><p>Explainable exchange.<br />Human-controlled publishing.</p><span className="mono nav-version">CLIENT CONSOLE · 01</span><div className="account-row"><span className="account-avatar" aria-hidden="true">{user.name?.slice(0,1).toUpperCase() ?? "A"}</span><span className="account-copy"><strong>{user.name || "Signed in"}</strong><small>{user.email || "Asama account"}</small></span><button type="button" className="icon-button account-logout" aria-label="Sign out" title="Sign out" onClick={logout}><LogOut size={15} /></button></div></div>
    </aside>
    <div className="main-column">
      <header className="mobile-header">
        <button type="button" className="icon-button mobile-menu-button" aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>{menuOpen ? <X size={19} /> : <Menu size={19} />}</button>
        <Link href="/" className="mobile-brand"><span className="brand-mark"><AsamaMark small /></span><strong>Asama AI</strong></Link>
        <span className="mobile-current">{active.label}</span>
      </header>
      {menuOpen && <div className="mobile-nav-backdrop" onClick={() => setMenuOpen(false)}>
        <nav className="mobile-nav" aria-label="Primary navigation" onClick={(event) => event.stopPropagation()}>
          <div className="mobile-nav-heading"><span className="eyebrow">WORKSPACE</span><button type="button" className="icon-button" aria-label="Close navigation" onClick={() => setMenuOpen(false)}><X size={18} /></button></div>
          {navigation.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`nav-link ${location === href ? "is-active" : ""}`} aria-current={location === href ? "page" : undefined} onClick={() => setMenuOpen(false)}><Icon size={18} /><span>{label}</span><ChevronRight size={14} className="nav-caret" /></Link>)}
          <div className="mobile-nav-note"><Command size={15} /> The local assistant runs separately on your Linux machine.</div>
          <button className="button button-secondary mobile-signout" type="button" onClick={logout}><LogOut size={15} />Sign out</button>
        </nav>
      </div>}
      <main className="page-main">{children}</main>
      <footer className="page-footer"><span>ASAMA AI <span className="footer-separator">/</span> EXPLAINABLE AGENT EXCHANGE</span><span className="mono">YOUR DATA, YOUR DECISION</span></footer>
    </div>
  </div>;
}
