"""Lossless MP4 "faststart" remux for the section animations.

The supplied Google Flow MP4s store their index (``moov`` box) *after* the media data (``mdat``).
A browser must then download the end of the file before it can show the first frame, which leaves the
animation panel empty for several seconds on heavier pages. ``faststart`` writes a copy with ``moov``
moved to the front and every chunk offset (``stco`` / ``co64``) shifted accordingly. No audio or video
sample is decoded or re-encoded, so the picture is bit-identical to the original. Originals are never
modified: the copy is written to a different path.
"""
from __future__ import annotations

import struct
from pathlib import Path

_CONTAINERS = {b"moov", b"trak", b"mdia", b"minf", b"stbl", b"edts", b"udta", b"mvex"}


def _boxes(buf: bytes | memoryview, start: int = 0, end: int | None = None):
    """Yield (type, offset, size, header_len) for each box in ``buf[start:end]``."""
    end = len(buf) if end is None else end
    pos = start
    while pos + 8 <= end:
        size, kind = struct.unpack(">I4s", bytes(buf[pos:pos + 8]))
        header = 8
        if size == 1:
            size = struct.unpack(">Q", bytes(buf[pos + 8:pos + 16]))[0]
            header = 16
        elif size == 0:
            size = end - pos
        if size < header or pos + size > end:
            raise ValueError(f"Malformed MP4 box {kind!r} at {pos}")
        yield kind, pos, size, header
        pos += size


def _shift_offsets(moov: bytearray, delta: int, start: int, end: int) -> None:
    for kind, off, size, header in list(_boxes(moov, start, end)):
        body = off + header
        if kind in _CONTAINERS:
            _shift_offsets(moov, delta, body, off + size)
        elif kind == b"stco":
            count = struct.unpack(">I", moov[body + 4:body + 8])[0]
            for i in range(count):
                p = body + 8 + 4 * i
                value = struct.unpack(">I", moov[p:p + 4])[0] + delta
                if value > 0xFFFFFFFF:
                    raise ValueError("Chunk offset overflow; file too large for 32-bit stco")
                moov[p:p + 4] = struct.pack(">I", value)
        elif kind == b"co64":
            count = struct.unpack(">I", moov[body + 4:body + 8])[0]
            for i in range(count):
                p = body + 8 + 8 * i
                moov[p:p + 8] = struct.pack(">Q", struct.unpack(">Q", moov[p:p + 8])[0] + delta)


def is_faststart(path: Path) -> bool:
    data = path.read_bytes()
    order = [kind for kind, *_ in _boxes(data)]
    return b"moov" in order and b"mdat" in order and order.index(b"moov") < order.index(b"mdat")


def faststart(src: Path, dst: Path) -> None:
    """Write ``src`` to ``dst`` with the moov box placed before mdat. ``src`` is only read."""
    data = src.read_bytes()
    top = list(_boxes(data))
    kinds = [k for k, *_ in top]
    if b"moov" not in kinds or b"mdat" not in kinds:
        raise ValueError(f"{src.name}: not a playable MP4 (moov/mdat missing)")
    if kinds.index(b"moov") < kinds.index(b"mdat"):
        dst.write_bytes(data)  # already streamable
        return
    moov_entry = top[kinds.index(b"moov")]
    others = [b for b in top if b[0] != b"moov"]
    # New layout: ftyp first (if present), then moov, then everything else in original order.
    head = [b for b in others if b[0] == b"ftyp"]
    tail = [b for b in others if b[0] != b"ftyp"]
    old_mdat = top[kinds.index(b"mdat")][1]
    new_mdat = sum(b[2] for b in head) + moov_entry[2]
    for b in tail:
        if b[0] == b"mdat":
            break
        new_mdat += b[2]
    moov = bytearray(data[moov_entry[1]:moov_entry[1] + moov_entry[2]])
    _shift_offsets(moov, new_mdat - old_mdat, moov_entry[3], len(moov))
    tmp = dst.with_suffix(dst.suffix + ".tmp")
    with open(tmp, "wb") as fh:
        for _, off, size, _ in head:
            fh.write(data[off:off + size])
        fh.write(moov)
        for _, off, size, _ in tail:
            fh.write(data[off:off + size])
    tmp.replace(dst)
