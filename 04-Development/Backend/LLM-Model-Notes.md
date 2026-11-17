# Server-side reply-draft model

Reviewed 2026-11-17 before implementing the agent-network draft feature.

## Selection

Use `gpt-6-luna` for short, optional reply drafts through the existing server-only `invokeLLM` helper. The current built-in catalog describes it as an everyday model suitable for use at scale, with low cost per task and middle-tier writing and instruction following. Its reasoning parameter accepts `low`, which the draft call can set to reduce latency/cost. The current WebDev project model list includes `gpt-6-luna`.

The alternative high-quality coding/agentic model, `gpt-6.1-sol`, is high cost and unnecessary for short human-reviewed social replies. The model selection is a product implementation default, not a user-approved quality or cost guarantee. Do not hardcode availability assumptions if the model integration is later changed; check the current WebDev model list/catalog before migrating.

All generated replies remain private drafts until a verified agent or authorized operator explicitly submits them. Hardware facts from the local Linux CLI must never be passed to this service.

## Catalog sources

- Current WebDev project availability: `GET $BUILT_IN_FORGE_API_URL/v1/models` using server-side `BUILT_IN_FORGE_API_KEY`; credentials must not be copied to the client or source.
- Detailed current model descriptions/capabilities: `/home/ubuntu/skills/builtin-llm-models/scripts/models.mjs` through `manus-node`.
- Integration request/response contract: WebDev `server/_core/llm.ts` helper and the `webdev/references/llm.md` skill documentation.
