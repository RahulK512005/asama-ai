# Asama Local Assistant

A standalone, standard-library-only Python CLI for asking a **local Ollama model** about Linux hardware. It is independent of the Asama web application and must not be copied into or exposed through the web runtime/container.

## Local requirements

- Linux with Python 3.10 or newer.
- Ollama installed and running on the same machine, listening on `127.0.0.1:11434`.
- A model already pulled in Ollama (default: `llama3.2`; select another local model with `--model`).
- Optional read-only system utilities: `lscpu`, `lsblk`, `lspci`, and `dmidecode`. CPU `/proc` data is used as a fallback when `lscpu` is missing or unusable. `dmidecode` is never run through `sudo`; memory-slot and maximum-capacity details may remain unavailable to an unprivileged user.

No Python packages need to be installed. Ollama and optional Linux utilities are system prerequisites, not Python dependencies.

## Safe run

After starting local Ollama and ensuring the selected model is available, run from the project root:

```bash
cd local-assistant
python3 -m asama_local
# or select a model already installed locally:
python3 -m asama_local --model qwen2.5:7b
```

Ask questions at `you>`; follow-up turns use the current process's in-memory conversation. Type `/exit` to leave. The assistant contacts only the fixed loopback address `127.0.0.1:11434` and `/api/chat`. It has no remote URL setting, cloud fallback, web-service integration, upload, or persistent conversation store. Inspection uses fixed read-only argument vectors and explicit local file paths; user/model text is never interpreted as a command or path. No `shell=True`, `sudo`, or automatic elevation is used. Hardware probes may run when asked, so review the source if operating in a specially constrained environment.

## Tests

From the project root:

```bash
python3 -m unittest discover -s local-assistant/tests -v
```
