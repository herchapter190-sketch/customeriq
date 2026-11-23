"""Visual identity: colour tokens, Plotly template and CSS.

Palette (exact): acid lime #D6FF3F, deep burgundy #641C36, warm ivory #F4EBD9, dark espresso #27231F,
burnt orange #E66B43. Every other colour below is a tint or shade of these five.
Legacy token names (NAVY, ACCENT, ...) are kept so every page keeps importing them unchanged.

Fonts (Fraunces for display, Inter for text) are served locally from ``static/fonts`` (SIL OFL), so the
interface makes no external font request.
"""
from __future__ import annotations

import plotly.graph_objects as go
import plotly.io as pio
import streamlit as st

# Core palette
LIME = "#D6FF3F"
BURGUNDY = "#641C36"
IVORY = "#F4EBD9"
ESPRESSO = "#27231F"
ORANGE = "#E66B43"

# Semantic tokens (legacy names retained for compatibility)
NAVY = BURGUNDY          # primary data colour
NAVY_DARK = ESPRESSO
INK = ESPRESSO
SLATE = "#6B6158"        # espresso tint
MUTED = "#998D80"        # espresso tint
GRID = "#E5D8C0"         # ivory shade
SURFACE = "#FBF6EC"      # ivory tint
CANVAS = IVORY
BORDER = "#D9C9AC"       # ivory shade
ACCENT = ORANGE
POSITIVE = "#5C7A0E"     # lime shade (readable on ivory)
NEGATIVE = "#B84A2E"     # orange shade

SERIES = [BURGUNDY, ORANGE, "#8C7B6B", "#7E9A1E", "#C79AAA", "#D9C3A0", "#A04A62", "#BDB2A4"]

SEGMENT_COLORS = {
    "Champions": BURGUNDY,
    "Loyal Customers": "#9A4A66",
    "New Customers": "#7E9A1E",
    "Potential Loyalists": "#BFD26A",
    "Cannot Lose Them": ORANGE,
    "At Risk": NEGATIVE,
    "Hibernating": "#A89C8E",
    "Other": "#CFC4B3",
    "Unsegmented": "#E2D8C6",
}

RISK_COLORS = {"Active": POSITIVE, "Cooling": "#E3A447", "At Risk": ORANGE, "Lapsed": BURGUNDY}

# Sequential scale for heatmaps (ivory -> burgundy).
SEQUENTIAL = [[0.0, "#F8F1E4"], [0.25, "#EDCDB9"], [0.5, "#DB8C74"], [0.75, "#A6455A"], [1.0, BURGUNDY]]

FONT_STACK = "Inter, 'Segoe UI', system-ui, -apple-system, sans-serif"
DISPLAY_STACK = "Fraunces, 'Iowan Old Style', Georgia, serif"


def register_plotly_template() -> None:
    template = go.layout.Template()
    template.layout = go.Layout(
        font=dict(family=FONT_STACK, size=12, color=INK),
        colorway=SERIES,
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
        margin=dict(l=8, r=8, t=78, b=8),
        title=dict(font=dict(family=DISPLAY_STACK, size=19, color=INK), x=0, xanchor="left", yref="container", y=0.97,
                   yanchor="top"),
        xaxis=dict(automargin=True, showgrid=False, linecolor=BORDER, ticks="outside", tickcolor=BORDER, zeroline=False,
                   title=dict(font=dict(size=11, color=SLATE))),
        yaxis=dict(automargin=True, gridcolor=GRID, zeroline=False, linecolor="rgba(0,0,0,0)",
                   title=dict(font=dict(size=11, color=SLATE))),
        legend=dict(orientation="h", yanchor="bottom", y=1.01, xanchor="left", x=0, font=dict(size=11),
                    bgcolor="rgba(0,0,0,0)"),
        hoverlabel=dict(bgcolor=ESPRESSO, bordercolor=ESPRESSO, font=dict(family=FONT_STACK, size=12, color=IVORY)),
        bargap=0.25,
    )
    pio.templates["customeriq"] = template
    pio.templates.default = "customeriq"


FONTS = """
@font-face { font-family: 'Fraunces'; font-style: normal; font-weight: 100 900; font-display: swap;
  src: url('app/static/fonts/fraunces-opsz-normal.woff2') format('woff2'); }
@font-face { font-family: 'Fraunces'; font-style: italic; font-weight: 100 900; font-display: swap;
  src: url('app/static/fonts/fraunces-opsz-italic.woff2') format('woff2'); }
@font-face { font-family: 'Inter'; font-style: normal; font-weight: 100 900; font-display: swap;
  src: url('app/static/fonts/inter-wght-normal.woff2') format('woff2'); }
"""

CSS = f"""
<style>
{FONTS}
html, body, [class*="css"], .stMarkdown, .stText, button, input, textarea, select {{ font-family: {FONT_STACK}; }}
.stApp {{ background: {CANVAS}; }}
.block-container {{ padding-top: 2.2rem; padding-bottom: 4rem; max-width: 1360px; }}
h1, h2, h3 {{ color: {INK}; font-family: {DISPLAY_STACK} !important; letter-spacing: -0.015em; }}
h2 {{ font-weight: 400 !important; }}
h3 {{ font-weight: 500 !important; font-size: 1.65rem !important; margin-top: 2.2rem !important; padding-top: 1.1rem !important;
    border-top: 1px solid {ESPRESSO}; }}
h3 a, h1 a, h2 a {{ display: none !important; }}
a {{ color: {BURGUNDY}; }}
hr {{ border-color: {BORDER}; }}
[data-testid="stCaptionContainer"] p {{ color: {SLATE}; }}

/* Sidebar: espresso with lime signals */
section[data-testid="stSidebar"] {{ background: {ESPRESSO}; border-right: 1px solid #3A342E; }}
section[data-testid="stSidebar"] * {{ color: {IVORY}; }}
section[data-testid="stSidebar"] .stMarkdown p, section[data-testid="stSidebar"] label p {{ color: #CFC3AE; }}
section[data-testid="stSidebar"] [data-testid="stCaptionContainer"] * {{ color: #A99C88 !important; }}
section[data-testid="stSidebar"] input, section[data-testid="stSidebar"] [data-baseweb="select"] *,
section[data-testid="stSidebar"] [data-baseweb="input"] *, section[data-testid="stSidebar"] [data-baseweb="input"] input,
section[data-testid="stSidebar"] [data-testid="stDateInputFieldsScroller"] * {{
    color: {INK} !important; -webkit-text-fill-color: {INK} !important; }}
section[data-testid="stSidebar"] [data-baseweb="tag"] {{ background: {BURGUNDY} !important; }}
section[data-testid="stSidebar"] [data-baseweb="tag"] * {{ color: {IVORY} !important; -webkit-text-fill-color: {IVORY} !important; }}
section[data-testid="stSidebar"] [data-testid="stNavSectionHeader"] * {{ color: #A99C88 !important; text-transform: uppercase;
    letter-spacing: 0.14em; font-size: 0.66rem; }}
section[data-testid="stSidebar"] [data-testid="stSidebarNav"] a {{ border-radius: 0; border-left: 2px solid transparent; }}
section[data-testid="stSidebar"] [data-testid="stSidebarNav"] a span {{ color: #E9DFCB; }}
section[data-testid="stSidebar"] [data-testid="stSidebarNav"] a:hover {{ background: rgba(244,235,217,0.06); }}
section[data-testid="stSidebar"] [data-testid="stSidebarNav"] a[aria-current="page"] {{
    background: rgba(214,255,63,0.07); border-left-color: {LIME}; }}
section[data-testid="stSidebar"] [data-testid="stSidebarNav"] a[aria-current="page"] span {{ color: {LIME} !important; }}
section[data-testid="stSidebar"] hr {{ border-color: #3A342E; }}
section[data-testid="stSidebar"] button[kind="secondary"] {{ background: transparent; border-color: #4A433C; border-radius: 2px; }}
section[data-testid="stSidebar"] button[kind="secondary"]:hover {{ border-color: {LIME}; }}
section[data-testid="stSidebar"] button[kind="secondary"]:hover * {{ color: {LIME} !important; }}
section[data-testid="stSidebar"] [data-testid="stCheckbox"] label div[role="checkbox"],
section[data-testid="stSidebar"] label[data-baseweb="checkbox"] > div:first-child {{ background: #4A433C; }}
section[data-testid="stSidebar"] label[data-baseweb="checkbox"] input:checked + div {{ background: {LIME} !important; }}

/* Buttons */
button[kind="primary"], [data-testid="stBaseButton-primary"], [data-testid="stBaseButton-primaryFormSubmit"] {{
    background: {ESPRESSO} !important; border-color: {ESPRESSO} !important; color: {LIME} !important; border-radius: 2px; }}
button[kind="primary"] *, [data-testid="stBaseButton-primary"] *, [data-testid="stBaseButton-primaryFormSubmit"] * {{ color: {LIME} !important; }}
button[kind="primary"]:hover, [data-testid="stBaseButton-primary"]:hover {{ background: {BURGUNDY} !important; border-color: {BURGUNDY} !important; }}
button[kind="secondary"] {{ border-radius: 2px; }}

/* Tabs */
.stTabs [data-baseweb="tab-list"] {{ gap: 1.8rem; border-bottom: 1px solid {BORDER}; }}
.stTabs [data-baseweb="tab"] p {{ font-weight: 600; color: {SLATE}; font-size: 0.95rem; }}
.stTabs [aria-selected="true"] p {{ color: {INK}; }}
.stTabs [data-baseweb="tab-highlight"] {{ background: {ORANGE}; height: 3px; }}

/* Metrics: editorial figures on a rule, not boxed cards */
div[data-testid="stMetric"] {{ background: transparent !important; border: none !important; border-top: 2px solid {ESPRESSO} !important;
    border-radius: 0 !important; padding: 12px 2px 6px 2px !important; box-shadow: none !important; }}
div[data-testid="stMetricLabel"] p {{ color: {SLATE}; font-size: 0.72rem; font-weight: 650; text-transform: uppercase; letter-spacing: 0.1em; }}
div[data-testid="stMetricValue"] {{ color: {INK}; font-family: {DISPLAY_STACK}; font-weight: 400; font-size: 2.35rem; }}
div[data-testid="stMetricValue"] *, div[data-testid="stMetricLabel"] *, div[data-testid="stMetricDelta"] * {{
    white-space: normal !important; overflow: visible !important; text-overflow: clip !important; }}
div[data-testid="stVerticalBlockBorderWrapper"]:has(> div > div > div[data-testid="stMetric"]) {{ border: none !important; }}

/* Charts and tables sit on the page, no boxes */
div[data-testid="stPlotlyChart"] {{ background: transparent; border: none; }}
div[data-testid="stDataFrame"] {{ border: 1px solid {BORDER}; border-radius: 2px; }}
div[data-testid="stExpander"] details {{ background: transparent; border: none; border-top: 1px solid {BORDER};
    border-bottom: 1px solid {BORDER}; border-radius: 0; }}
div[data-testid="stExpander"] summary p {{ font-weight: 600; }}

/* Page header: chapter number + display title */
.ciq-head {{ display: flex; gap: 22px; align-items: flex-start; margin: 0 0 1.6rem 0; }}
.ciq-head .no {{ font-family: {DISPLAY_STACK}; font-style: italic; font-size: 3.6rem; line-height: 0.9; color: {ORANGE};
    font-variation-settings: "opsz" 144; }}
.ciq-head .ttl {{ font-family: {DISPLAY_STACK}; font-size: 3.1rem; line-height: 1; color: {INK}; letter-spacing: -0.025em;
    font-variation-settings: "opsz" 144; }}
.ciq-head .sub {{ font-size: 1.02rem; color: #4A4139; margin-top: 10px; max-width: 46em; }}
.ciq-head .meta {{ font-size: 0.76rem; color: {MUTED}; margin-top: 6px; letter-spacing: 0.02em; }}
@media (max-width: 760px) {{ .ciq-head .no {{ font-size: 2.4rem; }} .ciq-head .ttl {{ font-size: 2.1rem; }} }}

/* Stage: the section animation, large and uncropped, with its plain-language explanation */
.ciq-stage {{ display: grid; gap: 36px; padding: 34px; border-radius: 3px; margin: 0 0 1.8rem 0; color: {IVORY};
    background: {ESPRESSO}; align-items: center; }}
.ciq-stage.burgundy {{ background: {BURGUNDY}; }}
.ciq-stage.wide {{ grid-template-columns: 1fr 1fr; grid-template-areas: "copy copy" "media media"; gap: 26px; }}
.ciq-stage.wide .copy {{ display: grid; grid-template-columns: 1.05fr 1fr; column-gap: 48px; align-items: end; }}
.ciq-stage.wide .copy .tag, .ciq-stage.wide .copy .h {{ grid-column: 1; }}
.ciq-stage.wide .copy .b, .ciq-stage.wide .copy .hl, .ciq-stage.wide .copy .m {{ grid-column: 2; }}
.ciq-stage.wide .copy .tag {{ grid-row: 1; }}
.ciq-stage.wide .copy .h {{ grid-row: 2 / span 3; align-self: start; margin: 18px 0 0 0; font-size: 3.5rem; line-height: 0.98; }}
.ciq-stage.wide .copy .b {{ grid-row: 2; }} .ciq-stage.wide .copy .hl {{ grid-row: 3; }} .ciq-stage.wide .copy .m {{ grid-row: 4; }}
.ciq-stage.media-left {{ grid-template-columns: 1.75fr 1fr; grid-template-areas: "media copy"; }}
.ciq-stage.media-right {{ grid-template-columns: 1fr 1.75fr; grid-template-areas: "copy media"; }}
.ciq-stage.text-only {{ grid-template-columns: 1fr; grid-template-areas: "copy" "media"; gap: 14px; padding: 26px 34px; }}
.ciq-stage .copy {{ grid-area: copy; min-width: 0; }}
.ciq-stage .screen, .ciq-stage .off {{ grid-area: media; }}
.ciq-stage .tag {{ display: flex; align-items: center; gap: 12px; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.18em;
    text-transform: uppercase; color: {LIME}; }}
.ciq-stage .tag .no {{ font-family: {DISPLAY_STACK}; font-style: italic; font-size: 1.05rem; letter-spacing: 0; text-transform: none;
    color: {ESPRESSO}; background: {LIME}; padding: 1px 8px 2px 8px; border-radius: 2px; }}
.ciq-stage .h {{ font-family: {DISPLAY_STACK}; font-size: 2.7rem; line-height: 1.02; letter-spacing: -0.02em; margin: 16px 0 14px 0;
    color: {IVORY}; font-variation-settings: "opsz" 144; }}
.ciq-stage .h em {{ color: {LIME}; font-style: italic; }}
.ciq-stage .b {{ font-size: 1.02rem; line-height: 1.6; color: #EADFCB; max-width: 36em; }}
.ciq-stage .hl {{ margin-top: 14px; font-size: 1.05rem; line-height: 1.5; color: {IVORY}; }}
.ciq-stage .hl b {{ color: {LIME}; font-weight: 600; }}
.ciq-stage .m {{ margin-top: 18px; padding-top: 14px; border-top: 1px solid rgba(244,235,217,0.18); font-size: 0.84rem;
    line-height: 1.55; color: #C9BBA3; }}
.ciq-stage.burgundy .m {{ color: #E2C3CB; }}
.ciq-stage .m b {{ color: {LIME}; font-weight: 600; }}
.ciq-stage .screen {{ margin: 0; min-width: 0; }}
.ciq-stage video {{ display: block; width: 100%; aspect-ratio: 16 / 9; height: auto; object-fit: contain; background: #15120F;
    border-radius: 2px; pointer-events: none; box-shadow: 0 24px 60px -24px rgba(0,0,0,0.65); }}
.ciq-stage video::-webkit-media-controls, .ciq-stage video::-webkit-media-controls-enclosure {{ display: none !important; }}
.ciq-stage figcaption {{ display: flex; align-items: center; gap: 10px; margin-top: 12px; font-size: 0.72rem; font-weight: 600;
    letter-spacing: 0.14em; text-transform: uppercase; color: rgba(244,235,217,0.62); }}
.ciq-stage figcaption .live {{ width: 7px; height: 7px; border-radius: 50%; background: {LIME};
    animation: ciq-pulse 2.4s ease-in-out infinite; }}
.ciq-stage figcaption .ch {{ margin-left: auto; font-family: {DISPLAY_STACK}; font-style: italic; letter-spacing: 0; text-transform: none;
    font-size: 0.9rem; }}
.ciq-stage .off {{ font-size: 0.82rem; color: #BDAF97; }}
@keyframes ciq-pulse {{ 0%, 100% {{ opacity: 1; }} 50% {{ opacity: 0.25; }} }}
@media (prefers-reduced-motion: reduce) {{ .ciq-stage figcaption .live {{ animation: none; }} }}
/* Stack side-by-side stages whenever the stage itself is too narrow to keep the video large. */
.ciq-stage-wrap {{ container-type: inline-size; }}
@container (max-width: 980px) {{
  .ciq-stage.media-left, .ciq-stage.media-right {{ grid-template-columns: 1fr; grid-template-areas: "media" "copy"; }}
  .ciq-stage.wide .copy {{ display: block; }}
}}
@media (max-width: 760px) {{
  .ciq-stage {{ padding: 20px; gap: 20px; }}
  .ciq-stage.wide .copy {{ display: block; }}
  .ciq-stage .h {{ font-size: 2rem; }}
}}

/* Plain-language takeaway + recommended action */
.ciq-take {{ display: grid; grid-template-columns: 1.3fr 1fr; overflow: hidden; margin: 0 0 1.6rem 0; }}
.ciq-take > div {{ padding: 20px 24px; }}
.ciq-take > div:first-child {{ border-top: 2px solid {ESPRESSO}; padding-left: 0; }}
.ciq-take .l {{ font-size: 0.68rem; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: {ORANGE}; margin-bottom: 8px; }}
.ciq-take .t {{ font-family: {DISPLAY_STACK}; font-size: 1.55rem; color: {INK}; line-height: 1.15; margin-bottom: 8px; }}
.ciq-take .x {{ font-size: 0.95rem; line-height: 1.55; color: #4A4139; }}
.ciq-take .act {{ background: {ESPRESSO}; }}
.ciq-take .act .l {{ color: {LIME}; }}
.ciq-take .act .x {{ color: {IVORY}; font-size: 1.02rem; }}
@media (max-width: 760px) {{ .ciq-take {{ grid-template-columns: 1fr; }} }}

/* How to read / why it matters */
.ciq-explain {{ display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin: -4px 0 1.2rem 0; font-size: 0.86rem; line-height: 1.5;
    color: #4A4139; }}
.ciq-explain b {{ display: block; font-size: 0.66rem; letter-spacing: 0.16em; text-transform: uppercase; color: {BURGUNDY}; margin-bottom: 3px; }}
@media (max-width: 760px) {{ .ciq-explain {{ grid-template-columns: 1fr; gap: 10px; }} }}

/* Action list (Overview) */
.ciq-action {{ border-top: 2px solid {ESPRESSO}; padding: 14px 0 0 0; margin-bottom: 1.2rem; }}
.ciq-action .n {{ font-family: {DISPLAY_STACK}; font-style: italic; font-size: 2.4rem; color: {ORANGE}; line-height: 1; }}
.ciq-action .t {{ font-family: {DISPLAY_STACK}; color: {INK}; font-size: 1.3rem; line-height: 1.2; margin: 10px 0 8px 0; }}
.ciq-action .o {{ color: #5A5047; font-size: 0.9rem; line-height: 1.5; }}
.ciq-action .do {{ margin-top: 12px; padding: 12px 14px; background: {BURGUNDY}; color: {IVORY}; border-radius: 2px; font-size: 0.9rem; line-height: 1.5; }}
.ciq-action .do b {{ display: block; color: {LIME}; font-size: 0.66rem; letter-spacing: 0.16em; text-transform: uppercase; margin-bottom: 4px; }}

/* Segment guide cards */
.ciq-seg {{ border-top: 2px solid {ESPRESSO}; padding: 12px 0 0 0; margin-bottom: 1.4rem; }}
.ciq-seg .nm {{ display: flex; align-items: center; gap: 9px; font-family: {DISPLAY_STACK}; font-size: 1.35rem; color: {INK}; }}
.ciq-seg .dot {{ width: 11px; height: 11px; border-radius: 50%; flex: none; }}
.ciq-seg .fig {{ font-size: 0.8rem; color: {SLATE}; margin: 4px 0 8px 0; }}
.ciq-seg .fig b {{ color: {BURGUNDY}; font-weight: 650; }}
.ciq-seg .ds {{ font-size: 0.9rem; line-height: 1.5; color: #4A4139; }}
.ciq-seg .ap {{ margin-top: 8px; font-size: 0.86rem; line-height: 1.5; color: {INK}; padding-left: 12px; border-left: 2px solid {ORANGE}; }}

/* Steps (Data Management) */
.ciq-steps {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 0; margin: 0.4rem 0 1.4rem 0; }}
.ciq-steps > div {{ border-top: 2px solid {ESPRESSO}; padding: 12px 20px 0 0; }}
.ciq-steps .k {{ font-family: {DISPLAY_STACK}; font-style: italic; font-size: 1.9rem; color: {ORANGE}; line-height: 1; }}
.ciq-steps .t {{ font-weight: 650; color: {INK}; margin: 6px 0 4px 0; }}
.ciq-steps .d {{ font-size: 0.86rem; color: #4A4139; line-height: 1.5; }}
@media (max-width: 760px) {{ .ciq-steps {{ grid-template-columns: 1fr; gap: 14px; }} }}

/* Shared blocks */
.ciq-brand {{ font-size: 1.35rem; font-weight: 700; color: {IVORY} !important; }}
.ciq-tagline {{ font-size: 0.78rem; color: #A99C88 !important; margin-top: -2px; line-height: 1.35; }}
.ciq-badge {{ display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.04em; }}
.ciq-badge.synthetic {{ background: rgba(230,107,67,0.16); color: #F2A88E !important; border: 1px solid rgba(230,107,67,0.5); }}
.ciq-badge.real {{ background: rgba(214,255,63,0.10); color: {LIME} !important; border: 1px solid rgba(214,255,63,0.45); }}
.ciq-note {{ border-left: 2px solid {ORANGE}; padding: 4px 0 4px 14px; color: #4A4139; font-size: 0.86rem; line-height: 1.5;
    margin: 0.2rem 0 1.2rem 0; }}
.ciq-insight {{ border-top: 2px solid {ESPRESSO}; padding: 12px 0 0 0; height: 100%; margin-bottom: 1rem; }}
.ciq-insight .kind {{ font-size: 0.68rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; }}
.ciq-insight .kind.risk {{ color: {NEGATIVE}; }} .ciq-insight .kind.opportunity {{ color: {POSITIVE}; }}
.ciq-insight .kind.info {{ color: {BURGUNDY}; }}
.ciq-insight .cat {{ color: {MUTED}; font-size: 0.7rem; margin-left: 6px; }}
.ciq-insight .title {{ font-family: {DISPLAY_STACK}; color: {INK}; font-size: 1.2rem; margin: 6px 0 6px 0; line-height: 1.2; }}
.ciq-insight .body {{ color: #4A4139; font-size: 0.88rem; line-height: 1.5; }}
.ciq-insight .metric {{ color: {BURGUNDY}; font-size: 0.8rem; font-weight: 600; margin-top: 8px; }}
.ciq-insight dl {{ margin: 8px 0 0 0; font-size: 0.86rem; color: #4A4139; }}
.ciq-insight dt {{ font-weight: 650; color: {INK}; margin-top: 6px; }}
.ciq-insight dd {{ margin: 0; }}
.ciq-empty {{ background: {SURFACE}; border: 1px dashed #C9B999; border-radius: 3px; padding: 34px; text-align: center; color: {SLATE}; }}
.ciq-empty .t {{ font-family: {DISPLAY_STACK}; color: {INK}; font-size: 1.4rem; margin-bottom: 6px; }}
.ciq-stat {{ border-top: 2px solid {ESPRESSO}; padding: 10px 0 0 0; }}
.ciq-stat .l {{ color: {SLATE}; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }}
.ciq-stat .v {{ color: {INK}; font-family: {DISPLAY_STACK}; font-size: 1.4rem; }}
.ciq-stat .s {{ color: {MUTED}; font-size: 0.76rem; }}
</style>
"""


def apply_theme() -> None:
    register_plotly_template()
    st.markdown(CSS, unsafe_allow_html=True)
