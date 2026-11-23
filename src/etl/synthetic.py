"""Deterministic SYNTHETIC demo dataset.

Everything produced here is artificial. It exists to demonstrate the product and
must never be presented as real business data. The generator produces a raw,
Online-Retail-style export (including a small, deliberate number of data quality
problems) so that the cleaning pipeline has something genuine to do.

Behavioural design (all parameters below are invented for demonstration):

* Customer personas with different order rates, basket sizes and lifetimes:
  ``vip``, ``regular``, ``occasional``, ``one_time`` and ``seasonal`` (Q4 gift buyers).
* Customers churn after a persona-dependent, exponentially distributed lifetime,
  which creates genuinely inactive customers.
* Monthly seasonality with a November/December peak and acquisition growth.
* About 3% of orders have a partial return, issued as a separate ``C`` invoice.
* Injected quality issues: exact duplicate lines, missing customer IDs, zero
  prices, zero quantities and unparseable dates.
"""
from __future__ import annotations

from datetime import datetime, timedelta

import numpy as np
import pandas as pd

SYNTHETIC_LABEL = "Synthetic demo data (generated, not real customers)"
DEFAULT_SEED = 20240101
START = datetime(2023, 1, 1)
END = datetime(2024, 12, 31, 23, 59)

SEASONALITY = {1: 0.80, 2: 0.82, 3: 0.92, 4: 0.92, 5: 0.98, 6: 0.95,
               7: 0.90, 8: 0.92, 9: 1.05, 10: 1.15, 11: 1.55, 12: 1.70}

CATALOGUE: dict[str, list[tuple[str, float]]] = {
    "Home Decor": [("Linen Cushion Cover", 14.5), ("Ceramic Vase Small", 18.0), ("Ceramic Vase Large", 32.0),
                   ("Woven Storage Basket", 24.0), ("Framed Botanical Print", 39.0), ("Wool Throw Blanket", 58.0),
                   ("Wall Mirror Round", 72.0), ("Scented Candle Cedar", 12.0)],
    "Kitchen": [("Enamel Mug", 9.5), ("Stoneware Bowl Set", 34.0), ("Oak Serving Board", 27.0),
                ("Linen Tea Towel", 7.5), ("Glass Storage Jar", 11.0), ("Cast Iron Skillet", 45.0),
                ("Copper Measuring Cups", 22.0), ("Ceramic Teapot", 29.0)],
    "Stationery": [("Dot Grid Notebook", 8.5), ("Brass Pen", 19.0), ("Desk Organiser", 26.0),
                   ("Greeting Card Pack", 6.0), ("Leather Journal", 35.0), ("Wall Planner", 15.0),
                   ("Washi Tape Set", 5.5)],
    "Gifts": [("Gift Box Deluxe", 49.0), ("Holiday Ornament Set", 16.0), ("Advent Calendar", 28.0),
              ("Gift Wrap Bundle", 9.0), ("Candle Gift Trio", 31.0), ("Personalised Keyring", 12.5)],
    "Garden": [("Terracotta Planter", 17.0), ("Herb Seed Kit", 13.0), ("Garden Tool Set", 42.0),
               ("Bird Feeder", 21.0), ("Watering Can", 25.0), ("Outdoor Lantern", 38.0)],
    "Lighting": [("Table Lamp Linen", 64.0), ("Pendant Shade Rattan", 55.0), ("LED String Lights", 18.5),
                 ("Reading Lamp Brass", 79.0), ("Tea Light Holder Set", 13.5)],
}

COUNTRIES = (["United Kingdom"] * 58 + ["Germany"] * 9 + ["France"] * 8 + ["Netherlands"] * 6 +
             ["Ireland"] * 5 + ["Spain"] * 4 + ["Belgium"] * 3 + ["Sweden"] * 3 + ["United States"] * 4)

# persona: share, monthly order rate, mean extra lines, mean lifetime days, qty lambda
PERSONAS = {
    "vip":        (0.07, 1.10, 3.5, 900, 3.0),
    "regular":    (0.23, 0.40, 2.0, 420, 1.2),
    "occasional": (0.28, 0.14, 1.2, 330, 0.6),
    "one_time":   (0.27, 0.00, 1.0, 0, 0.5),
    "seasonal":   (0.15, 0.00, 1.8, 760, 0.8),
}


def _products() -> pd.DataFrame:
    rows = []
    code = 21000
    for category, items in CATALOGUE.items():
        for name, price in items:
            code += 7
            rows.append({"StockCode": str(code), "Description": name.upper(), "Category": category, "price": price})
    df = pd.DataFrame(rows)
    rank = np.arange(1, len(df) + 1)
    rng = np.random.default_rng(7)
    popularity = 1.0 / rank[rng.permutation(len(df))] ** 0.6
    df["weight"] = popularity / popularity.sum()
    return df


def _season_weighted_time(rng: np.random.Generator, lo: datetime, hi: datetime) -> datetime | None:
    span = (hi - lo).total_seconds()
    if span <= 0:
        return None
    for _ in range(50):
        t = lo + timedelta(seconds=float(rng.uniform(0, span)))
        if rng.uniform(0, 1.7) <= SEASONALITY[t.month]:
            return t
    return lo + timedelta(seconds=float(rng.uniform(0, span)))


def _with_shop_hours(rng: np.random.Generator, t: datetime) -> datetime:
    hour = int(rng.choice(np.arange(7, 23), p=_HOUR_WEIGHTS))
    return t.replace(hour=hour, minute=int(rng.integers(0, 60)), second=0, microsecond=0)


_hw = np.array([1, 2, 4, 6, 7, 7, 8, 7, 6, 6, 6, 7, 8, 8, 6, 3], dtype=float)
_HOUR_WEIGHTS = _hw / _hw.sum()


def generate_demo_transactions(n_customers: int = 1600, seed: int = DEFAULT_SEED,
                               inject_issues: bool = True) -> pd.DataFrame:
    """Return a raw transaction export (one row per invoice line). Deterministic for a seed."""
    rng = np.random.default_rng(seed)
    products = _products()
    personas = list(PERSONAS)
    shares = np.array([PERSONAS[p][0] for p in personas])
    total_days = (END - START).days

    # Acquisition dates: growth over time plus seasonality.
    day_index = np.arange(total_days)
    dates = [START + timedelta(days=int(d)) for d in day_index]
    weights = np.array([(1 + 0.6 * d / total_days) * SEASONALITY[dt.month] for d, dt in zip(day_index, dates)])
    weights /= weights.sum()

    # Plain arrays keep the per-line loop fast.
    codes = products["StockCode"].to_numpy()
    descs = products["Description"].to_numpy()
    cats = products["Category"].to_numpy()
    prices = products["price"].to_numpy()
    base_w = products["weight"].to_numpy()
    gift_boost = np.where(cats == "Gifts", 3.0, 1.0)
    category_names = list(CATALOGUE)
    cat_bias = {c: np.where(cats == c, 2.5, 1.0) for c in category_names}
    persona_p = shares / shares.sum()

    orders: list[dict] = []
    for i in range(n_customers):
        customer_id = str(12001 + i)
        persona = personas[int(rng.choice(len(personas), p=persona_p))]
        _, rate, extra_lines, mean_life, qty_lambda = PERSONAS[persona]
        country = COUNTRIES[int(rng.integers(0, len(COUNTRIES)))]
        signup = dates[int(rng.choice(total_days, p=weights))]
        signup = signup + timedelta(hours=float(rng.uniform(0, 23)))
        fav_category = category_names[int(rng.integers(0, len(category_names)))]

        times = [signup]
        if persona == "seasonal":
            churn = signup + timedelta(days=float(rng.exponential(mean_life)))
            for year in (2023, 2024):
                lo, hi = datetime(year, 10, 15), datetime(year, 12, 22)
                if hi < signup or lo > churn:
                    continue
                for _ in range(int(rng.integers(1, 4))):
                    t = lo + timedelta(seconds=float(rng.uniform(0, (hi - lo).total_seconds())))
                    if signup < t < min(churn, END):
                        times.append(t)
        elif persona != "one_time":
            churn = signup + timedelta(days=float(rng.exponential(mean_life)))
            stop = min(churn, END)
            months_alive = max((stop - signup).days / 30.4, 0)
            for _ in range(int(rng.poisson(rate * months_alive))):
                t = _season_weighted_time(rng, signup, stop)
                if t is not None:
                    times.append(t)

        for t in sorted(times):
            t = _with_shop_hours(rng, t)
            n_lines = 1 + int(rng.poisson(extra_lines))
            p = base_w * cat_bias[fav_category]
            if t.month in (11, 12):  # gifts sell far better in Q4
                p = p * gift_boost
            p = p / p.sum()
            picks = rng.choice(len(codes), size=min(n_lines, len(codes)), replace=False, p=p)
            uplift = 1.05 if t.year == 2024 else 1.0  # modest price rise in year two
            lines = [{"StockCode": codes[k], "Description": descs[k], "Category": cats[k],
                      "Quantity": 1 + int(rng.poisson(qty_lambda)),
                      "UnitPrice": round(float(prices[k] * uplift), 2)} for k in picks]
            orders.append({"customer": customer_id, "country": country, "time": t, "lines": lines})

    orders.sort(key=lambda o: (o["time"], o["customer"]))
    rows: list[dict] = []
    invoice_no = 540000
    for order in orders:
        invoice_no += 1
        for line in order["lines"]:
            rows.append({"InvoiceNo": str(invoice_no), **line, "InvoiceDate": order["time"],
                         "CustomerID": order["customer"], "Country": order["country"]})
        # Partial returns on ~3% of orders, issued 2-20 days later.
        if rng.uniform() < 0.03:
            line = order["lines"][int(rng.integers(0, len(order["lines"])))]
            ret_time = order["time"] + timedelta(days=int(rng.integers(2, 21)))
            if ret_time <= END:
                rows.append({"InvoiceNo": f"C{invoice_no}", **line,
                             "Quantity": -int(rng.integers(1, line["Quantity"] + 1)),
                             "InvoiceDate": ret_time, "CustomerID": order["customer"],
                             "Country": order["country"]})

    df = pd.DataFrame(rows)
    df["InvoiceDate"] = pd.to_datetime(df["InvoiceDate"]).dt.strftime("%Y-%m-%d %H:%M")
    df = df[["InvoiceNo", "StockCode", "Description", "Category", "Quantity", "InvoiceDate",
             "UnitPrice", "CustomerID", "Country"]].astype(object)
    if inject_issues:
        df = _inject_quality_issues(df, rng)
    return df.reset_index(drop=True)


def _inject_quality_issues(df: pd.DataFrame, rng: np.random.Generator) -> pd.DataFrame:
    """Add a small, known number of realistic data problems."""
    df = df.copy()
    n = len(df)
    sales_idx = df.index[~df["InvoiceNo"].str.startswith("C")].to_numpy()

    picks = rng.choice(sales_idx, size=120, replace=False)
    missing_cust, zero_price, zero_qty, bad_dates = picks[:60], picks[60:75], picks[75:85], picks[85:93]
    df.loc[missing_cust, "CustomerID"] = ""          # guest checkouts
    df.loc[zero_price, "UnitPrice"] = 0.0            # free samples
    df.loc[zero_qty, "Quantity"] = 0
    bad_values = ["2024-13-45 10:00", "not recorded", "31/02/2024", "", "1900-00-00", "TBC", "2023-02-30", "?"]
    for idx, value in zip(bad_dates, bad_values):
        df.loc[idx, "InvoiceDate"] = value

    duplicates = df.loc[rng.choice(sales_idx, size=45, replace=False)]
    df = pd.concat([df, duplicates], ignore_index=True)
    return df.sort_values(["InvoiceDate", "InvoiceNo"], kind="stable").reset_index(drop=True) if n else df


DEMO_MAPPING = {
    "invoice_id": "InvoiceNo", "customer_id": "CustomerID", "invoice_date": "InvoiceDate",
    "quantity": "Quantity", "unit_price": "UnitPrice", "product_id": "StockCode",
    "description": "Description", "category": "Category", "country": "Country", "revenue": None,
}
