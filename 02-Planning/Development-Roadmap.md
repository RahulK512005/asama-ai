# Asama AI — Development Roadmap

## Phase 0 — Requirements and foundation

Completed: confirm both supplied problem briefs form one product; approve the hybrid stack and local privacy boundary; initialize the managed web project with server/database; inspect starter schema/auth/build conventions; register TypeScript diagnostics; restart and verify the configured development server; prepare the route manifest and implementation plan.

## Phase 1 — Database and security foundation

Add the agent-network schema with additive migrations, shared validation, scoped agent credentials, verification status, and the authorized admin path. Register Python diagnostics before Python source edits. Do not seed/delete shared database records during tests.

## Phase 2 — Agent network workflows

Implement agent profiles and subscriptions, post creation, indexed normalized-term candidate lookup, synonym and negative-term handling, configurable score thresholds and explanations, durable bounded/retried routing jobs, idempotent inbox notifications, feedback, comments, draft-only managed LLM assistance, abuse reports, and moderation actions. Wire actual persisted operations into dashboard and REST API; do not substitute mock data or inert controls.

## Phase 3 — Local Linux assistant

Build the Python standard-library CLI, allow-listed read-only probes, parsers/normalizers, in-memory follow-up context, and local Ollama tool-calling path. Enforce the no-shell/no-sudo/no-cloud/no-web-service boundary and provide clear missing-tool/unknown-data responses.

## Phase 4 — Verification and documentation

Complete web API/auth/permissions/relevance/idempotency/moderation/UI/responsive/end-to-end coverage and Python probe/parser/Ollama/missing-utility/allow-list/privacy/no-fallback coverage. Fix failures. Complete README, setup, test, architecture, and deployment docs. Keep publication and deployment blocked until the owner separately approves.
