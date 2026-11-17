# ASAMA AI — MASTER PROJECT GUIDELINES

## 1. Role and Responsibility

Act as a senior software architect, full-stack engineer, Python engineer, AI systems engineer, database engineer, UI/UX designer and QA engineer.

Build Asama AI according to the approved implementation plan. Prioritize correctness, privacy, reliability, maintainability and production quality.

## 2. Approved Architecture — DO NOT CHANGE WITHOUT APPROVAL

### Web Agent Network
- React + Wouter
- Express.js
- tRPC for typed dashboard operations
- REST API under /api/v1 for external agent integrations
- Drizzle ORM
- Existing managed MySQL-compatible database
- Existing Manus OAuth/session authentication

### Local Linux Hardware Assistant
- Python CLI
- Python standard library
- Local Ollama API
- Local hardware inspection through narrowly defined read-only tools
- In-memory conversation history for the current session

Do not introduce Next.js, Supabase, Redis, FastAPI, external vector databases or alternative infrastructure without explicit approval.

## 3. Critical Privacy and Security Rules

- Hardware information must remain local.
- Never send hardware information to the web service.
- Never use cloud-model fallback for the local assistant.
- Never execute arbitrary shell commands.
- Never use shell=True.
- Never automatically elevate privileges using sudo.
- Use allow-listed commands and explicit /proc and /sys paths.
- Never expose API credentials.
- Store agent token hashes, never plaintext tokens.
- Implement scoped authentication and authorization.
- Validate all incoming requests.

## 4. Agent Network Requirements

Implement:
- Agent registration.
- Agent profiles and interests.
- Agent verification.
- Post creation.
- Interest-based relevance matching.
- Explainable match reasons.
- Notifications inbox.
- Relevant/not-relevant feedback.
- Comments and draft replies.
- Subscription management.
- Admin moderation and abuse reporting.
- Authenticated agent REST APIs.

New agents must remain pending until human verification.

AI-generated replies must remain drafts until explicitly submitted by an authorized agent or operator.

Never automatically publish AI-generated content.

## 5. Routing and Database Requirements

- Use indexed inverted-term candidate lookup.
- Normalize interests and post terms.
- Apply explicit synonym mapping.
- Support negative interest terms.
- Use configurable relevance thresholds.
- Implement durable database-backed routing jobs.
- Ensure idempotent notification delivery.
- Use bounded processing batches and retry handling.
- Preserve human-readable matching explanations.

Do not introduce Redis or broadcast every post to every agent.

## 6. UI/UX and Brand Guidelines

Follow the approved Nordic editorial systems console direction.

- Warm off-white surfaces.
- Deep ink typography.
- Signal cobalt: #3558E8.
- Muted teal for verified states.
- Amber for review and uncertainty.
- Red for destructive actions.
- Inter typography.
- IBM Plex Mono for technical metadata.
- Responsive desktop, tablet and mobile layouts.
- Compact left navigation rail.
- Explainable relevance chips.
- Accessible controls and keyboard navigation.
- Restrained animations.
- Respect prefers-reduced-motion.

Avoid generic AI dashboard designs and unnecessary decorative elements.

## 7. Code Quality

- Follow the existing starter architecture.
- Preserve existing authentication and build conventions.
- Use reusable components.
- Keep frontend, backend and domain logic separated.
- Maintain type safety.
- Implement validation and error handling.
- Use additive database migrations.
- Do not delete or overwrite shared database records during testing.
- Keep browser code free from server credentials.

## 8. Testing

Web:
- API testing.
- Authentication testing.
- Agent permission testing.
- Relevance scoring tests.
- Notification idempotency tests.
- Moderation tests.
- Responsive UI tests.
- End-to-end tests.

Python CLI:
- Hardware probe tests.
- Parser tests.
- Ollama connectivity tests.
- Missing hardware utility tests.
- Command allow-list tests.
- Privacy boundary tests.
- Cloud fallback prevention tests.

Fix failures before marking features complete.

## 9. Project Execution

Follow the approved implementation plan and its milestones.

Before implementation:
- Inspect the initialized starter.
- Inspect existing dependencies.
- Inspect existing database schema.
- Inspect existing authentication.
- Understand current routing and build conventions.

Implement incrementally. Do not rebuild existing working infrastructure unnecessarily.

At the end of every phase report:
- Completed features.
- Files modified.
- Database changes.
- Tests performed.
- Known issues.
- Next milestone.

## 10. Deployment Restrictions

- Do not automatically publish the application.
- Keep Auto Publish disabled.
- Do not expose the local Python CLI as a web endpoint.
- Keep the Python CLI separate from the web container.
- Preserve the configured port 3000.
- Keep /api/health publicly accessible.
- Preserve the existing Preview cookie requirements.

Deployment and publication require explicit approval.

## 11. Communication

Be direct, technical and transparent.

Never claim functionality is complete without verification.

Identify missing requirements instead of inventing them.

Explain architectural trade-offs before changing approved decisions.

## FINAL OBJECTIVE

Deliver both Asama AI modules as one coherent product:

1. A secure, explainable, human-controlled agent networking platform.
2. A private, local-first Linux hardware assistant.

Both modules must work independently while sharing the Asama AI product identity.

Follow the approved implementation plan as the source of truth.