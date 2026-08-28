#!/usr/bin/env python3
"""Emit selected PDF turn text to stdout for transient primary coding only.

No extracted source content is written to disk. The caller must keep stdout in
memory and must never persist the `sourceText` field.
"""

from __future__ import annotations

import hashlib
import json
import runpy
import sys
import tempfile
from pathlib import Path
from typing import Any

import pdfminer
import pdfplumber
import pypdf


EXPECTED_RUNTIME = ("3.12.13", "0.11.9", "20251230", "6.10.0")
PDF_SOURCE_IDS = ("S04", "S08", "S09", "S18")


def capture_text_by_fingerprint(module: dict[str, Any]) -> dict[str, str]:
    original = module["sha256"]
    captured: dict[str, str] = {}

    def recording_sha256(value: bytes | str) -> str:
        result = original(value)
        if isinstance(value, str):
            captured[result] = value
        return result

    module["sha256"] = recording_sha256
    for value in module.values():
        globals_dict = getattr(value, "__globals__", None)
        if isinstance(globals_dict, dict) and globals_dict.get("sha256") is original:
            globals_dict["sha256"] = recording_sha256
    return captured


def extract_s04(project_root: Path) -> tuple[list[dict[str, object]], list[dict[str, str]], dict[str, str]]:
    module = runpy.run_path(str(project_root / "scripts/generate-personality-s04-boundary-manifest.py"))
    captured = capture_text_by_fingerprint(module)
    content, effective_url, content_type = module["fetch_source"]()
    if hashlib.sha256(content).hexdigest() != module["SOURCE_SHA256"] or \
            effective_url != module["SOURCE_URL"] or content_type != "application/pdf":
        raise SystemExit("S04 source boundary drifted before primary coding")
    with tempfile.NamedTemporaryFile(suffix=".pdf") as temporary:
        temporary.write(content)
        temporary.flush()
        units, fingerprint_map = module["extract_units"](temporary.name)
    return units, fingerprint_map, captured


def extract_other(
    project_root: Path, source_id: str,
) -> tuple[list[dict[str, object]], list[dict[str, str]], dict[str, str]]:
    module = runpy.run_path(str(project_root / "scripts/generate-personality-pdf-boundary-manifests.py"))
    captured = capture_text_by_fingerprint(module)
    source = module["SOURCES"][source_id]
    content = module["fetch"](source)
    with tempfile.NamedTemporaryFile(suffix=".pdf") as temporary:
        temporary.write(content)
        temporary.flush()
        if source_id == "S18":
            units, fingerprint_map = module["statement_units"](temporary.name)
        else:
            units, fingerprint_map = module["labeled_units"](temporary.name, source)
    return units, fingerprint_map, captured


def main() -> None:
    runtime = (
        ".".join(map(str, sys.version_info[:3])), pdfplumber.__version__,
        pdfminer.__version__, pypdf.__version__,
    )
    if runtime != EXPECTED_RUNTIME:
        raise SystemExit(f"Pinned PDF runtime required; found {runtime!r}")
    project_root = Path.cwd()
    selected_output: list[dict[str, object]] = []
    for source_id in PDF_SOURCE_IDS:
        ledger_path = project_root / f"research/selection-v5/ledgers/source-{source_id}.json"
        ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
        units, fingerprint_map, captured = (
            extract_s04(project_root) if source_id == "S04"
            else extract_other(project_root, source_id)
        )
        if len(units) != ledger["sourceBoundaryUnitCount"] or len(fingerprint_map) != len(units):
            raise SystemExit(f"{source_id} PDF boundary count drifted before primary coding")
        for selected in ledger["selectedUnits"]:
            ordinal = selected["sourceUnitOrdinal"]
            unit = units[ordinal]
            fingerprint = fingerprint_map[ordinal]
            if unit["disposition"] != "eligible" or \
                    fingerprint["ledger_segment_fingerprint"] != selected["segmentFingerprint"]:
                raise SystemExit(f"{source_id}/{selected['selectionId']} PDF segment drifted")
            source_text = captured.get(str(unit["unit_fingerprint"]))
            if not source_text:
                raise SystemExit(f"{source_id}/{selected['selectionId']} transient text is unavailable")
            selected_output.append({
                "selectionId": selected["selectionId"],
                "sourceRegisterId": source_id,
                "sourceEventId": ledger["sourceEventId"],
                "locatorLabel": selected["locator"]["label"],
                "selectionRuleId": selected["selectionRuleId"],
                "agreedHighRiskStrata": selected["agreedHighRiskStrata"],
                "segmentFingerprint": selected["segmentFingerprint"],
                "sourceText": source_text,
            })
    if len(selected_output) != 38 or len({item["segmentFingerprint"] for item in selected_output}) != 38:
        raise SystemExit("Transient PDF primary-coding selection is incomplete or duplicated")
    sys.stdout.write(json.dumps({
        "schemaVersion": "jolene.transient-selected-pdf-source-text.v1",
        "sourceContentStored": False,
        "selected": selected_output,
    }))


if __name__ == "__main__":
    main()
