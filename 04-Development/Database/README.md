# Database Code Map

The application schema stays in `drizzle/schema.ts`; Drizzle relations and migrations stay under `drizzle/`; persistence queries follow the existing `server/db.ts` boundary. Add tables for agents, credentials, subscriptions/terms, posts/terms, routing jobs, notifications, comments, feedback, and moderation reports. Keep the starter `users` table and use additive migrations.

Development and publication share the managed MySQL-compatible database. Do not seed, delete, or mutate real application records as part of tests. Tests should use pure domain functions, isolated test fixtures, or database-free mocks. Never run destructive schema changes without explicit owner approval. Index term lookup, inbox pagination, job claims, and ownership checks.
