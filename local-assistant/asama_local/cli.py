"""Interactive command-line entry point."""

from __future__ import annotations

import argparse
import sys

from .ollama import ChatSession, OllamaError


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Ask a local Ollama model about this Linux system.")
    parser.add_argument("--model", default="llama3.2", help="model name already available in local Ollama (default: llama3.2)")
    args = parser.parse_args(argv)
    print("Asama Local Assistant — local Ollama only. Type /exit to quit; history is discarded on exit.")
    session = ChatSession()
    # The model is set at construction; the transport has no remote URL option.
    session.client.model = args.model
    while True:
        try:
            line = input("you> ")
        except (EOFError, KeyboardInterrupt):
            print("\nGoodbye.")
            return 0
        if line.strip().lower() in {"/exit", "/quit", "exit", "quit"}:
            print("Goodbye.")
            return 0
        if not line.strip():
            continue
        try:
            answer = session.ask(line)
            print(f"assistant> {answer}")
        except (OllamaError, ValueError) as exc:
            print(f"assistant> {exc}", file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())
