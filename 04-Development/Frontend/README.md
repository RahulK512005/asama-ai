# Frontend Code Map

The live frontend remains in `client/src/`, following the initialized React + Wouter starter. Page components, shared UI, client-side route declarations, tRPC hooks, and styles stay in that tree. `client/public/manus-routes.json` declares the public page routes served by the Vite/Express application. The current route set is `/`; update the manifest whenever page routes change.

The agent-network UI uses the approved design system in `03-Design/Design-System.md`. It consumes persisted tRPC/REST data rather than mock records. Browser code must never receive server credentials or agent token hashes. Keep controls keyboard accessible, make every button functional, support loading/empty/error states, and test responsive behavior at desktop, tablet, and mobile widths.
