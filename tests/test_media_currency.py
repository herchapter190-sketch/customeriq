"""Section animation remux (lossless faststart) and currency labelling."""
from __future__ import annotations

import hashlib

import pytest

from src.reports.pdf_report import currency_note
from src.ui.media import _boxes, faststart, is_faststart
from src.ui.story import STORIES, animation_path


def _mdat(data: bytes) -> bytes:
    return next(data[o:o + s] for k, o, s, _ in _boxes(data) if k == b"mdat")


@pytest.mark.parametrize("section", list(STORIES))
def test_each_section_has_its_animation(section):
    path = animation_path(section)
    if path is None:
        pytest.skip("animation files not present in this checkout")
    assert STORIES[section].file_id in path.name


@pytest.mark.parametrize("section", list(STORIES))
def test_faststart_is_lossless_and_leaves_original_untouched(section, tmp_path):
    src = animation_path(section)
    if src is None:
        pytest.skip("animation files not present in this checkout")
    before = hashlib.sha256(src.read_bytes()).hexdigest()
    dst = tmp_path / f"{section}.mp4"
    faststart(src, dst)
    original, copy = src.read_bytes(), dst.read_bytes()
    assert is_faststart(dst)
    assert len(copy) == len(original)
    assert _mdat(copy) == _mdat(original)                      # audio/video samples bit-identical
    assert hashlib.sha256(src.read_bytes()).hexdigest() == before


def test_currency_note_never_assumes_a_currency():
    assert currency_note("").startswith("Not specified")
    assert "GBP" in currency_note("£") and "no conversion" in currency_note("£")
