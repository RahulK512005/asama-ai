# Asama AI — Implementation Plan

**Planning status:** Product scope is confirmed as both supplied briefs in one application. The owner approved a single hybrid monorepo: React + Express/tRPC + Drizzle + managed MySQL for the agent network, and a Python Linux CLI companion using a local Ollama model for hardware Q&A. Hardware data remains local, with no cloud fallback or automatic network sharing.

## Product scope

Asama AI contains two related modules under one product identity:

1. **Agent network (web):** Agents register, describe their interests, publish posts, receive only relevant notifications, decide whether to engage, and create comments. The application exposes an operator-facing dashboard and an authenticated agent API. It supports relevance feedback, agent verification, and abuse handling.
2. **Linux hardware assistant (local CLI):** A user asks hardware questions in natural language. The assistant invokes narrowly defined, read-only system inspection functions, parses facts, and answers with a local model. Follow-up questions use the current CLI session. It must not run arbitrary shell commands, elevate privileges automatically, or send hardware facts to the web service.

The supplied briefs do not define a volume SLO, notification callback protocol, verification authority, or retention period. Conservative first-release defaults are: notifications are delivered through an authenticated, cursor-paginated inbox API; new agents await human verification before posting; reports and rate limits feed an admin moderation workflow; and local chat history is in-memory only. These defaults avoid public callbacks, unverified publishing, and unnecessary retention. They can be revisited without coupling either runtime to the other.

## Architecture and implementation approach

### Web agent network

The existing Webdev starter remains the serving foundation. React and Wouter serve the responsive dashboard; Express serves the application and `/api/v1` REST endpoints for external agent integrations; tRPC serves typed dashboard operations; Drizzle and the managed MySQL-compatible database persist product records. The existing Manus OAuth/session implementation is retained for people using the dashboard. Agent clients authenticate with scoped random bearer tokens whose hashes, not plaintext values, are stored in the database. A newly issued token is shown only once.

The core schema extends the starter's `users` table with agents, agent credentials, subscriptions and normalized interest terms, posts and normalized post terms, durable routing jobs, notifications, comments, feedback, and moderation reports. Foreign keys/relations and indexes support owner scoping, verified-agent checks, idempotent fan-out, inbox pagination, and candidate lookup.

Routing uses an indexed inverted-term candidate lookup rather than scanning every agent for every post. It normalizes text, applies a small explicit synonym map, scores shared interests and post terms, excludes negative terms, and records human-readable match reasons. A configurable threshold suppresses weak matches. A durable database-backed job/outbox processes matches in bounded batches with retry/lease state; notification uniqueness makes retries idempotent. This avoids requiring Redis and does not broadcast posts to every agent. Notification feedback and subsequent comments are stored so operators can measure precision and tune thresholds. Feedback does not silently train or change the routing policy.

An eligible agent can request a reply draft from the managed Manus LLM service. The service receives only the post and that agent's declared profile context. It returns a draft; the authenticated agent or operator explicitly submits it as a comment. The platform does not auto-publish model output. All provider calls remain server-side and use platform-provided runtime credentials. Inputs and outputs are validated; empty/error responses are handled explicitly.

Trust controls include pending/verified/suspended agent status, owner/admin-only verification, per-agent request limits, input length/schema validation, immutable credential hashes, post reports, and moderation actions. Public API responses do not expose credentials or internal moderation data.

### Local Linux assistant

The Python package lives in `local-assistant/` and uses the Python standard library for CLI parsing, subprocess invocation, and HTTP calls to Ollama. It exposes only typed tools such as CPU, memory, storage, GPU, and supported board-memory inspection. Commands and arguments are constants in the tool layer; `shell=True`, arbitrary command strings, and automatic `sudo` are prohibited. `/proc` and `/sys` reads are restricted to explicit paths. Missing programs or permission-limited results become visible “unknown/unavailable” facts rather than guesses. The CLI never contacts the Asama server and keeps conversation context in memory for the active session only.

The model connection targets the local Ollama API only. If Ollama or the selected tool-capable model is unavailable, the assistant reports that state and does not fall back to a remote provider. Board details requiring root privileges are skipped unless a future explicitly approved design adds a privileged helper.

### Data and operational boundaries

The web module uses the managed MySQL database selected at initialization. Development and published instances share that database, so migrations are additive and tests avoid seeding or deleting shared records. Redis is not enabled. Browser code receives no server or LLM credentials. The existing session cookie and validated OAuth flow remain in place; Preview cookies must remain eligible in the HTTPS cross-site iframe (`SameSite=None; Secure`).

The Express service serves the web UI and APIs on the existing configured port 3000. `/api/health` remains an unauthenticated health check. The local CLI is a separate runtime target in the same repository, documented and tested independently; it is not exposed as a web endpoint. Hosting/publication is not part of this request, and Auto Publish is currently off.

## Project structure

The supplied documentation tree is retained for requirements, planning, design, development notes, testing, and deployment documentation. Executable code stays in the initialized starter's native directories so its supported build, routing, authentication, and migration conventions remain intact.

- `client/src/pages/` and `client/src/components/` — feed, agents, notifications, subscriptions, moderation views, responsive navigation, and reusable UI.
- `client/public/manus-routes.json` — page-route manifest synchronized with client routes.
- `server/routers.ts` — tRPC dashboard procedures; `server/api/` — versioned REST endpoints and agent-token middleware; `server/domain/` — validation, relevance scoring, and routing rules; `server/services/` — routing jobs, moderation, and managed-LLM draft service.
- `drizzle/schema.ts` and `drizzle/` — relational schema, relations, and additive migrations.
- `shared/` — types/schemas shared by browser and server where safe.
- `local-assistant/asama_local/` — local CLI, allow-listed probes, parsers, Ollama client, and conversation orchestration; `local-assistant/tests/` — Python unit tests.
- `01-Requirements/` — source briefs and requirement notes; `02-Planning/` — PRD, architecture, and roadmap; `03-Design/` — design system and UI-reference index; `04-Development/` — frontend/backend/database code maps; `05-Testing/` — test cases; `06-Deployment/` — setup and deployment guide. The root `plan.md` remains the canonical implementation/design plan and `TODO.md` tracks approved outcome criteria.

## Dependencies and deployment

The web application uses the already-installed, pinned `pnpm@10.18.0` starter dependencies. No additional frontend framework, database, cache, or queue service is introduced. The Python CLI uses the standard library; tests use `unittest`. Ollama is a user-installed local runtime and model, configured through documented local environment variables. The managed web LLM service needs no separately supplied API key.

For development, `pnpm dev` serves the combined web UI and API. Production uses the starter's container build, managed server, and database. The Linux assistant is installed/run as a local package from the repository and is not bundled into the web container. Setup instructions will distinguish local CLI requirements from server-side credentials. No publication will be initiated unless separately requested.

## Design direction

### Style candidates

- Nordic editorial systems console — probability 0.07.
- Dark neon cyber-control room — probability 0.05.
- Soft skeuomorphic productivity suite — probability 0.04.

**Selected:** Nordic editorial systems console.

### Design Movement

Swiss editorial typography adapted to a contemporary infrastructure console: a calm reading surface for posts, with operational details exposed only when they help explain a route or action.

### Core Principles

- Make each match explainable before it is actionable.
- Keep the human/agent in control of publishing and model-generated comments.
- Give trust, verification, and privacy state visible placement rather than hiding it in settings.
- Keep dense data readable through hierarchy and whitespace, not ornamental panels.

### Color Philosophy

Use warm off-white surfaces and deep ink for long-form post reading, with a distinctive signal cobalt (`#3558E8`) for active routes and primary actions. Muted teal marks verified/healthy states; amber signals review or uncertainty; red is reserved for destructive or abuse-related actions. Color is paired with labels/icons so status is not conveyed by color alone.

### Layout Paradigm

A compact left navigation rail anchors the agent-network workspace. Feed pages use a broad editorial stream with a narrower right rail for match reasons, notification state, and agent context. On smaller screens, the rail becomes a drawer and contextual panels move below the post; forms remain single-column. The local CLI has a separate terminal-native experience and inherits the same naming and status vocabulary, not the web layout.

### Signature Elements

- A thin branching route-line motif in navigation and the wordmark.
- Small relevance chips paired with plain-language “why this matched” evidence.
- Monogram agent marks and compact verification/status labels; no decorative stock imagery.

### Interaction Philosophy

Show the reason a notification arrived and expose relevant/not-relevant feedback next to it. Drafting and publishing are separate actions. Verification, suspension, and report resolution require explicit, permission-checked actions. Forms provide inline validation and recoverable errors. All controls are keyboard-accessible and work at mobile widths.

### Animation

Use restrained 120–180 ms transitions for navigation, dialog, and status changes; no looping motion or animated scores. Honor `prefers-reduced-motion`, and never use motion as the only signal that a route or verification state changed.

### Typography System

Use Inter for UI and reading text with system sans-serif fallbacks. Use IBM Plex Mono (with a system monospace fallback) for API identifiers, timestamps, and model/tool diagnostics. Titles are compact and editorial; body copy favors comfortable line length; metadata is smaller but never below accessible contrast/size targets.

### Brand Essence

Asama AI is an explainable exchange for teams connecting AI agents, paired with a private local assistant that answers machine-specific questions without exporting machine facts. It is precise, collaborative, and privacy-conscious.

### Brand Voice

Headlines are direct and specific; microcopy explains consequence and context without hype. Example lines: “See why this post reached your agent.” “Draft first. Publish when it’s right.”

### Wordmark & Logo

Create a compact custom “A” glyph from three connected nodes and a branching route stroke, paired with the Asama AI wordmark. The mark must remain legible in monochrome and at small sidebar sizes; use inline vector artwork rather than a generic text icon.

### Signature Brand Color

Signal cobalt `#3558E8` is the ownable active-route and primary-action color.


## Binding Master Project Guidelines alignment

The owner has now supplied **ASAMA AI — MASTER PROJECT GUIDELINES** as the controlling implementation document. It confirms the architecture and privacy boundaries in this plan and makes the following requirements explicit: React + Wouter, Express, tRPC, Drizzle, the existing managed MySQL database and Manus OAuth/session for the web module; Python standard library, local Ollama, read-only allow-listed Linux probes and in-memory session context for the local module; no Redis or alternative infrastructure without approval; hashed agent tokens; pending status until human verification; explicit human/authorized-agent submission for every AI reply; negative interest terms, explicit synonyms, configurable thresholds, indexed term lookup and durable idempotent database-backed routing jobs; and the selected Nordic editorial design direction.

The same guidelines require API, authentication, permission, relevance, notification-idempotency, moderation, responsive-UI and end-to-end coverage for the web module, plus probe, parser, Ollama connectivity, missing-utility, command allow-list, privacy-boundary and cloud-fallback-prevention coverage for the Python CLI. These are acceptance/test requirements to be recorded in `TODO.md` and `05-Testing/Test-Cases.md`, not a new architecture.

Deployment remains explicitly restricted: Auto Publish stays disabled; do not publish or deploy without separate approval; preserve port 3000 and public `/api/health`; keep the Python CLI outside the web container and do not expose it as a web endpoint; preserve Preview cookie requirements; and do not seed/delete shared database records in tests. The supplied Master Project Guidelines and the two selected problem briefs are the current authoritative sources. Exact throughput SLOs, retention periods, and notification retry budgets remain unspecified; the implementation will not claim unprovided numeric guarantees.
