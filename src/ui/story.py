"""Section stages: each original animation shown large, paired with a plain-language explanation.

The five original animation files in ``assets/animations`` are never modified. They are located by the
unique id suffix in their filename. A streamable copy (``moov`` index moved to the front, a lossless
remux, see ``src/ui/media.py``) is written to ``static/animations/<section>.mp4`` and served by Streamlit's
static file server (``server.enableStaticServing``) to a native ``<video autoplay muted loop playsinline>``.
If a file is missing or cannot be remuxed the stage still renders, just without the video.
"""
from __future__ import annotations

import html
import logging
import shutil
from dataclasses import dataclass
from pathlib import Path

import streamlit as st

from src.config import PROJECT_ROOT
from src.insights.engine import Insight
from src.ui.media import faststart, is_faststart

ANIMATION_DIR = PROJECT_ROOT / "assets" / "animations"
STATIC_DIR = PROJECT_ROOT / "static" / "animations"
log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Story:
    file_id: str      # unique suffix of the animation filename
    chapter: str      # two-digit chapter number shared with the page header
    tag: str          # small label above the headline
    headline: str     # may contain <em> for the accent word
    body: str         # what this page answers, in plain words
    visual: str       # how to read the animation as a picture of the data
    subject: str      # what the animation shows (caption)
    layout: str       # wide | media-left | media-right
    tone: str         # espresso | burgundy


STORIES: dict[str, Story] = {
    "overview": Story(
        "5793264c", "01", "Your business at a glance",
        "Every customer, <em>one picture</em>.",
        "How the business did in the period you picked, and the few things worth doing next.",
        "<b>The sculpture</b> is your customer base: many separate relationships woven into one shape. "
        "The numbers below tell you whether that shape is growing or thinning.",
        "Spherical sculpture", "wide", "espresso"),
    "segments": Story(
        "6bf53775", "02", "Customer groups",
        "Customers who buy alike, <em>grouped together</em>.",
        "Every customer is placed in one group using three questions: how recently did they buy, how often "
        "do they buy, and how much do they spend?",
        "<b>The clusters</b> are those groups. A few dense clusters usually carry most of the revenue; "
        "scattered points are occasional or new buyers worth nurturing.",
        "Customer clusters", "media-left", "burgundy"),
    "revenue": Story(
        "652ab77c", "03", "Money in, money out",
        "Where your revenue <em>flows</em>.",
        "How sales move month to month, how much comes back as returns, and which customers and products "
        "bring in the most.",
        "<b>The ribbon</b> is revenue over time: it swells and tightens month by month. "
        "The particles drifting off are returns leaving the business.",
        "Metallic ribbon", "media-right", "espresso"),
    "cohorts": Story(
        "013184d0", "04", "Who comes back",
        "Customers who keep <em>returning</em>.",
        "Customers are grouped by the month they first bought. Each row shows how many of them came back "
        "in the months that followed, and how many you lost.",
        "<b>The orbits</b> are those groups circling back to you. Rings that hold their path are loyal "
        "customers; rings that fade are customers you are losing.",
        "Orbital rings", "wide", "burgundy"),
    "data": Story(
        "37cac02a", "05", "Your data, organised",
        "From messy files to <em>clean, trusted</em> data.",
        "Upload a CSV or Excel export from your shop or till. CustomerIQ checks it, fixes common problems "
        "and keeps a record of every change it makes.",
        "<b>The loose pieces</b> are raw rows from your file; the ordered form they settle into is the "
        "clean table every chart in this app is built from.",
        "Geometric sculpture", "media-left", "espresso"),
}

CHAPTERS = {s.chapter: key for key, s in STORIES.items()}


def animation_path(section: str) -> Path | None:
    story = STORIES.get(section)
    if story is None:
        return None
    matches = sorted(ANIMATION_DIR.glob(f"*{story.file_id}.mp4"))
    return matches[0] if matches else None


def _prepare(src: Path, dst: Path) -> None:
    """Write a streamable copy of ``src`` to ``dst`` (lossless). Falls back to a byte copy."""
    STATIC_DIR.mkdir(parents=True, exist_ok=True)
    try:
        faststart(src, dst)
    except (OSError, ValueError) as exc:  # unusual container layout: serve the original bytes instead
        log.warning("Faststart remux failed for %s (%s); serving a byte copy", src.name, exc)
        shutil.copy2(src, dst)


@st.cache_resource(show_spinner=False)
def animation_url(section: str) -> str | None:
    """Ensure a streamable copy of the original sits in the static folder; return its served URL."""
    src = animation_path(section)
    if src is None:
        return None
    dst = STATIC_DIR / f"{section}.mp4"
    stale = (not dst.exists() or dst.stat().st_mtime < src.stat().st_mtime
             or abs(dst.stat().st_size - src.stat().st_size) > 64 or not is_faststart(dst))
    if stale:
        _prepare(src, dst)
    # Size + mtime in the query string busts the browser cache when the copy is regenerated.
    stamp = f"{dst.stat().st_size}{int(dst.stat().st_mtime)}"
    return f"app/static/animations/{section}.mp4?v={stamp}"


# Streamlit's React layer can detach and re-attach an element's DOM node during reruns and page switches.
# Browsers pause a <video> when it is detached, and the autoplay attribute never fires a second time, so
# the animation would sit frozen on its first frame. This static, first-party script (no user input) is
# installed once per browser tab and resumes any stage video that is paused while visible.
KEEP_PLAYING_JS = """<script>
(function () {
  if (window.__ciqKeepPlaying) return;
  window.__ciqKeepPlaying = true;
  function tick() {
    if (document.hidden) return;
    document.querySelectorAll('.ciq-stage video').forEach(function (v) {
      if (!v.isConnected || !v.paused || v.getBoundingClientRect().width === 0) return;
      v.muted = true; v.loop = true;
      var p = v.play(); if (p && p.catch) p.catch(function () {});
    });
  }
  setInterval(tick, 700);
  document.addEventListener('visibilitychange', tick);
  new MutationObserver(function () { requestAnimationFrame(tick); })
    .observe(document.body, { childList: true, subtree: true });
  document.addEventListener('canplay', function (e) {
    if (e.target.closest && e.target.closest('.ciq-stage')) tick();
  }, true);
})();
</script>"""


def motion_enabled() -> bool:
    return bool(st.session_state.get("show_motion", True))


def story_banner(section: str, highlight: str = "") -> None:
    """Full-width stage: the section's animation shown large (16:9, uncropped) beside a plain explanation.

    ``highlight`` is optional trusted HTML (a one-line data summary) shown under the explanation.
    """
    story = STORIES[section]
    url = animation_url(section) if motion_enabled() else None
    extra = f"<div class='hl'>{highlight}</div>" if highlight else ""
    copy = (f"<div class='copy'><div class='tag'><span class='no'>{story.chapter}</span>"
            f"{html.escape(story.tag)}</div><div class='h'>{story.headline}</div>"
            f"<div class='b'>{html.escape(story.body)}</div>{extra}<div class='m'>{story.visual}</div></div>")
    if url:
        media = (f"<figure class='screen'><video src='{url}' autoplay muted loop playsinline preload='auto' "
                 f"disablepictureinpicture disableremoteplayback aria-label='{html.escape(story.subject)} animation'>"
                 f"</video><figcaption><span class='live'></span>{html.escape(story.subject)}"
                 f"<span class='ch'>{story.chapter} / 05</span></figcaption></figure>")
        layout = story.layout
        media += KEEP_PLAYING_JS
    else:
        media = ("<div class='off'>Animation hidden. Switch on <b>Show animations</b> in the sidebar to "
                 "bring it back.</div>")
        layout = "text-only"
    st.html(f"<div class='ciq-stage-wrap'><section class='ciq-stage {layout} {story.tone}'>{copy}{media}</section></div>",
            unsafe_allow_javascript=bool(url))


def takeaway(insight: Insight | None) -> None:
    """Two-part strip: what the data says (plain words) and the one thing to do about it."""
    if insight is None:
        return
    e = html.escape
    st.markdown(
        f"<div class='ciq-take'><div><div class='l'>What this means for you</div><div class='t'>{e(insight.title)}</div>"
        f"<div class='x'>{e(insight.observation)}</div></div>"
        f"<div class='act'><div class='l'>What to do next</div><div class='x'>{e(insight.action)}</div></div></div>",
        unsafe_allow_html=True)


def first_insight(insights: list[Insight], *categories: str) -> Insight | None:
    return next((i for i in insights if i.category in categories), None)


def action_card(number: int, insight: Insight) -> None:
    e = html.escape
    st.markdown(
        f"<div class='ciq-action {e(insight.kind)}'><div class='n'>{number:02d}</div>"
        f"<div class='t'>{e(insight.title)}</div><div class='o'>{e(insight.observation)}</div>"
        f"<div class='do'><b>Do this</b>{e(insight.action)}</div></div>",
        unsafe_allow_html=True)
