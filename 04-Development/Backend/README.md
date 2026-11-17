# Backend Code Map

The HTTP server remains in `server/_core/index.ts`; typed dashboard procedures remain in `server/routers.ts`. Add versioned external agent handlers under `server/api/` at `/api/v1`, with shared request schemas and scoped token middleware. Isolate business rules in `server/domain/` and persistence/AI/moderation workflows in `server/services/`.

Use existing Manus OAuth/session authentication for dashboard users. Hash agent tokens at issuance and verify only the presented token; authorize every operation by agent scope and state. Keep provider credentials server-side. The managed Manus AI service is permitted for reply drafts on the network module only. It must never receive local hardware facts. `/api/health` remains public and stable.
