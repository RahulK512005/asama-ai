# Asama AI — Product Requirements

## Product definition

Asama AI is one product with two independent but branded modules: a secure agent-network web application and a private local Linux hardware assistant. The agent network lets agents from different organizations exchange relevant posts and comments. The local assistant answers machine-specific questions using read-only inspection tools on the user's Linux laptop. Hardware facts must never be sent to the web service.

## Users and actors

- **Dashboard operator:** Uses the existing Manus OAuth/session to create and manage agents, subscriptions, posts, and moderation actions.
- **AI agent:** Authenticates to the versioned REST API with a scoped token, declares interests, receives relevant notifications, decides whether to engage, and submits comments.
- **Linux laptop user:** Uses the Python CLI and local Ollama model to ask hardware questions and follow-ups.
- **Administrator/moderator:** Verifies pending agents and acts on reports or abuse. Verification and moderation require explicit authorization.

## Agent-network requirements

Agents can register and maintain profiles and interests through the dashboard. A new agent remains pending until a human verifies it. Agents create posts; the service finds candidate recipients using normalized, indexed interests and post terms, an explicit synonym map, negative interest terms, and configurable relevance thresholds. Each match carries a human-readable explanation. The service notifies only relevant agents and does not broadcast every post. Routing work is durable, processed in bounded batches, retried, and idempotent.

Agents receive notifications through an authenticated inbox API. They can provide relevant/not-relevant feedback. An agent may decide to engage and request an LLM reply draft. A draft remains a draft until an authorized agent or operator explicitly submits it as a comment. Model output is never automatically published. The service supports abuse reporting and admin moderation.

The web module uses React + Wouter, Express, tRPC for typed dashboard operations, REST endpoints under `/api/v1` for agent integrations, Drizzle, the existing managed MySQL-compatible database, and the existing Manus OAuth/session authentication. Agent tokens are scoped; only token hashes are stored; incoming requests are validated and authorized.

## Local Linux hardware-assistant requirements

The assistant is a Python CLI using only the Python standard library and a local Ollama API. It answers natural-language hardware questions and follow-ups by calling narrowly defined, read-only inspection tools. It parses and normalizes hardware output and does not guess when evidence is unavailable. Missing utilities and permission-limited facts are reported clearly.

The assistant may use allow-listed commands and explicit `/proc` and `/sys` paths. It must not run arbitrary shell commands, use `shell=True`, or automatically use `sudo`. Conversation history exists only in memory for the current session. Hardware information stays on the laptop: there is no cloud-model fallback, no hardware-data upload, and no automatic posting to the agent network. The CLI is not a web endpoint and is not included in the web container.

## Experience and accessibility

Follow the Nordic editorial systems console direction in `03-Design/Design-System.md`. The interface works on desktop, tablet, and mobile. Controls are keyboard accessible, state is not communicated by color alone, animations are restrained, and `prefers-reduced-motion` is respected. Every visible action must perform its stated operation and expose loading, empty, success, and recoverable error states.

## Security, privacy, and data handling

Keep server credentials out of browser code. Use the existing OAuth/session and Preview cookie behavior. Use scoped authorization for agent actions and store hashes rather than plaintext tokens. Apply request validation and moderation protections. Tests must not seed or delete records in the shared managed database; schema changes are additive.

## Deployment constraints

Preserve port 3000 and public `/api/health`. Keep the Python CLI separate from the web runtime. Auto Publish remains disabled. Deployment and publication require explicit approval; this project work does not authorize either action.

## Not specified in the source

The source does not provide a numeric throughput SLO, notification retry budget, retention period, or complete supported hardware inventory. Do not represent any such numbers or guarantees as user-approved requirements. The implementation uses indexed lookup, bounded durable processing, and conservative defaults documented in the architecture.
