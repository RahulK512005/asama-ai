"""Read-only, narrowly allow-listed hardware inspection for Linux.

No probe accepts commands or paths from a caller. Every executable argument
vector and file path is fixed in this module; subprocess is always shell-free.
"""

from __future__ import annotations

import json
import platform
import re
import subprocess
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence


COMMANDS: Mapping[str, tuple[str, ...]] = {
    "cpu": ("lscpu", "-J"),
    "memory": ("dmidecode", "--type", "memory"),
    "storage": ("lsblk", "--json", "--bytes", "--output", "NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT,MODEL,TRAN,ROTA"),
    "gpu": ("lspci", "-nn"),
}

# A closed set of files used by the probes; no caller-supplied paths are read.
READABLE_PATHS = frozenset({
    "/proc/cpuinfo",
    "/proc/meminfo",
    "/etc/os-release",
    "/sys/class/dmi/id/sys_vendor",
    "/sys/class/dmi/id/product_name",
    "/sys/class/dmi/id/board_name",
    "/sys/class/dmi/id/board_vendor",
    "/sys/class/dmi/id/board_version",
})

COMMAND_TIMEOUT_SECONDS = 5


class ProbeUnavailable(RuntimeError):
    """A fixed probe could not return usable data."""


def run_allowlisted(
    argv: Sequence[str],
    *,
    runner: Callable[..., Any] = subprocess.run,
) -> str:
    """Run one exact, read-only approved argv vector; never a shell command."""
    fixed = tuple(argv)
    if fixed not in COMMANDS.values():
        raise ValueError("command is not in the hardware probe allow-list")
    try:
        result = runner(
            list(fixed),
            capture_output=True,
            text=True,
            timeout=COMMAND_TIMEOUT_SECONDS,
            check=False,
            shell=False,
        )
    except FileNotFoundError as exc:
        raise ProbeUnavailable(f"{fixed[0]} utility is not installed") from exc
    except subprocess.TimeoutExpired as exc:
        raise ProbeUnavailable(f"{fixed[0]} probe timed out") from exc
    except OSError as exc:
        raise ProbeUnavailable(f"{fixed[0]} could not be run") from exc
    if result.returncode != 0:
        raise ProbeUnavailable(f"{fixed[0]} returned exit status {result.returncode}")
    return result.stdout


def _read_fixed(path: str, *, reader: Callable[..., str] | None = None) -> str:
    if path not in READABLE_PATHS:
        raise ValueError("file path is not in the hardware probe read allow-list")
    try:
        if reader is not None:
            return reader(path)
        return Path(path).read_text(encoding="utf-8", errors="replace")
    except (OSError, PermissionError) as exc:
        raise ProbeUnavailable(f"{path} is unavailable or unreadable") from exc


def _result(facts: dict[str, Any], *, source: str, errors: list[str] | None = None) -> dict[str, Any]:
    errors = errors or []
    known = any(value is not None and value != [] for value in facts.values())
    missing = any(value is None or value == [] for value in facts.values())
    status = "unavailable" if not known else ("partial" if errors or missing else "available")
    return {
        "status": status,
        "facts": facts,
        "unknown": [key for key, value in facts.items() if value is None or value == []],
        "sources": [source] if known else [],
        "notes": errors,
    }


def parse_lscpu_json(raw: str) -> dict[str, Any]:
    data = json.loads(raw)
    rows = data.get("lscpu")
    if not isinstance(rows, list):
        raise ValueError("unexpected lscpu JSON structure")
    fields: dict[str, str] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        key = str(row.get("field", "")).rstrip(":").strip().lower()
        value = row.get("data")
        if key and value is not None:
            fields[key] = str(value).strip()

    def pick(*keys: str) -> str | None:
        for key in keys:
            if fields.get(key):
                return fields[key]
        return None

    count = pick("cpu(s)", "on-line cpu(s) list")
    try:
        logical_cpus: int | None = int(count) if count and count.isdigit() else None
    except ValueError:
        logical_cpus = None
    return {
        "model": pick("model name", "model"),
        "vendor": pick("vendor id", "vendor"),
        "architecture": pick("architecture"),
        "logical_cpus": logical_cpus,
        "sockets": _integer(pick("socket(s)")),
        "cores_per_socket": _integer(pick("core(s) per socket")),
        "threads_per_core": _integer(pick("thread(s) per core")),
    }


def parse_proc_cpuinfo(raw: str, architecture: str | None = None) -> dict[str, Any]:
    fields: dict[str, str] = {}
    logical = 0
    for line in raw.splitlines():
        if not line.strip():
            continue
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key, value = key.strip().lower(), value.strip()
        if key in {"processor", "hart"}:
            logical += 1
        elif key in {"model name", "hardware", "cpu model"}:
            fields.setdefault("model", value)
        elif key in {"vendor_id", "cpu implementer"}:
            fields.setdefault("vendor", value)
        elif key == "cpu architecture":
            fields.setdefault("architecture", value)
    return {
        "model": fields.get("model"),
        "vendor": fields.get("vendor"),
        "architecture": fields.get("architecture") or architecture,
        "logical_cpus": logical or None,
        "sockets": None,
        "cores_per_socket": None,
        "threads_per_core": None,
    }


def parse_meminfo(raw: str) -> dict[str, int | None]:
    values: dict[str, int | None] = {"total_bytes": None, "available_bytes": None, "swap_total_bytes": None, "swap_free_bytes": None}
    mapping = {
        "MemTotal": "total_bytes",
        "MemAvailable": "available_bytes",
        "SwapTotal": "swap_total_bytes",
        "SwapFree": "swap_free_bytes",
    }
    for line in raw.splitlines():
        if ":" not in line:
            continue
        key, rest = line.split(":", 1)
        if key not in mapping:
            continue
        match = re.match(r"\s*(\d+)\s*(kB)?\s*$", rest)
        if match:
            number = int(match.group(1))
            values[mapping[key]] = number * 1024 if match.group(2) else number
    return values


def _capacity_to_bytes(value: str) -> int | None:
    match = re.match(r"\s*([\d.]+)\s*(B|KB|MB|GB|TB|KIB|MIB|GIB|TIB)?\s*$", value, re.IGNORECASE)
    if not match:
        return None
    number = float(match.group(1))
    unit = (match.group(2) or "B").upper()
    exponent = {"B": 0, "KB": 1, "KIB": 1, "MB": 2, "MIB": 2, "GB": 3, "GIB": 3, "TB": 4, "TIB": 4}.get(unit)
    if exponent is None:
        return None
    return int(number * (1024 ** exponent))


def parse_dmidecode_memory(raw: str) -> dict[str, int | None]:
    """Parse memory-array capacity and installed DIMMs without inferring missing values."""
    maximum_match = re.search(r"(?mi)^\s*Maximum Capacity:\s*(.+?)\s*$", raw)
    maximum = _capacity_to_bytes(maximum_match.group(1)) if maximum_match else None
    chunks = re.split(r"(?m)^Memory Device\s*$", raw)
    devices = chunks[1:] if len(chunks) > 1 else []
    installed_sizes: list[int] = []
    for device in devices:
        size_match = re.search(r"(?mi)^\s*Size:\s*(.+?)\s*$", device)
        if not size_match:
            continue
        size_value = size_match.group(1).strip()
        if size_value.lower() in {"no module installed", "not installed", "unknown", "none"}:
            continue
        size_bytes = _capacity_to_bytes(size_value)
        if size_bytes is not None and size_bytes > 0:
            installed_sizes.append(size_bytes)
    return {
        "slot_count": len(devices) if devices else None,
        "slots_in_use": len(installed_sizes) if devices else None,
        "module_total_bytes": sum(installed_sizes) if devices else None,
        "maximum_capacity_bytes": maximum,
    }


def parse_lsblk_json(raw: str) -> list[dict[str, Any]]:
    data = json.loads(raw)
    devices = data.get("blockdevices")
    if not isinstance(devices, list):
        raise ValueError("unexpected lsblk JSON structure")
    disks: list[dict[str, Any]] = []

    def visit(entries: list[Any]) -> None:
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            if str(entry.get("type", "")).lower() == "disk":
                size = entry.get("size")
                try:
                    size_bytes = int(size) if size is not None else None
                except (ValueError, TypeError):
                    size_bytes = None
                disks.append({
                    "name": entry.get("name"),
                    "size_bytes": size_bytes,
                    "model": entry.get("model"),
                    "filesystem": entry.get("fstype"),
                    "mountpoint": entry.get("mountpoint"),
                    "transport": entry.get("tran"),
                    "rotational": None if entry.get("rota") is None else str(entry.get("rota")).strip().lower() in {"1", "true", "yes"},
                })
            children = entry.get("children")
            if isinstance(children, list):
                visit(children)

    visit(devices)
    return disks


def parse_lspci_gpus(raw: str) -> list[str]:
    patterns = ("vga compatible controller", "3d controller", "display controller")
    return [line.strip() for line in raw.splitlines() if any(token in line.lower() for token in patterns)]


def _integer(value: str | None) -> int | None:
    if value is None:
        return None
    match = re.match(r"\s*(\d+)", value)
    return int(match.group(1)) if match else None


class HardwareProbes:
    """Fixed collection of hardware facts, with injectable I/O for tests."""

    def __init__(
        self,
        *,
        runner: Callable[..., Any] = subprocess.run,
        reader: Callable[[str], str] | None = None,
        uname: Callable[[], Any] = platform.uname,
    ) -> None:
        self._runner = runner
        self._reader = reader
        self._uname = uname

    def _file(self, path: str) -> str:
        return _read_fixed(path, reader=self._reader)

    def cpu(self) -> dict[str, Any]:
        errors: list[str] = []
        facts: dict[str, Any] | None = None
        try:
            facts = parse_lscpu_json(run_allowlisted(COMMANDS["cpu"], runner=self._runner))
            source = "lscpu"
        except (ProbeUnavailable, ValueError, json.JSONDecodeError) as exc:
            errors.append(str(exc))
            try:
                facts = parse_proc_cpuinfo(self._file("/proc/cpuinfo"), platform.machine())
                source = "/proc/cpuinfo"
            except ProbeUnavailable as fallback_exc:
                errors.append(str(fallback_exc))
                source = "/proc/cpuinfo"
        return _result(facts or {"model": None, "vendor": None, "architecture": None, "logical_cpus": None, "sockets": None, "cores_per_socket": None, "threads_per_core": None}, source=source, errors=errors if facts is None or any(v is None for v in facts.values()) else [])

    def memory(self) -> dict[str, Any]:
        facts: dict[str, Any] = {
            "total_bytes": None,
            "available_bytes": None,
            "swap_total_bytes": None,
            "swap_free_bytes": None,
            "slot_count": None,
            "slots_in_use": None,
            "module_total_bytes": None,
            "maximum_capacity_bytes": None,
        }
        sources: list[str] = []
        errors: list[str] = []
        try:
            facts.update(parse_meminfo(self._file("/proc/meminfo")))
            sources.append("/proc/meminfo")
        except ProbeUnavailable as exc:
            errors.append(str(exc))
        try:
            facts.update(parse_dmidecode_memory(run_allowlisted(COMMANDS["memory"], runner=self._runner)))
            sources.append("dmidecode --type memory (unprivileged)")
        except (ProbeUnavailable, ValueError) as exc:
            # DMI often needs privileges. Never request or invoke sudo automatically.
            errors.append(f"memory-slot details unavailable without elevated privileges: {exc}")
        source = ", ".join(sources) or "/proc/meminfo and dmidecode"
        return _result(facts, source=source, errors=errors)

    def storage(self) -> dict[str, Any]:
        try:
            disks = parse_lsblk_json(run_allowlisted(COMMANDS["storage"], runner=self._runner))
            notes = [] if disks else ["lsblk did not report any disk devices"]
            return _result({"disks": disks}, source="lsblk", errors=notes)
        except (ProbeUnavailable, ValueError, json.JSONDecodeError) as exc:
            return _result({"disks": []}, source="lsblk", errors=[str(exc)])

    def gpu(self) -> dict[str, Any]:
        try:
            devices = parse_lspci_gpus(run_allowlisted(COMMANDS["gpu"], runner=self._runner))
            notes = [] if devices else ["no display-controller entries were reported by lspci"]
            return _result({"devices": devices}, source="lspci -nn", errors=notes)
        except ProbeUnavailable as exc:
            return _result({"devices": []}, source="lspci -nn", errors=[str(exc)])

    def board_system(self) -> dict[str, Any]:
        system = self._uname()
        facts: dict[str, Any] = {
            "system": getattr(system, "system", None) or None,
            "release": getattr(system, "release", None) or None,
            "machine": getattr(system, "machine", None) or None,
            "distribution": None,
            "manufacturer": None,
            "product": None,
            "board_name": None,
            "board_vendor": None,
            "board_version": None,
        }
        errors: list[str] = []
        try:
            for line in self._file("/etc/os-release").splitlines():
                if line.startswith("PRETTY_NAME="):
                    facts["distribution"] = line.split("=", 1)[1].strip().strip('"')
                    break
        except ProbeUnavailable as exc:
            errors.append(str(exc))
        fields = {
            "manufacturer": "/sys/class/dmi/id/sys_vendor",
            "product": "/sys/class/dmi/id/product_name",
            "board_name": "/sys/class/dmi/id/board_name",
            "board_vendor": "/sys/class/dmi/id/board_vendor",
            "board_version": "/sys/class/dmi/id/board_version",
        }
        for fact, path in fields.items():
            try:
                value = self._file(path).strip()
                facts[fact] = value or None
            except ProbeUnavailable:
                # DMI identifiers are commonly absent or permission-restricted.
                pass
        if not any(facts[key] for key in ("manufacturer", "product", "board_name", "board_vendor", "board_version")):
            errors.append("board identifiers are unavailable or unreadable")
        return _result(facts, source="platform, /etc/os-release, /sys/class/dmi/id", errors=errors)

    def tool_map(self) -> dict[str, Callable[[], dict[str, Any]]]:
        return {
            "inspect_cpu": self.cpu,
            "inspect_memory": self.memory,
            "inspect_storage": self.storage,
            "inspect_gpu": self.gpu,
            "inspect_board_system": self.board_system,
        }
