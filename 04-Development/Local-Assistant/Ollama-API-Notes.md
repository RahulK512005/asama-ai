# Ollama local API notes

Reviewed 2026-11-17 for the Asama AI local Linux assistant.

## API contract used

- `POST http://127.0.0.1:11434/api/chat` is the local chat endpoint. Requests provide `model`, conversation `messages`, fixed `tools`, and `stream: false` for one complete response.
- The assistant response may contain `message.tool_calls`. The application must validate every returned tool name and arguments against its own allow-list, execute only fixed probes, append the assistant/tool messages, and continue until the model returns a normal answer or the application-defined tool-call bound is reached.
- Tool output and conversation context are only sent to the local Ollama process. No remote host or provider fallback is configured.
- A local model that supports tool calling must already be installed in Ollama; the application does not download models automatically.

## Sources

- Ollama API reference: https://docs.ollama.com/api/chat
- Ollama tool-calling guide and Python/REST examples: https://github.com/ollama/ollama/blob/main/docs/capabilities/tool-calling.mdx
- Ollama API overview: https://docs.ollama.com/api

Re-check the live API documentation when changing the Ollama client, message format, or tool-call handling.
