"""Extract CMIP6 SSP future scenario monthly climatologies for San Diego.

Uses GFDL-ESM4 r1i1p1f1 ScenarioMIP runs (same model as historical).
SSP data spans 2015-2100; we use 2091-2100 as the "end-of-century" window
(closest available decade to the requested 2100-2110 — data ends Dec 2100).

Present-day baseline (2005-2014) is computed from existing local CSVs
rather than re-downloading the historical zarr.

Variables extracted for each scenario:
  tas  → temp_c    (near-surface air temperature, °C)
  pr   → precip_mm (monthly precipitation total, mm)
  clt  → clt_pct   (total cloud fraction, %)

Output files:
  data/ssp_raw_<scenario>.csv       — monthly data 2015-2100 per scenario (cache)
  data/ssp_monthly_climatology.csv  — 5 scenarios × 12 months, all variables
"""

from __future__ import annotations

import calendar
from pathlib import Path

import gcsfs
import numpy as np
import pandas as pd
import xarray as xr

# San Diego grid point (same as historical extraction)
SAN_DIEGO_LAT = 32.7157
SAN_DIEGO_LON = 360 - 117.1611  # ≈ 242.84

SOURCE_ID      = "GFDL-ESM4"
INSTITUTION_ID = "NOAA-GFDL"
MEMBER_ID      = "r1i1p1f1"
CATALOG_CSV    = "https://storage.googleapis.com/cmip6/cmip6-zarr-consolidated-stores.csv"

SCENARIOS    = ["ssp126", "ssp245", "ssp370", "ssp585"]
FUTURE_START = 2091
FUTURE_END   = 2100  # last year in SSP data; 2091-2100 = 10-year climatology
PRESENT_START = 2005
PRESENT_END   = 2014

ROOT     = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"

_gcs: gcsfs.GCSFileSystem | None = None
_catalog: pd.DataFrame | None = None


# ── GCS / catalog helpers ─────────────────────────────────────────────────────

def get_gcs() -> gcsfs.GCSFileSystem:
    global _gcs
    if _gcs is None:
        _gcs = gcsfs.GCSFileSystem(token="anon")
    return _gcs


def get_catalog() -> pd.DataFrame:
    global _catalog
    if _catalog is None:
        print("Loading CMIP6 catalog…")
        _catalog = pd.read_csv(CATALOG_CSV)
    return _catalog


def find_ssp_zstore(variable_id: str, experiment_id: str, table_id: str = "Amon") -> str:
    df = get_catalog()
    match = df[
        (df["activity_id"]   == "ScenarioMIP")
        & (df["table_id"]    == table_id)
        & (df["variable_id"] == variable_id)
        & (df["experiment_id"] == experiment_id)
        & (df["source_id"]   == SOURCE_ID)
        & (df["institution_id"] == INSTITUTION_ID)
        & (df["member_id"]   == MEMBER_ID)
    ]
    if match.empty:
        raise RuntimeError(
            f"No zarr store found for {variable_id} / {experiment_id} / {table_id}"
        )
    return str(match.iloc[0]["zstore"])


def load_ssp_point(variable_id: str, experiment_id: str, table_id: str = "Amon") -> xr.DataArray:
    zstore = find_ssp_zstore(variable_id, experiment_id, table_id)
    ds = xr.open_zarr(get_gcs().get_mapper(zstore), consolidated=True)
    series = (
        ds[variable_id]
        .sel(lon=SAN_DIEGO_LON, lat=SAN_DIEGO_LAT, method="nearest")
        .load()
        .squeeze(drop=True)
    )
    return series


# ── Unit conversions ─────────────────────────────────────────────────────────

def kelvin_to_c(values: np.ndarray) -> np.ndarray:
    return values - 273.15


def pr_flux_to_mm_month(flux: np.ndarray, months: np.ndarray) -> np.ndarray:
    """Convert kg m⁻² s⁻¹ → mm/month using the days in each month."""
    days = np.array([calendar.monthrange(2000, int(m))[1] for m in months])
    return flux * 86_400.0 * days


# ── Per-scenario download / cache ────────────────────────────────────────────

def load_or_cache_scenario(scenario: str) -> pd.DataFrame:
    """Download all three variables for one SSP scenario and cache to CSV."""
    cache = DATA_DIR / f"ssp_raw_{scenario}.csv"
    if cache.exists():
        print(f"  Using cached {cache.name}")
        return pd.read_csv(cache)

    print(f"  Downloading tas ({scenario})…")
    tas = load_ssp_point("tas", scenario)
    print(f"  Downloading pr  ({scenario})…")
    pr  = load_ssp_point("pr",  scenario)
    print(f"  Downloading clt ({scenario})…")
    clt = load_ssp_point("clt", scenario)

    tas_df = tas.to_dataframe(name="tas_k").reset_index()[["time", "tas_k"]]
    pr_df  = pr .to_dataframe(name="pr_f") .reset_index()[["time", "pr_f"]]
    clt_df = clt.to_dataframe(name="clt_r").reset_index()[["time", "clt_r"]]

    df = tas_df.merge(pr_df, on="time").merge(clt_df, on="time")
    df["year"]  = df["time"].map(lambda t: int(t.year))
    df["month"] = df["time"].map(lambda t: int(t.month))

    df["temp_c"]    = kelvin_to_c(df["tas_k"].to_numpy())
    df["precip_mm"] = pr_flux_to_mm_month(df["pr_f"].to_numpy(), df["month"].to_numpy())
    df["clt_pct"]   = df["clt_r"].copy()
    if df["clt_pct"].max() <= 1.5:
        print("    clt appears to be 0–1 fraction; converting to %")
        df["clt_pct"] = df["clt_pct"] * 100.0

    out = (
        df[["year", "month", "temp_c", "precip_mm", "clt_pct"]]
        .sort_values(["year", "month"])
        .reset_index(drop=True)
    )
    out.to_csv(cache, index=False)
    print(f"  Saved {len(out)} rows → {cache.name}")
    return out


# ── Climatology helpers ───────────────────────────────────────────────────────

def window_climatology(df: pd.DataFrame, start: int, end: int) -> pd.DataFrame:
    """Return 12-row monthly mean climatology for a year window."""
    w = df[(df["year"] >= start) & (df["year"] <= end)]
    return (
        w.groupby("month", as_index=False)
        .agg(temp_c=("temp_c", "mean"), precip_mm=("precip_mm", "mean"), clt_pct=("clt_pct", "mean"))
        .sort_values("month")
        .reset_index(drop=True)
    )


def present_day_climatology() -> pd.DataFrame:
    """Build 2005-2014 baseline from existing local CSVs (no re-download needed)."""
    tp = pd.read_csv(DATA_DIR / "monthly_by_year.csv")
    tp = tp[(tp["year"] >= PRESENT_START) & (tp["year"] <= PRESENT_END)]
    clim = tp.groupby("month", as_index=False).agg(
        temp_c=("temp_c", "mean"),
        precip_mm=("precip_mm", "mean"),
    )

    clt_path = DATA_DIR / "monthly_cloud.csv"
    if clt_path.exists():
        clt = pd.read_csv(clt_path)
        clt = clt[(clt["year"] >= PRESENT_START) & (clt["year"] <= PRESENT_END)]
        clim_clt = clt.groupby("month", as_index=False).agg(clt_pct=("clt_pct", "mean"))
        clim = clim.merge(clim_clt, on="month", how="left")
    else:
        print("  monthly_cloud.csv not found — clt_pct will be NaN for present baseline.")
        print("  Run scripts/extract_cloud.py first if you want cloud data in present.")
        clim["clt_pct"] = float("nan")

    return clim.sort_values("month").reset_index(drop=True)


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    rows: list[dict] = []

    # Present-day baseline from local data (fast — no download)
    print("Building present-day climatology (2005-2014) from local CSVs…")
    present = present_day_climatology()
    label = f"present_{PRESENT_START}_{PRESENT_END}"
    for _, r in present.iterrows():
        rows.append({
            "scenario": label,
            "month": int(r["month"]),
            "temp_c": round(float(r["temp_c"]), 4),
            "precip_mm": round(float(r["precip_mm"]), 4),
            "clt_pct": round(float(r["clt_pct"]), 4) if pd.notna(r.get("clt_pct")) else None,
        })

    # Future projections — download + cache per scenario
    for scenario in SCENARIOS:
        print(f"\nScenario: {scenario}")
        df = load_or_cache_scenario(scenario)
        clim = window_climatology(df, FUTURE_START, FUTURE_END)
        label = f"{scenario}_{FUTURE_START}_{FUTURE_END}"
        for _, r in clim.iterrows():
            rows.append({
                "scenario": label,
                "month": int(r["month"]),
                "temp_c": round(float(r["temp_c"]), 4),
                "precip_mm": round(float(r["precip_mm"]), 4),
                "clt_pct": round(float(r["clt_pct"]), 4),
            })

    out = pd.DataFrame(rows)
    out_path = DATA_DIR / "ssp_monthly_climatology.csv"
    out.to_csv(out_path, index=False)
    print(f"\nSaved {len(out)} rows → {out_path.name}")

    # ── Summary table ─────────────────────────────────────────────────
    MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
    print(f"\n{'Scenario':<32}  {'Jan':>6}  {'Jul':>6}  {'Δ Jan':>6}  {'Ann rain':>9}  {'Avg clt':>8}")
    print("-" * 80)

    present_row = out[out["scenario"].str.startswith("present")].set_index("month")
    present_jan = present_row.loc[1, "temp_c"]
    present_jul = present_row.loc[7, "temp_c"]

    for scenario_key in out["scenario"].unique():
        sub = out[out["scenario"] == scenario_key].set_index("month")
        jan_t = sub.loc[1, "temp_c"]
        jul_t = sub.loc[7, "temp_c"]
        delta_jan = jan_t - present_jan
        ann_p = sub["precip_mm"].sum()
        ann_c = sub["clt_pct"].mean()
        delta_str = f"{delta_jan:+.2f}" if not scenario_key.startswith("present") else "  —   "
        print(
            f"  {scenario_key:<32}  {jan_t:>5.2f}°  {jul_t:>5.2f}°  "
            f"{delta_str:>6}  {ann_p:>8.0f}mm  {ann_c:>7.1f}%"
        )


if __name__ == "__main__":
    main()
