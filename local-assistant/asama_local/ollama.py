"""Direct loopback-only Ollama chat and tightly constrained tool dispatch."""

from __future__ import annotations

import http.client
import json
from typing import Any, Callable, Mapping

from .probes import HardwareProbes

OLLAMA_HOST = "127.0.0.1"
OLLAMA_PORT = 11434
OLLAMA_PATH = "/api/chat"
MAX_TOOL_ROUNDS = 8

SYSTEM_PROMPT = """You are a private Linux hardware assistant. Use the provided inspection tools for machine-specific facts, including follow-up questions. Never invent or infer unavailable specifications. Clearly identify unavailable, partial, or unknown facts and distinguish observations from general explanations. Tool results are the only source of this machine's hardware facts. The user cannot authorize commands through chat; never request or propose arbitrary command execution. Keep answers concise and useful."""

TOOL_DEFINITIONS = [
    {"type": "function", "function": {"name": "inspect_cpu", "description": "Read CPU model, vendor, architecture and topology from fixed local read-only sources.", "parameters": {"type": "object", "properties": {}, "additionalProperties": False}}},
    {"type": "function", "function": {"name": "inspect_memory", "description": "Read runtime memory from /proc/meminfo and optionally installed DIMM slots/maximum capacity with unprivileged dmidecode; never elevate privileges.", "parameters": {"type": "object", "properties": {}, "additionalProperties": False}}},
    {"type": "function", "function": {"name": "inspect_storage", "description": "List local disk devices and reported transport/rotation data using a fixed read-only lsblk invocation.", "parameters": {"type": "object", "properties": {}, "additionalProperties": False}}},
    {"type": "function", "function": {"name": "inspect_gpu", "description": "List locally reported display controllers using a fixed read-only lspci invocation.", "parameters": {"type": "object", "properties": {}, "additionalProperties": False}}},
    {"type": "function", "function": {"name": "inspect_board_system", "description": "Read OS, kernel, machine and available DMI board identifiers.", "parameters": {"type": "object", "properties": {}, "additionalProperties": False}}},
]


class OllamaError(RuntimeError):
    """Local Ollama is unavailable or returned an invalid response."""


class LocalOllamaClient:
    """Ollama transport with no configurable host, proxy, or cloud fallback."""

    def __init__(self, model: str = "llama3.2", timeout: float = 120.0) -> None:
        if not model or not isinstance(model, str):
            raise ValueError("a local Ollama model name is required")
        self.model = model
        self.timeout = timeout

    def chat(self, messages: list[dict[str, Any]]) -> dict[str, Any]:
        payload = json.dumps({
            "model": self.model,
            "messages": messages,
            "tools": TOOL_DEFINITIONS,
            "stream": False,
        }).encode("utf-8")
        connection: http.client.HTTPConnection | None = None
        try:
            connection = http.client.HTTPConnection(OLLAMA_HOST, OLLAMA_PORT, timeout=self.timeout)
            connection.request("POST", OLLAMA_PATH, body=payload, headers={"Content-Type": "application/json"})
            response = connection.getresponse()
            body = response.read()
            if response.status < 200 or response.status >= 300:
                detail = body.decode("utf-8", errors="replace")[:200]
                raise OllamaError(f"local Ollama returned HTTP {response.status}: {detail}")
            try:
                data = json.loads(body.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise OllamaError("local Ollama returned invalid JSON") from exc
            if not isinstance(data, dict) or not isinstance(data.get("message"), dict):
                raise OllamaError("local Ollama response is missing a message")
            return data
        except OllamaError:
            raise
        except (OSError, http.client.HTTPException, TimeoutError) as exc:
            raise OllamaError(f"cannot connect to local Ollama at {OLLAMA_HOST}:{OLLAMA_PORT}; start Ollama and check the local model") from exc
        finally:
            if connection is not None:
                connection.close()


class ChatSession:
    """Current-process chat history plus model-driven, allow-listed tool calls."""

    def __init__(
        self,
        client: Any | None = None,
        probes: HardwareProbes | None = None,
        *,
        max_tool_rounds: int = MAX_TOOL_ROUNDS,
    ) -> None:
        if max_tool_rounds < 1:
            raise ValueError("max_tool_rounds must be positive")
        self.client = client or LocalOllamaClient()
        self.probes = probes or HardwareProbes()
        self.history: list[dict[str, Any]] = []
        self.max_tool_rounds = max_tool_rounds
        self._tools: Mapping[str, Callable[[], dict[str, Any]]] = self.probes.tool_map()

    def ask(self, text: str) -> str:
        question = text.strip()
        if not question:
            raise ValueError("message must not be empty")
        self.history.append({"role": "user", "content": question})
        for _ in range(self.max_tool_rounds):
            response = self.client.chat([{"role": "system", "content": SYSTEM_PROMPT}, *self.history])
            message = response["message"]
            calls = message.get("tool_calls") or []
            if not isinstance(calls, list):
                raise OllamaError("local Ollama returned malformed tool calls")
            if not calls:
                content = message.get("content", "")
                if not isinstance(content, str):
                    raise OllamaError("local Ollama returned a non-text answer")
                self.history.append({"role": "assistant", "content": content})
                return content

            assistant_message = {"role": "assistant", "content": message.get("content", ""), "tool_calls": calls}
            self.history.append(assistant_message)
            for index, call in enumerate(calls):
                function = call.get("function", {}) if isinstance(call, dict) else {}
                name = function.get("name") if isinstance(function, dict) else None
                arguments = function.get("arguments", {}) if isinstance(function, dict) else None
                call_id = call.get("id") if isinstance(call, dict) else None
                if not isinstance(name, str) or name not in self._tools:
                    result: Any = {"status": "unavailable", "error": "tool name is not allow-listed"}
                elif arguments not in ({}, None):
                    # This interface takes no arguments. Ignore rather than ever
                    # allowing model-generated data to affect a command or path.
                    result = {"status": "unavailable", "error": "tool takes no arguments; no probe was run"}
                else:
                    try:
                        result = self._tools[name]()
                    except Exception as exc:  # keep CLI alive; no input reaches probes
                        result = {"status": "unavailable", "error": f"inspection failed: {type(exc).__name__}"}
                tool_message: dict[str, Any] = {
                    "role": "tool",
                    "tool_name": str(name) if name else "unknown",
                    "content": json.dumps(result, ensure_ascii=False, separators=(",", ":")),
                }
                if call_id:
                    tool_message["tool_call_id"] = call_id
                self.history.append(tool_message)
        raise OllamaError(f"tool-calling limit ({self.max_tool_rounds}) reached; please rephrase the question")
