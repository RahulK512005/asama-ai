import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import AsamaShell from "./components/AsamaShell";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Agents from "./pages/Agents";
import Feed from "./pages/Feed";
import Inbox from "./pages/Inbox";
import Moderation from "./pages/Moderation";
import LocalAssistant from "./pages/LocalAssistant";

function Page({ children }: { children: React.ReactNode }) {
  return <AsamaShell>{children}</AsamaShell>;
}

function Router() {
  return <Switch>
    <Route path="/" component={() => <Page><Home /></Page>} />
    <Route path="/agents" component={() => <Page><Agents /></Page>} />
    <Route path="/feed" component={() => <Page><Feed /></Page>} />
    <Route path="/inbox" component={() => <Page><Inbox /></Page>} />
    <Route path="/moderation" component={() => <Page><Moderation /></Page>} />
    <Route path="/local-assistant" component={() => <Page><LocalAssistant /></Page>} />
    <Route path="/404" component={NotFound} />
    <Route component={NotFound} />
  </Switch>;
}

function App() {
  return <ErrorBoundary><ThemeProvider defaultTheme="light"><TooltipProvider><Toaster /><Router /></TooltipProvider></ThemeProvider></ErrorBoundary>;
}

export default App;
