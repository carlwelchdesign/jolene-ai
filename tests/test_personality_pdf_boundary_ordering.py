"""Regression test for frozen PDF page/top/x0/original-index ordering."""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parents[1] / "scripts" / \
    "generate-personality-pdf-boundary-manifests.py"
SPEC = importlib.util.spec_from_file_location("pdf_boundary_generator", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class PdfBoundaryOrderingTest(unittest.TestCase):
    def test_orders_perturbed_lines_by_frozen_tuple(self) -> None:
        lines = [
            {"page": 2, "top": 1.0, "x0": 1.0, "original_index": 0},
            {"page": 1, "top": 2.0, "x0": 2.0, "original_index": 0},
            {"page": 1, "top": 2.0, "x0": 1.0, "original_index": 3},
            {"page": 1, "top": 2.0, "x0": 1.0, "original_index": 1},
            {"page": 1, "top": 1.0, "x0": 9.0, "original_index": 8},
        ]
        ordered = MODULE.order_lines(lines)
        self.assertEqual(
            [(line["page"], line["top"], line["x0"], line["original_index"])
             for line in ordered],
            [(1, 1.0, 9.0, 8), (1, 2.0, 1.0, 1), (1, 2.0, 1.0, 3),
             (1, 2.0, 2.0, 0), (2, 1.0, 1.0, 0)],
        )


if __name__ == "__main__":
    unittest.main()
