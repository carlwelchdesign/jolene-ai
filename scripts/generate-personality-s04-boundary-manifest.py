#!/usr/bin/env python3
"""Recompute the metadata-only S04 PDF boundary manifest.

The generated artifact contains locators, classifications, counts, and SHA-256
fingerprints only. It never persists extracted source text.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import tempfile
import unicodedata
import urllib.request
from collections import defaultdict
from pathlib import Path

import pdfminer
import pdfplumber
import pypdf


SOURCE_URL = "https://www.press.org/sites/default/files/20090210_parton.pdf"
SOURCE_SHA256 = "7f7db3b1766d2656041cbbe6bfdf5df3c2f3342bf4904a4be94027260a018cc5"
EXPECTED_RUNTIME = ("3.12.13", "0.11.9", "20251230", "6.10.0")
LABEL = re.compile(r"^(MS\. PARTON|MS\. LEINWAND|MODERATOR):?\s*(.*)$")
PAGE_NUMBER = re.compile(r"^(?:PAGE\s+)?\d+$")
SOURCE_CONTROL = re.compile(r"^END$")
TOKEN = re.compile(r"[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)?")
PERFORMANCE_SPAN = re.compile(
    r"\[(?:PERFORMANCE|SINGING)\]|\([^)]*\bSINGING\b[^)]*\)", re.IGNORECASE
)
NONVERBAL_SPAN = re.compile(
    r"\([^)]*\b(?:LAUGH|LAUGHTER|APPLAUSE|AFFIRM)\b[^)]*\)", re.IGNORECASE
)
UNREADABLE_SPAN = re.compile(
    r"\([^)]*\b(?:INAUDIBLE|UNINTEL|UNINTELLIGIBLE)\b[^)]*\)", re.IGNORECASE
)
CLOSED_FRAGMENT_TOKENS = {
    "yes", "no", "yeah", "yep", "right", "exactly", "sure", "okay", "ok",
    "absolutely", "certainly", "well", "oh", "and", "uh", "huh", "mm",
    "thank", "you", "true", "correct", "indeed",
}


def sha256(value: bytes | str) -> str:
    payload = value if isinstance(value, bytes) else value.encode("utf-8")
    return f"sha256:{hashlib.sha256(payload).hexdigest()}"


def ledger_fingerprint(segments: list[str]) -> str:
    digest = hashlib.sha256()
    for segment in segments:
        payload = normalized(segment).encode("utf-8")
        if not payload:
            raise SystemExit("Canonical ledger fingerprint contains an empty segment")
        digest.update(len(payload).to_bytes(8, byteorder="big", signed=False))
        digest.update(payload)
    return f"sha256:{digest.hexdigest()}"


def normalized(value: str) -> str:
    return " ".join(unicodedata.normalize("NFC", value).split())


def cue_metadata(text: str) -> tuple[list[str], dict[str, int], list[tuple[int, int]]]:
    categories: list[str] = []
    counts = {"PERFORMANCE": 0, "SINGING": 0, "LAUGHTER": 0, "APPLAUSE": 0,
              "INAUDIBLE": 0}
    removable: list[tuple[int, int]] = []
    performance_spans = list(PERFORMANCE_SPAN.finditer(text))
    nonverbal_spans = list(NONVERBAL_SPAN.finditer(text))
    unreadable_spans = list(UNREADABLE_SPAN.finditer(text))
    if performance_spans:
        categories.append("performance")
        for match in performance_spans:
            span = match.group(0)
            counts["PERFORMANCE"] += len(re.findall(r"\bPERFORMANCE\b", span, re.I))
            counts["SINGING"] += len(re.findall(r"\bSINGING\b", span, re.I))
    if nonverbal_spans:
        categories.append("nonverbal")
        for match in nonverbal_spans:
            span = match.group(0)
            counts["LAUGHTER"] += len(re.findall(r"\b(?:LAUGH|LAUGHTER)\b", span, re.I))
            counts["APPLAUSE"] += len(re.findall(r"\bAPPLAUSE\b", span, re.I))
            removable.append(match.span())
    if unreadable_spans:
        categories.append("unreadable")
        for match in unreadable_spans:
            span = match.group(0)
            counts["INAUDIBLE"] += len(
                re.findall(r"\b(?:INAUDIBLE|UNINTEL|UNINTELLIGIBLE)\b", span, re.I)
            )
            removable.append(match.span())
    return categories, counts, removable


def remove_spans(text: str, spans: list[tuple[int, int]]) -> str:
    result = text
    for start, end in sorted(spans, reverse=True):
        result = result[:start] + " " + result[end:]
    return normalized(result)


def fetch_source() -> tuple[bytes, str, str]:
    request = urllib.request.Request(SOURCE_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        content = response.read()
        return content, response.geturl(), response.headers.get_content_type()


def extract_units(pdf_path: str) -> tuple[list[dict[str, object]], list[dict[str, str]]]:
    lines: list[dict[str, object]] = []
    with pdfplumber.open(pdf_path) as document:
        for page_number, page in enumerate(document.pages, 1):
            extracted = page.extract_text_lines(
                x_tolerance=3, y_tolerance=3, layout=False, strip=True,
                return_chars=False,
            ) or []
            for original_index, item in enumerate(extracted):
                text = normalized(str(item["text"]))
                if text:
                    lines.append({
                        "page": page_number,
                        "top": float(item.get("top", 0)),
                        "x0": float(item.get("x0", 0)),
                        "original_index": original_index,
                        "text": text,
                        "page_height": float(page.height),
                    })

    lines = sorted(lines, key=lambda line: (
        int(line["page"]), float(line["top"]), float(line["x0"]),
        int(line["original_index"]),
    ))

    repeated_margin_lines: dict[str, set[int]] = defaultdict(set)
    for line in lines:
        top = float(line["top"])
        height = float(line["page_height"])
        if top <= height * 0.10 or top >= height * 0.90:
            repeated_margin_lines[str(line["text"])].add(int(line["page"]))
    furniture = {
        text for text, pages in repeated_margin_lines.items() if len(pages) >= 3
    }

    kept = [
        line for line in lines
        if not PAGE_NUMBER.fullmatch(str(line["text"]))
        and not SOURCE_CONTROL.fullmatch(str(line["text"]))
        and not (str(line["text"]) in furniture and not LABEL.match(str(line["text"])))
    ]

    prelabel: list[str] = []
    blocks: list[dict[str, object]] = []
    current: dict[str, object] | None = None
    for line in kept:
        text = str(line["text"])
        match = LABEL.match(text)
        if match:
            if current is not None:
                blocks.append(current)
            current = {
                "speaker": match.group(1),
                "page": int(line["page"]),
                "parts": [match.group(2)] if match.group(2) else [],
            }
        elif current is None:
            prelabel.append(text)
        else:
            current["parts"].append(text)  # type: ignore[union-attr]
    if current is not None:
        blocks.append(current)

    prelabel_text = normalized(" ".join(prelabel))
    units: list[dict[str, object]] = [{
        "ordinal": 1,
        "locator": "pdf-prelabel-1",
        "unit_fingerprint": sha256(prelabel_text),
        "speaker_class": "prelabel",
        "cue_categories": [],
        "cue_occurrences": {},
        "disposition": "excluded",
        "reason": "prelabel-non-dialogue",
        "residual_token_count": None,
        "fragment_result": "not-evaluated",
    }]
    fingerprint_map = [{
        "locator": "pdf-prelabel-1",
        "boundary_unit_fingerprint": sha256(prelabel_text),
        "ledger_segment_fingerprint": ledger_fingerprint(prelabel),
    }]
    for block_index, block in enumerate(blocks, 1):
        text = normalized(" ".join(block["parts"]))  # type: ignore[arg-type]
        categories, counts, removable = cue_metadata(text)
        target = block["speaker"] == "MS. PARTON"
        residual_token_count: int | None = None
        fragment_result = "not-evaluated"
        disposition = "excluded"
        reason = "other-speaker"
        if target and "performance" in categories:
            reason = "performance-cue-whole-block"
        elif target:
            residual = remove_spans(text, removable)
            tokens = [token.lower() for token in TOKEN.findall(residual)]
            residual_token_count = len(tokens)
            if not tokens:
                reason = "cue-only-or-empty"
            elif len(tokens) <= 4 and all(token in CLOSED_FRAGMENT_TOKENS for token in tokens):
                reason = "closed-set-fragment"
                fragment_result = "excluded"
            else:
                disposition = "eligible"
                reason = "spoken-payload"
                fragment_result = "passed"
        locator = f"pdf-page-{block['page']}-speaker-block-{block_index}"
        unit_fingerprint = sha256(text)
        units.append({
            "ordinal": block_index + 1,
            "locator": locator,
            "unit_fingerprint": unit_fingerprint,
            "speaker_class": "target" if target else "other",
            "cue_categories": categories,
            "cue_occurrences": {key: value for key, value in counts.items() if value},
            "disposition": disposition,
            "reason": reason,
            "residual_token_count": residual_token_count,
            "fragment_result": fragment_result,
        })
        fingerprint_map.append({
            "locator": locator,
            "boundary_unit_fingerprint": unit_fingerprint,
            "ledger_segment_fingerprint": ledger_fingerprint(block["parts"]),
        })
    return units, fingerprint_map


def main() -> None:
    runtime = (
        ".".join(map(str, sys.version_info[:3])), pdfplumber.__version__,
        pdfminer.__version__, pypdf.__version__,
    )
    if runtime != EXPECTED_RUNTIME:
        raise SystemExit(f"Pinned PDF runtime required; found {runtime!r}")
    source, effective_url, content_type = fetch_source()
    if hashlib.sha256(source).hexdigest() != SOURCE_SHA256:
        raise SystemExit("S04 source fingerprint drifted")
    if effective_url != SOURCE_URL or content_type != "application/pdf":
        raise SystemExit("S04 source boundary or content type drifted")
    with tempfile.NamedTemporaryFile(suffix=".pdf") as temporary:
        temporary.write(source)
        temporary.flush()
        units, fingerprint_map = extract_units(temporary.name)

    target = [unit for unit in units if unit["speaker_class"] == "target"]
    performance = [unit for unit in target if "performance" in unit["cue_categories"]]
    eligible = [unit for unit in target if unit["disposition"] == "eligible"]
    manifest = {
        "schema_version": "personality-s04-boundary-manifest-v1",
        "generated_at": "2026-08-28T05:45:00Z",
        "source_register_id": "S04",
        "source_event_id": "E004",
        "source_url": SOURCE_URL,
        "source_content_fingerprint": f"sha256:{SOURCE_SHA256}",
        "runtime": {
            "python": runtime[0], "pdfplumber": runtime[1],
            "pdfminer_six": runtime[2], "pypdf": runtime[3],
        },
        "rule_id": "pdf-cue-adjudication-conservative-v1",
        "disposition_precedence": [
            "other-or-prelabel-exclusion", "performance-cue-whole-block-exclusion",
            "nonverbal-unreadable-cue-stripping", "empty-residual-exclusion",
            "closed-set-fragment-exclusion", "eligible-spoken-payload",
        ],
        "counts": {
            "boundary_units": len(units), "prelabel_units": 1,
            "labeled_speaker_blocks": len(units) - 1,
            "target_speaker_blocks": len(target),
            "other_speaker_blocks": len(units) - 1 - len(target),
            "performance_excluded_target_blocks": len(performance),
            "eligible_target_blocks": len(eligible),
        },
        "source_content_stored": False,
        "selection_performed": False,
        "runtime_activation": "prohibited",
        "units": units,
    }
    expected = (101, 49, 51, 4, 45)
    actual = (
        len(units), len(target), len(units) - 1 - len(target), len(performance),
        len(eligible),
    )
    if actual != expected:
        raise SystemExit(f"S04 boundary manifest counts drifted: {actual!r}")
    output = Path("research/pdf-boundary-manifests-v1/source-S04.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    manifest_fingerprint = sha256(output.read_bytes())
    map_output = Path("research/pdf-ledger-fingerprint-maps-v1/source-S04.json")
    map_output.parent.mkdir(parents=True, exist_ok=True)
    map_output.write_text(json.dumps({
        "schema_version": "personality-pdf-ledger-fingerprint-map-v1",
        "generated_at": "2026-08-28T06:20:00Z",
        "source_register_id": "S04",
        "boundary_manifest_fingerprint": manifest_fingerprint,
        "boundary_fingerprint_method": "normalized-joined-text-sha256-v1",
        "ledger_fingerprint_method": "normalized-length-prefixed-ordered-segments-sha256-v1",
        "source_content_stored": False,
        "selection_performed": False,
        "runtime_activation": "prohibited",
        "units": fingerprint_map,
    }, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(output), "source_fingerprint": f"sha256:{SOURCE_SHA256}",
        "boundary_units": len(units), "eligible_target_blocks": len(eligible),
        "source_content_stored": False,
    }, indent=2))


if __name__ == "__main__":
    main()
