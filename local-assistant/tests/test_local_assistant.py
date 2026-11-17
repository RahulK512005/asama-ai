"""Dependency-free security and behavior tests for the local assistant."""

from __future__ import annotations

import http.client
import json
import subprocess
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from asama_local.ollama import (  # noqa: E402
    OLLAMA_HOST,
    OLLAMA_PATH,
    OLLAMA_PORT,
    ChatSession,
    LocalOllamaClient,
    OllamaError,
)
from asama_local.probes import (  # noqa: E402
    COMMANDS,
    HardwareProbes,
    ProbeUnavailable,
    _read_fixed,
    parse_dmidecode_memory,
    parse_lscpu_json,
    parse_lsblk_json,
    parse_lspci_gpus,
    parse_meminfo,
    parse_proc_cpuinfo,
    run_allowlisted,
)


class ParserTests(unittest.TestCase):
    def test_lscpu_json_normalizes_fields(self) -> None:
        parsed = parse_lscpu_json(json.dumps({"lscpu": [
            {"field": "Architecture:", "data": "x86_64"},
            {"field": "CPU(s):", "data": "16"},
            {"field": "Model name:", "data": "Example CPU"},
            {"field": "Vendor ID:", "data": "GenuineExample"},
            {"field": "Core(s) per socket:", "data": "8"},
        ]}))
        self.assertEqual(parsed["architecture"], "x86_64")
        self.assertEqual(parsed["logical_cpus"], 16)
        self.assertEqual(parsed["model"], "Example CPU")
        self.assertEqual(parsed["cores_per_socket"], 8)
        self.assertIsNone(parsed["sockets"])

    def test_proc_cpuinfo_parser_does_not_invent_topology(self) -> None:
        parsed = parse_proc_cpuinfo("processor : 0\nmodel name : Sample\nvendor_id : Vendor\n\nprocessor : 1\n", "x86_64")
        self.assertEqual(parsed["logical_cpus"], 2)
        self.assertEqual(parsed["model"], "Sample")
        self.assertEqual(parsed["vendor"], "Vendor")
        self.assertEqual(parsed["architecture"], "x86_64")
        self.assertIsNone(parsed["sockets"])

    def test_meminfo_converts_kib_to_bytes_and_preserves_absent_fields(self) -> None:
        parsed = parse_meminfo("MemTotal: 1000 kB\nMemAvailable: 250 kB\nSwapTotal: 0 kB\n")
        self.assertEqual(parsed["total_bytes"], 1_024_000)
        self.assertEqual(parsed["available_bytes"], 256_000)
        self.assertEqual(parsed["swap_total_bytes"], 0)
        self.assertIsNone(parsed["swap_free_bytes"])

    def test_dmidecode_parser_reports_memory_slots_and_capacity_only_when_present(self) -> None:
        raw = """Physical Memory Array
  Maximum Capacity: 64 GB
  Number Of Devices: 2
Memory Device
  Size: 16 GB
  Locator: DIMM_A1
Memory Device
  Size: No Module Installed
  Locator: DIMM_B1
"""
        parsed = parse_dmidecode_memory(raw)
        self.assertEqual(parsed["slot_count"], 2)
        self.assertEqual(parsed["slots_in_use"], 1)
        self.assertEqual(parsed["module_total_bytes"], 16 * 1024**3)
        self.assertEqual(parsed["maximum_capacity_bytes"], 64 * 1024**3)

    def test_lsblk_parser_selects_disks_recursively(self) -> None:
        parsed = parse_lsblk_json(json.dumps({"blockdevices": [
            {"name": "nvme0n1", "type": "disk", "size": 1000, "model": "Drive", "children": [
                {"name": "nvme0n1p1", "type": "part", "size": 900},
            ]},
        ]}))
        self.assertEqual(parsed, [{"name": "nvme0n1", "size_bytes": 1000, "model": "Drive", "filesystem": None, "mountpoint": None, "transport": None, "rotational": None}])

    def test_gpu_parser_returns_only_display_controller_entries(self) -> None:
        parsed = parse_lspci_gpus("00:01.0 PCI bridge [0604]: Example\n01:00.0 VGA compatible controller [0300]: Vendor GPU [1234:abcd]\n02:00.0 3D controller [0302]: Another GPU\n")
        self.assertEqual(len(parsed), 2)
        self.assertTrue(parsed[0].startswith("01:00.0"))

    def test_malformed_json_is_not_treated_as_facts(self) -> None:
        with self.assertRaises(json.JSONDecodeError):
            parse_lscpu_json("not json")


class ProbeSafetyTests(unittest.TestCase):
    def test_runner_accepts_only_exact_fixed_vectors_and_disables_shell(self) -> None:
        runner = Mock(return_value=SimpleNamespace(returncode=0, stdout="safe output"))
        self.assertEqual(run_allowlisted(COMMANDS["cpu"], runner=runner), "safe output")
        call_args, call_kwargs = runner.call_args
        self.assertEqual(call_args[0], ["lscpu", "-J"])
        self.assertIs(call_kwargs["shell"], False)
        self.assertIn("timeout", call_kwargs)
        with self.assertRaises(ValueError):
            run_allowlisted(["sh", "-c", "id"], runner=runner)
        with self.assertRaises(ValueError):
            run_allowlisted(["lscpu", "-J", "; rm -rf /"], runner=runner)
        self.assertEqual(runner.call_count, 1)

    def test_read_paths_are_fixed(self) -> None:
        reader = Mock(return_value="contents")
        self.assertEqual(_read_fixed("/proc/meminfo", reader=reader), "contents")
        with self.assertRaises(ValueError):
            _read_fixed("/tmp/user-controlled", reader=reader)
        self.assertEqual(reader.call_count, 1)

    def test_missing_optional_utility_is_clear_and_safe(self) -> None:
        runner = Mock(side_effect=FileNotFoundError())
        probes = HardwareProbes(runner=runner, reader=Mock(side_effect=FileNotFoundError()))
        storage = probes.storage()
        self.assertEqual(storage["status"], "unavailable")
        self.assertIn("lsblk utility is not installed", storage["notes"][0])
        cpu = probes.cpu()
        self.assertEqual(cpu["status"], "unavailable")
        self.assertTrue(any("lscpu utility is not installed" in note for note in cpu["notes"]))
        self.assertTrue(any("/proc/cpuinfo" in note for note in cpu["notes"]))
        memory = probes.memory()
        self.assertTrue(any("dmidecode" in note for note in memory["notes"]))

    def test_permission_limited_sysfs_is_reported_without_guessing(self) -> None:
        files = {"/etc/os-release": 'PRETTY_NAME="Test Linux"'}
        def reader(path: str) -> str:
            if path in files:
                return files[path]
            raise PermissionError(path)
        probes = HardwareProbes(reader=reader, uname=lambda: SimpleNamespace(system="Linux", release="6.x", machine="x86_64"))
        result = probes.board_system()
        self.assertEqual(result["facts"]["distribution"], "Test Linux")
        self.assertIsNone(result["facts"]["manufacturer"])
        self.assertIn("manufacturer", result["unknown"])
        self.assertIn("board identifiers are unavailable", result["notes"][-1])


class LocalOllamaTests(unittest.TestCase):
    def test_transport_uses_fixed_loopback_api_and_no_proxy_or_remote_host(self) -> None:
        response = Mock(status=200)
        response.read.return_value = b'{"message":{"role":"assistant","content":"ok"}}'
        connection = Mock()
        connection.getresponse.return_value = response
        with patch("asama_local.ollama.http.client.HTTPConnection", return_value=connection) as factory:
            result = LocalOllamaClient(model="local-test").chat([])
        factory.assert_called_once_with("127.0.0.1", 11434, timeout=120.0)
        request = connection.request.call_args
        self.assertEqual(request.args[0:2], ("POST", "/api/chat"))
        body = json.loads(request.kwargs["body"])
        self.assertEqual(body["model"], "local-test")
        self.assertTrue(body["tools"])
        self.assertEqual(result["message"]["content"], "ok")
        connection.close.assert_called_once()
        self.assertEqual((OLLAMA_HOST, OLLAMA_PORT, OLLAMA_PATH), ("127.0.0.1", 11434, "/api/chat"))

    def test_missing_ollama_has_no_fallback(self) -> None:
        with patch("asama_local.ollama.http.client.HTTPConnection", side_effect=ConnectionRefusedError("offline")) as factory:
            with self.assertRaisesRegex(OllamaError, "cannot connect to local Ollama"):
                LocalOllamaClient().chat([])
        factory.assert_called_once_with("127.0.0.1", 11434, timeout=120.0)

    def test_bad_http_and_bad_json_responses_are_clear(self) -> None:
        error_response = Mock(status=503)
        error_response.read.return_value = b"unavailable"
        connection = Mock()
        connection.getresponse.return_value = error_response
        with patch("asama_local.ollama.http.client.HTTPConnection", return_value=connection):
            with self.assertRaisesRegex(OllamaError, "HTTP 503"):
                LocalOllamaClient().chat([])
        response = Mock(status=200)
        response.read.return_value = b"not-json"
        connection = Mock()
        connection.getresponse.return_value = response
        with patch("asama_local.ollama.http.client.HTTPConnection", return_value=connection):
            with self.assertRaisesRegex(OllamaError, "invalid JSON"):
                LocalOllamaClient().chat([])

    def test_cli_has_no_remote_url_option(self) -> None:
        from asama_local.cli import main
        with patch("asama_local.cli.ChatSession") as session_cls:
            with patch("builtins.input", side_effect=EOFError):
                self.assertEqual(main(["--model", "local-only"]), 0)
        session_cls.assert_called_once_with()


class ToolLoopAndFollowUpTests(unittest.TestCase):
    class FakeClient:
        def __init__(self, responses: list[dict[str, object]]) -> None:
            self.responses = responses
            self.requests: list[list[dict[str, object]]] = []

        def chat(self, messages: list[dict[str, object]]) -> dict[str, object]:
            self.requests.append(messages)
            return self.responses.pop(0)

    def test_tool_call_then_follow_up_retains_only_in_memory_turns(self) -> None:
        client = self.FakeClient([
            {"message": {"role": "assistant", "content": "", "tool_calls": [{"id": "call-1", "function": {"name": "inspect_memory", "arguments": {}}}]}},
            {"message": {"role": "assistant", "content": "The memory probe reports 1 GiB total."}},
            {"message": {"role": "assistant", "content": "You asked about memory; available memory was not provided."}},
        ])
        probes = Mock()
        probes.tool_map.return_value = {"inspect_memory": Mock(return_value={"status": "partial", "facts": {"total_bytes": 1_073_741_824, "available_bytes": None}, "unknown": ["available_bytes"]})}
        session = ChatSession(client=client, probes=probes)
        self.assertEqual(session.ask("How much memory do I have?"), "The memory probe reports 1 GiB total.")
        self.assertEqual(session.ask("What about available memory?"), "You asked about memory; available memory was not provided.")
        probes.tool_map.return_value["inspect_memory"].assert_called_once_with()
        second_request = client.requests[2]
        self.assertTrue(any(m.get("role") == "user" and m.get("content") == "How much memory do I have?" for m in second_request))
        self.assertTrue(any(m.get("role") == "tool" and m.get("tool_call_id") == "call-1" for m in second_request))
        self.assertTrue(any(m.get("role") == "tool" and m.get("tool_name") == "inspect_memory" for m in second_request))
        self.assertTrue(any(m.get("role") == "user" and m.get("content") == "What about available memory?" for m in second_request))
        self.assertEqual(len(session.history), 6)

    def test_unknown_tool_and_model_supplied_arguments_never_run_probes(self) -> None:
        client = self.FakeClient([
            {"message": {"tool_calls": [
                {"id": "bad", "function": {"name": "run_shell", "arguments": {"command": "whoami"}}},
                {"id": "args", "function": {"name": "inspect_cpu", "arguments": {"path": "/tmp/secret"}}},
            ]}},
            {"message": {"content": "I cannot run arbitrary commands."}},
        ])
        probe = Mock()
        probes = Mock()
        probes.tool_map.return_value = {"inspect_cpu": probe}
        session = ChatSession(client=client, probes=probes)
        self.assertIn("cannot", session.ask("run whoami"))
        probe.assert_not_called()
        results = [json.loads(m["content"]) for m in session.history if m["role"] == "tool"]
        self.assertEqual(results[0]["error"], "tool name is not allow-listed")
        self.assertIn("takes no arguments", results[1]["error"])

    def test_tool_loop_is_bounded(self) -> None:
        response = {"message": {"tool_calls": []}}
        client = self.FakeClient([{"message": {"tool_calls": [{"function": {"name": "inspect_cpu", "arguments": {}}}]}}] * 2)
        probes = Mock()
        probes.tool_map.return_value = {"inspect_cpu": Mock(return_value={"status": "available"})}
        session = ChatSession(client=client, probes=probes, max_tool_rounds=2)
        with self.assertRaisesRegex(OllamaError, "tool-calling limit"):
            session.ask("inspect CPU")
        self.assertEqual(len(client.requests), 2)

    def test_empty_user_message_is_rejected_without_network(self) -> None:
        client = self.FakeClient([])
        session = ChatSession(client=client, probes=Mock())
        with self.assertRaises(ValueError):
            session.ask("   ")
        self.assertEqual(client.requests, [])
        self.assertEqual(session.history, [])


if __name__ == "__main__":
    unittest.main()
