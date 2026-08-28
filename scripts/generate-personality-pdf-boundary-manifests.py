#!/usr/bin/env python3
"""Generate metadata-only boundary manifests for the remaining PDF sources.

The artifacts contain only source metadata, locators, controlled classifications,
counts, and SHA-256 fingerprints. Extracted source content is never persisted.
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


EXPECTED_RUNTIME = ("3.12.13", "0.11.9", "20251230", "6.10.0")
PAGE_NUMBER = re.compile(r"^(?:PAGE\s+)?\d+$")
TOKEN = re.compile(r"[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)?")
PERFORMANCE_SPAN = re.compile(
    r"\[[^\]]*\b(?:SING|SINGS|SINGING|MUSIC|PERFORMANCE)\b[^\]]*\]"
    r"|\([^)]*\b(?:SING|SINGS|SINGING|MUSIC|PERFORMANCE)\b[^)]*\)",
    re.IGNORECASE,
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
SOURCES = {
    "S08": {
        "event": "E007",
        "url": "https://danratherjournalist.org/sites/default/files/documents/"
        "2014%20The_Big_Interview_210%20on%2004%2015%20Dolly%20Parton.pdf",
        "sha256": "13f4a6112aa8ef9f9f552e0fc52df3f3bcb527d6e8817caed77e3d32ef974321",
        "label": re.compile(
            r"^(DOLLY PARTON|PARTON|DAN RATHER \(VOICE OVER\)|"
            r"RATHER \(VOICE OVER\)|DAN RATHER|RATHER)$"
        ),
        "target": {"DOLLY PARTON", "PARTON"},
        "control": re.compile(r"^(?:ACT\s+\d+[A-Z]?|END TRANSCRIPT)$"),
        "boundary": 199,
        "eligible": 88,
    },
    "S09": {
        "event": "E008",
        "url": "https://www.loc.gov/static/programs/national-recording-preservation-board/"
        "documents/DollyPartonInterview.pdf",
        "sha256": "f98b081573e5fdd39450e030f87a2630a52a1bc652e231239f4561f12a429976",
        "label": re.compile(r"^(DP|LOC):\s*(.*)$"),
        "target": {"DP"},
        "control": None,
        "boundary": 11,
        "eligible": 5,
    },
    "S18": {
        "event": "E014",
        "url": "https://cdn.imaginationlibrary.com/ilData/usrFiles/2020/04/06152352/"
        "GoodnightWithDolly_PressRelease.pdf",
        "sha256": "84a71eb6ff4ad76c571cceb1ba2517857bf1226971585dcbf0915d1f6ef32666",
        "boundary": 19,
        "eligible": 2,
    },
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


def fetch(source: dict[str, object]) -> bytes:
    url = str(source["url"])
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        content = response.read()
        if response.geturl() != url or response.headers.get_content_type() != "application/pdf":
            raise SystemExit("PDF source boundary or content type drifted")
    if hashlib.sha256(content).hexdigest() != source["sha256"]:
        raise SystemExit("PDF source fingerprint drifted")
    return content


def cue_metadata(text: str) -> tuple[list[str], dict[str, int], list[tuple[int, int]]]:
    categories: list[str] = []
    counts = {"PERFORMANCE": 0, "SINGING": 0, "MUSIC": 0, "LAUGHTER": 0,
              "APPLAUSE": 0, "INAUDIBLE": 0}
    removable: list[tuple[int, int]] = []
    groups = (
        ("performance", list(PERFORMANCE_SPAN.finditer(text))),
        ("nonverbal", list(NONVERBAL_SPAN.finditer(text))),
        ("unreadable", list(UNREADABLE_SPAN.finditer(text))),
    )
    for category, matches in groups:
        if matches:
            categories.append(category)
        for match in matches:
            span = match.group(0)
            if category == "performance":
                counts["PERFORMANCE"] += len(re.findall(r"\bPERFORMANCE\b", span, re.I))
                counts["SINGING"] += len(re.findall(r"\b(?:SING|SINGS|SINGING)\b", span, re.I))
                counts["MUSIC"] += len(re.findall(r"\bMUSIC\b", span, re.I))
            elif category == "nonverbal":
                counts["LAUGHTER"] += len(re.findall(r"\b(?:LAUGH|LAUGHTER)\b", span, re.I))
                counts["APPLAUSE"] += len(re.findall(r"\bAPPLAUSE\b", span, re.I))
                removable.append(match.span())
            else:
                counts["INAUDIBLE"] += len(
                    re.findall(r"\b(?:INAUDIBLE|UNINTEL|UNINTELLIGIBLE)\b", span, re.I)
                )
                removable.append(match.span())
    return categories, {key: value for key, value in counts.items() if value}, removable


def remove_spans(text: str, spans: list[tuple[int, int]]) -> str:
    result = text
    for start, end in sorted(spans, reverse=True):
        result = result[:start] + " " + result[end:]
    return normalized(result)


def labeled_units(
    pdf_path: str, source: dict[str, object]
) -> tuple[list[dict[str, object]], list[dict[str, str]]]:
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
                    lines.append({"page": page_number, "top": float(item.get("top", 0)),
                                  "x0": float(item.get("x0", 0)),
                                  "original_index": original_index, "text": text,
                                  "page_height": float(page.height)})
    lines = order_lines(lines)
    margins: dict[str, set[int]] = defaultdict(set)
    for line in lines:
        if float(line["top"]) <= float(line["page_height"]) * 0.10 or \
                float(line["top"]) >= float(line["page_height"]) * 0.90:
            margins[str(line["text"])].add(int(line["page"]))
    furniture = {text for text, pages in margins.items() if len(pages) >= 3}
    label = source["label"]
    control = source["control"]
    kept = [line for line in lines if not PAGE_NUMBER.fullmatch(str(line["text"]))
            and not (control and control.fullmatch(str(line["text"])))
            and not (str(line["text"]) in furniture and not label.match(str(line["text"])))]
    prelabel: list[str] = []
    blocks: list[dict[str, object]] = []
    current: dict[str, object] | None = None
    for line in kept:
        match = label.match(str(line["text"]))
        if match:
            if current is not None:
                blocks.append(current)
            current = {"speaker": match.group(1), "page": int(line["page"]),
                       "parts": [match.group(2)] if match.lastindex and match.lastindex > 1
                       and match.group(2) else []}
        elif current is None:
            prelabel.append(str(line["text"]))
        else:
            current["parts"].append(str(line["text"]))  # type: ignore[union-attr]
    if current is not None:
        blocks.append(current)
    units = [unit_record(0, "prelabel", normalized(" ".join(prelabel)), 1, "prelabel")]
    fingerprints = [fingerprint_record(units[0], prelabel)]
    for index, block in enumerate(blocks, 1):
        text = normalized(" ".join(block["parts"]))  # type: ignore[arg-type]
        speaker_class = "target" if block["speaker"] in source["target"] else "other"
        unit = unit_record(index, speaker_class, text, int(block["page"]), "speaker-block")
        units.append(unit)
        fingerprints.append(fingerprint_record(unit, block["parts"]))
    return units, fingerprints


def order_lines(lines: list[dict[str, object]]) -> list[dict[str, object]]:
    return sorted(lines, key=lambda line: (
        int(line["page"]), float(line["top"]), float(line["x0"]),
        int(line["original_index"]),
    ))


def statement_units(pdf_path: str) -> tuple[list[dict[str, object]], list[dict[str, str]]]:
    page_paragraphs: list[list[str]] = []
    reader = pypdf.PdfReader(pdf_path)
    for page in reader.pages:
        text = page.extract_text(
            extraction_mode="layout", layout_mode_space_vertically=True,
            layout_mode_scale_weight=1.25, layout_mode_strip_rotated=True,
            layout_mode_font_height_weight=1,
        )
        page_paragraphs.append([
            normalized(part) for part in re.split(r"\n[ \t]*\n+", text) if normalized(part)
        ])
    paragraphs: list[tuple[int, str]] = []
    sentence_end = re.compile(r"[.!?][\"”'\)\]]*$")
    for page_number, parts in enumerate(page_paragraphs, 1):
        if paragraphs and parts and not sentence_end.search(paragraphs[-1][1]):
            prior_page, prior = paragraphs.pop()
            paragraphs.append((prior_page, normalized(f"{prior} {parts.pop(0)}")))
        paragraphs.extend((page_number, part) for part in parts)
    named = re.compile(
        r"\bDolly\s+Parton\s+(?:said|says|stated|states|added|adds|commented)\s*,?\s*[\"“]",
        re.IGNORECASE,
    )
    continuation = re.compile(
        r"\b(?:she|Parton)\s+(?:adds?|continues?|said|says|states?|notes?)\s*,?\s*[\"“]",
        re.IGNORECASE,
    )
    units: list[dict[str, object]] = []
    fingerprints: list[dict[str, str]] = []
    prior_target = False
    for index, (page_number, text) in enumerate(paragraphs):
        target = bool(named.search(text) or (prior_target and continuation.search(text)))
        unit = unit_record(index, "target" if target else "other", text,
                           page_number, "paragraph")
        units.append(unit)
        fingerprints.append(fingerprint_record(unit, [text]))
        prior_target = target
    return units, fingerprints


def fingerprint_record(unit: dict[str, object], segments: list[str]) -> dict[str, str]:
    return {
        "locator": str(unit["locator"]),
        "boundary_unit_fingerprint": str(unit["unit_fingerprint"]),
        "ledger_segment_fingerprint": ledger_fingerprint(segments),
    }


def unit_record(index: int, speaker_class: str, text: str, page: int,
                locator_kind: str) -> dict[str, object]:
    categories, occurrences, removable = cue_metadata(text)
    disposition, reason = "excluded", "other-speaker"
    residual_count: int | None = None
    fragment = "not-evaluated"
    if speaker_class == "prelabel":
        reason = "prelabel-non-dialogue"
    elif speaker_class == "target" and "performance" in categories:
        reason = "performance-cue-whole-block"
    elif speaker_class == "target":
        residual = remove_spans(text, removable)
        tokens = [token.lower() for token in TOKEN.findall(residual)]
        residual_count = len(tokens)
        if not tokens:
            reason = "cue-only-or-empty"
        elif len(tokens) <= 4 and all(token in CLOSED_FRAGMENT_TOKENS for token in tokens):
            reason, fragment = "closed-set-fragment", "excluded"
        else:
            disposition, reason, fragment = "eligible", "spoken-payload", "passed"
    locator = (f"pdf-prelabel-1" if speaker_class == "prelabel" else
               f"pdf-page-{page}-{locator_kind}-{index}")
    return {"ordinal": index, "locator": locator, "unit_fingerprint": sha256(text),
            "speaker_class": speaker_class, "cue_categories": categories,
            "cue_occurrences": occurrences, "disposition": disposition,
            "reason": reason, "residual_token_count": residual_count,
            "fragment_result": fragment}


def main() -> None:
    runtime = (".".join(map(str, sys.version_info[:3])), pdfplumber.__version__,
               pdfminer.__version__, pypdf.__version__)
    if runtime != EXPECTED_RUNTIME:
        raise SystemExit(f"Pinned PDF runtime required; found {runtime!r}")
    output_root = Path("research/pdf-boundary-manifests-v1")
    output_root.mkdir(parents=True, exist_ok=True)
    summaries = []
    for source_id, source in SOURCES.items():
        content = fetch(source)
        with tempfile.NamedTemporaryFile(suffix=".pdf") as temporary:
            temporary.write(content)
            temporary.flush()
            units, fingerprint_map = (statement_units(temporary.name) if source_id == "S18"
                                      else labeled_units(temporary.name, source))
        eligible = [unit for unit in units if unit["disposition"] == "eligible"]
        actual = (len(units), len(eligible))
        expected = (source["boundary"], source["eligible"])
        if actual != expected:
            raise SystemExit(f"{source_id} boundary counts drifted: {actual!r} != {expected!r}")
        manifest = {
            "schema_version": "personality-pdf-boundary-manifest-v1",
            "generated_at": "2026-08-28T06:02:00Z", "source_register_id": source_id,
            "source_event_id": source["event"], "source_url": source["url"],
            "source_content_fingerprint": f"sha256:{source['sha256']}",
            "runtime": {"python": runtime[0], "pdfplumber": runtime[1],
                        "pdfminer_six": runtime[2], "pypdf": runtime[3]},
            "rule_id": ("pdf-attributed-statement-blocks-v2" if source_id == "S18"
                        else "pdf-speaker-label-blocks-v2"),
            "counts": {"boundary_units": len(units), "eligible_units": len(eligible),
                       "excluded_units": len(units) - len(eligible)},
            "source_content_stored": False, "selection_performed": False,
            "runtime_activation": "prohibited", "units": units,
        }
        output = output_root / f"source-{source_id}.json"
        output.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        manifest_fingerprint = sha256(output.read_bytes())
        map_output = Path("research/pdf-ledger-fingerprint-maps-v1") / f"source-{source_id}.json"
        map_output.parent.mkdir(parents=True, exist_ok=True)
        map_output.write_text(json.dumps({
            "schema_version": "personality-pdf-ledger-fingerprint-map-v1",
            "generated_at": "2026-08-28T06:20:00Z",
            "source_register_id": source_id,
            "boundary_manifest_fingerprint": manifest_fingerprint,
            "boundary_fingerprint_method": "normalized-joined-text-sha256-v1",
            "ledger_fingerprint_method":
                "normalized-length-prefixed-ordered-segments-sha256-v1",
            "source_content_stored": False,
            "selection_performed": False,
            "runtime_activation": "prohibited",
            "units": fingerprint_map,
        }, indent=2) + "\n", encoding="utf-8")
        summaries.append({"source": source_id, "boundary": len(units),
                          "eligible": len(eligible), "manifest": manifest_fingerprint,
                          "fingerprint_map": sha256(map_output.read_bytes())})
    print(json.dumps(summaries, indent=2))


if __name__ == "__main__":
    main()
