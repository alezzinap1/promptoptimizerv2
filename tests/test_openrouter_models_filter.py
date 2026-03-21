"""Tests for OpenRouter model text I/O filter."""
from __future__ import annotations

import unittest

from services import openrouter_models as om


class TestTextIoFilter(unittest.TestCase):
    def test_allows_text_in_out(self) -> None:
        m = {
            "architecture": {
                "input_modalities": ["text"],
                "output_modalities": ["text"],
            }
        }
        self.assertTrue(om._supports_text_input_and_output(m))

    def test_allows_multimodal_in_text_out(self) -> None:
        m = {
            "architecture": {
                "input_modalities": ["text", "image"],
                "output_modalities": ["text"],
            }
        }
        self.assertTrue(om._supports_text_input_and_output(m))

    def test_rejects_no_text_out(self) -> None:
        m = {
            "architecture": {
                "input_modalities": ["text"],
                "output_modalities": ["image"],
            }
        }
        self.assertFalse(om._supports_text_input_and_output(m))

    def test_rejects_no_text_in_when_list_nonempty(self) -> None:
        m = {
            "architecture": {
                "input_modalities": ["image"],
                "output_modalities": ["text"],
            }
        }
        self.assertFalse(om._supports_text_input_and_output(m))

    def test_missing_architecture_allows(self) -> None:
        self.assertTrue(om._supports_text_input_and_output({}))


if __name__ == "__main__":
    unittest.main()
