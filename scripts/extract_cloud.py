"""Extract cloud fraction (clt) and surface solar radiation (rsds) from CMIP6 GFDL-ESM4.

Why clt over rsds for visualisation:
  - clt (total cloud fraction, %) → "30 % cloudy" is immediately legible to any reader
  - rsds (W m⁻²) requires scientific context to interpret
  Both are saved; the visitor-recommendation chart uses clt.

Output files:
  data/monthly_cloud.csv  – year × month × clt_pct × rsds_wm2  (1925–2014)
  data/monthly_cloud_avg.csv – 12-row monthly climatology (mean across all years)
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import xarray as xr
import gcsfs

# Reuse constants from extract_cmip6.py
SAN_DIEGO_LAT = 32.7157
SAN_DIEGO_LON = 360 - 117.1611  # ≈ 242.8389

START_YEAR = 1925
END_YEAR   = 2014

SOURCE_ID      = "GFDL-ESM4"
INSTITUTION_ID = "NOAA-GFDL"
MEMBER_ID      = "r1i1p1f1"
CATALOG_CSV    = "https://storage.googleapis.com/cmip6/cmip6-zarr-consolidated-stores.csv"

ROOT     = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"

_gcs: gcsfs.GCSFileSystem | None = None
_catalog: pd.DataFrame | None = None


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


def find_zstore(variable_id: str, table_id: str = "Amon") -> str:
    df = get_catalog()
    match = df[
        (df["activity_id"]    == "CMIP")
        & (df["table_id"]     == table_id)
        & (df["variable_id"]  == variable_id)
        & (df["experiment_id"] == "historical")
        & (df["source_id"]    == SOURCE_ID)
        & (df["institution_id"] == INSTITUTION_ID)
        & (df["member_id"]    == MEMBER_ID)
    ]
    if match.empty:
        raise RuntimeError(f"No zarr store found for {variable_id} ({table_id})")
    return str(match.iloc[0]["zstore"])


def load_point_series(variable_id: str, table_id: str = "Amon") -> tuple[xr.DataArray, float, float]:
    zstore = find_zstore(variable_id, table_id=table_id)
    ds = xr.open_zarr(get_gcs().get_mapper(zstore), consolidated=True)
    series = (
        ds[variable_id]
        .sel(lon=SAN_DIEGO_LON, lat=SAN_DIEGO_LAT, method="nearest")
        .load()
        .squeeze(drop=True)
    )
    return series, float(series["lat"].values), float(series["lon"].values)


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    cache = DATA_DIR / "monthly_cloud.csv"

    if cache.exists():
        print(f"Using cached {cache}")
        df = pd.read_csv(cache)
    else:
        # ── clt: total cloud area fraction (0–100 %) ──────────────────
        print("Loading clt (total cloud fraction)…")
        clt_raw, lat_clt, lon_clt = load_point_series("clt")
        clt_df = clt_raw.to_dataframe(name="clt").reset_index()
        clt_df["year"]  = clt_df["time"].map(lambda t: int(t.year))
        clt_df["month"] = clt_df["time"].map(lambda t: int(t.month))
        clt_df = clt_df[["year", "month", "clt"]]

        # ── rsds: surface downwelling shortwave radiation (W m⁻²) ─────
        print("Loading rsds (surface solar radiation)…")
        rsds_raw, lat_rsds, lon_rsds = load_point_series("rsds")
        rsds_df = rsds_raw.to_dataframe(name="rsds").reset_index()
        rsds_df["year"]  = rsds_df["time"].map(lambda t: int(t.year))
        rsds_df["month"] = rsds_df["time"].map(lambda t: int(t.month))
        rsds_df = rsds_df[["year", "month", "rsds"]]

        df = clt_df.merge(rsds_df, on=["year", "month"], how="inner")

        # Some models store clt as a fraction (0–1) rather than percent;
        # normalise to 0–100 %.
        if df["clt"].max() <= 1.5:
            print("  clt appears to be 0–1 fraction; converting to %")
            df["clt"] = df["clt"] * 100.0

        df = df.rename(columns={"clt": "clt_pct", "rsds": "rsds_wm2"})
        df = (
            df[(df["year"] >= START_YEAR) & (df["year"] <= END_YEAR)]
            .sort_values(["year", "month"])
            .reset_index(drop=True)
        )
        df.to_csv(cache, index=False)
        print(f"Saved {len(df)} rows to {cache}")

    # ── Monthly climatology ──────────────────────────────────────────
    avg_path = DATA_DIR / "monthly_cloud_avg.csv"
    avg = (
        df.groupby("month", as_index=False)
        .agg(clt_pct=("clt_pct", "mean"), rsds_wm2=("rsds_wm2", "mean"))
    )
    avg.to_csv(avg_path, index=False)

    # Summary
    months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
    print(f"\nMonthly cloud climatology ({START_YEAR}–{END_YEAR}):")
    print(f"  {'Month':<6}  {'Avg cloud %':>11}  {'Solar W/m²':>10}")
    for _, row in avg.iterrows():
        print(f"  {months[int(row.month)-1]:<6}  {row.clt_pct:>10.1f}%  {row.rsds_wm2:>9.1f}")


if __name__ == "__main__":
    main()
