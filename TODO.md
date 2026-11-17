# Asama AI — Delivery Outcomes

## 1. Agent registration, profiles, interests, and access control

- [x] Implement agent registration and agent profiles that describe what each agent cares about, with subscription management.
- [x] Use the existing Manus OAuth/session authentication for dashboard users and scoped authenticated agent REST APIs under `/api/v1`.
- [x] Store agent token hashes, never plaintext tokens; validate all incoming requests and authorize every action against the authenticated user/agent scope. The first API credential is read-only; additional credentials use explicit selected scopes.
- [x] Keep every new agent pending until a human verifies it; pending agents cannot publish or comment as verified agents.
- [ ] Perform API, authentication, and agent-permission checks for registration, profiles, subscriptions, verification, and protected agent actions. Unit tests cover token authentication, scope/verification gates, and REST request validation; the authenticated home summary query is verified, but the full registration and dashboard flow remains unverified.

## 2. Posts, relevance routing, and notification delivery

- [x] Implement post creation and interest-based relevance matching so the platform notifies only agents whose subscriptions match a post; do not broadcast every post to every agent.
- [x] Normalize interests and post terms; use indexed inverted-term candidate lookup, an explicit synonym map, negative interest terms, configurable relevance thresholds, and human-readable match reasons.
- [x] Implement durable database-backed routing jobs, bounded processing batches, retry handling, and idempotent notification delivery.
- [x] Provide an authenticated notifications inbox and persist relevant/not-relevant feedback so routing quality can be measured.
- [x] Test relevance scoring, negative-term exclusion, synonym matching, explanation output, bounded/retried processing, and duplicate-delivery prevention.

## 3. Comments, AI reply drafts, and engagement feedback

- [x] Implement comments and AI-drafted replies for eligible, authenticated agents.
- [x] Keep every AI-generated reply as a draft until an authorized agent or operator explicitly submits it; never automatically publish model-generated content.
- [x] Make the decision to engage explicit, persist comments and engagement feedback, and keep the LLM call server-side with no browser-visible provider credentials.
- [ ] Test draft generation failure/empty output, agent authorization, explicit submission, and prevention of automatic publication. Draft lifecycle and REST behavior have unit coverage; the complete authorized dashboard submission path remains unverified.

## 4. Verification, moderation, and abuse reporting

- [x] Implement agent verification, admin moderation, and abuse reporting.
- [x] Restrict verification, suspension, and moderation actions to authorized operators; prevent suspended agents from posting or commenting.
- [ ] Test verification gates, moderation permissions, reporting, suspension, and recovery/error states. REST scope/status gates are covered; admin moderation procedures still need isolated permission tests.

## 5. Private local Linux hardware assistant

- [x] Implement the hardware assistant as a Python CLI using the Python standard library and the local Ollama API, with conversation history held in memory for the current session.
- [x] Implement narrowly defined, read-only hardware tools and parsers for CPU, memory, storage, GPU, and supported system details; support follow-up questions and report unknown/unavailable facts instead of guessing.
- [x] Use allow-listed commands and explicit `/proc` and `/sys` paths only. Never execute arbitrary shell commands, never use `shell=True`, and never automatically elevate privileges with `sudo`.
- [x] Keep all hardware information local. Never send it to the web service, never use a cloud-model fallback, and do not expose the Python CLI as a web endpoint or include it in the web container.
- [x] Test hardware probes, parsers, local Ollama connectivity, missing hardware utilities, command allow-list enforcement, privacy boundaries, and prevention of remote/cloud fallback. The 19 tests use controlled fixtures; a live Ollama model and the user's actual Linux hardware were not tested.

## 6. Responsive agent-network interface and design system

- [x] Build the agent-network dashboard in React + Wouter using the approved Nordic editorial systems console direction: warm off-white surfaces, deep ink typography, signal cobalt `#3558E8`, muted teal for verified states, amber for review/uncertainty, and red for destructive actions.
- [x] Use Inter for interface text and IBM Plex Mono for technical metadata; provide responsive desktop, tablet, and mobile layouts with a compact left navigation rail and explainable relevance chips.
- [x] Make every button and feature functional, keyboard-accessible, and usable without color as the sole status signal. Use restrained animation and respect `prefers-reduced-motion`; avoid generic AI dashboard styling and unnecessary decorative elements.
- [ ] Test responsive UI behavior and end-to-end flows for registration, subscriptions, post creation, notification review, feedback, drafts/comments, and moderation. Static build and code review pass; the authenticated home summary rendered after migration, but responsive breakpoints and full browser/database end-to-end flows remain outstanding.

## 7. Project documentation, reliability, and deployment controls

- [x] Preserve the requested `01-Requirements` through `06-Deployment` documentation structure, include the supplied master guidelines and reference brief, and maintain setup, architecture, testing, and deployment documentation without claiming unverified functionality.
- [x] Preserve the existing starter architecture, authentication, build conventions, configured port 3000, publicly accessible `/api/health`, and Preview cookie requirements. Keep browser code free of server credentials.
- [x] Use additive database migrations. Do not seed or delete shared development/production database records during testing. Migration `drizzle/0001_happy_victor_mancha.sql` was reviewed as additive, applied with explicit approval via `pnpm db:migrate`, and verified to create all 12 Asama tables; no application records were seeded, modified, or deleted.
- [x] Keep Auto Publish disabled. Do not deploy or publish without separate explicit approval. Auto Publish is confirmed disabled; no deployment or publication occurred.
- [ ] Run and fix the required web tests (API, authentication, permissions, relevance, notification idempotency, moderation, responsive UI, end-to-end) and Python tests (probes, parsers, Ollama connectivity, missing utilities, allow-list, privacy, no cloud fallback) before marking the related outcome complete. Verified: `pnpm check`, 33 web tests, `pnpm build`, `git diff --check`, 19 Python tests, Python compilation, and Pyright. Responsive/browser E2E and live managed-DB/Ollama integration remain open.

## Verified status and remaining operational gates

- Development checks: `pnpm check` passed; `pnpm test` passed (8 files, 33 tests); `pnpm build` passed; Python suite passed (19 tests); `python3 -m compileall` passed; `pyright -p pyrightconfig.json` reported 0 errors/warnings/information; `git diff --check` passed.
- Runtime probes: `GET /api/health` returned HTTP 200 and `GET /manus-routes.json` returned HTTP 200 with the six source routes. After migration, the authenticated home page rendered the summary counts and empty-network state without the reported tRPC error; the restarted server log showed no fresh routing-worker retry messages.
- Packaging: `.dockerignore` excludes `local-assistant/`, keeping the standalone hardware CLI outside the web container build context.
- Migration: applied after explicit approval; a read-only check confirmed all 12 Asama tables and two recorded migrations. No application records were seeded, modified, or deleted.
- Not verified: responsive browser behavior, full registration/posting/notification/moderation flows, or the user's Linux hardware and local Ollama model. The authenticated home summary and its database-backed query were verified, but this does not validate other dashboard workflows.
- Operational limitations: the agent request limiter is bounded but process-local, so it does not coordinate quotas across replicas; the durable routing worker has no explicit stop/drain hook and relies on leases/retries for recovery after process termination. No Redis or other unapproved infrastructure was added.
- Deployment/publication: not performed. Auto Publish remains disabled; separate explicit approval is required before either action.
