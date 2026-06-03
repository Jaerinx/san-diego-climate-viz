"""Extract San Diego-area LAI and FAPAR monthly means from the NOAA CDR.

Streams daily NetCDF files from gs://noaa-cdr-leaf-area-index-fapar/
directly into memory — no raw data files are written to disk.
Aggregates daily values to monthly means to match the monthly_by_year.csv
CMIP6 time axis.

Output:
  data/monthly_lai_fapar.csv  –  year × month × lai_mean × fapar_mean (1982–2014)

Usage:
  python scripts/extract_lai_fapar.py          # full 1982–2014 run
  python scripts/extract_lai_fapar.py --test   # single year (1982) to verify setup

Runtime note:
  ~12 000 daily files. Progress is saved after every month so the run
  can be interrupted and resumed without losing work.

Dependencies (add to your environment if missing):
  pip install gcsfs fsspec xarray scipy h5netcdf
"""

from __future__ import annotations

import argparse
import io
import re
import sys
from datetime import date, timedelta
from pathlib import Path

import gcsfs
import numpy as np
import pandas as pd
import xarray as xr

# ── San Diego bounding box ────────────────────────────────────────────
SD_LAT_MIN, SD_LAT_MAX =  32.5,  33.5
SD_LON_MIN, SD_LON_MAX = -117.5, -116.0  # −180 / +180 convention

# ── Bucket ────────────────────────────────────────────────────────────
BUCKET      = "noaa-cdr-leaf-area-index-fapar"
DATA_PREFIX = "data"

# CDR AVHRR record starts 1982; CMIP6 data ends 2014 → overlap period
START_YEAR = 1982
END_YEAR   = 2014

ROOT     = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
OUT_PATH = DATA_DIR / "monthly_lai_fapar.csv"

_fs: gcsfs.GCSFileSystem | None = None


def get_fs() -> gcsfs.GCSFileSystem:
    global _fs
    if _fs is None:
        _fs = gcsfs.GCSFileSystem(token="anon")
    return _fs


# ── Filename helpers ──────────────────────────────────────────────────

def discover_pattern(year: int) -> str | None:
    """Return the filename of the first .nc file found in `year`'s directory."""
    try:
        files = [
            Path(p).name
            for p in get_fs().ls(f"{BUCKET}/{DATA_PREFIX}/{year}/")
            if p.endswith(".nc")
        ]
        return files[0] if files else None
    except FileNotFoundError:
        return None


def make_filename(pattern: str, year: int, month: int, day: int) -> str:
    """
    Swap the 8-digit YYYYMMDD stamp in `pattern` for the target date.
    Works regardless of the exact CDR naming scheme.
    e.g. NOAA-CDR-LEAF-AREA-INDEX_V1_19820101.nc → ..._20001215.nc
    """
    return re.sub(r"\d{8}", f"{year}{month:02d}{day:02d}", pattern)


def build_path(year: int, month: int, day: int, pattern: str) -> str:
    return f"{BUCKET}/{DATA_PREFIX}/{year}/{make_filename(pattern, year, month, day)}"


# ── Streaming + slicing ───────────────────────────────────────────────

def stream_sd_slice(gcs_path: str) -> xr.Dataset | None:
    """
    Stream one daily NetCDF file from GCS into memory and immediately
    return only the San Diego bounding-box slice.

    Returns None if the file is missing or cannot be parsed — missing
    days are common in satellite CDRs and handled gracefully upstream.
    """
    try:
        with get_fs().open(gcs_path, "rb") as fh:
            raw = fh.read()
    except (FileNotFoundError, OSError):
        return None

    # Try NetCDF3 first (scipy), fall back to NetCDF4/HDF5 (h5netcdf).
    # xarray decodes _FillValue, scale_factor, and add_offset automatically.
    buf = io.BytesIO(raw)
    try:
        ds = xr.open_dataset(buf, engine="scipy")
    except Exception:
        buf.seek(0)
        try:
            ds = xr.open_dataset(buf, engine="h5netcdf")
        except Exception:
            return None

    # Normalise coordinate names — CDR may use latitude/longitude
    rename = {}
    if "latitude"  in ds.coords and "lat" not in ds.coords:
        rename["latitude"]  = "lat"
    if "longitude" in ds.coords and "lon" not in ds.coords:
        rename["longitude"] = "lon"
    if rename:
        ds = ds.rename(rename)

    # Detect longitude convention and adjust SD bounds accordingly
    if float(ds["lon"].max()) > 180:
        # 0–360: convert  −117.5 → 242.5,  −116.0 → 244.0
        lon_lo = SD_LON_MIN % 360
        lon_hi = SD_LON_MAX % 360
    else:
        lon_lo, lon_hi = SD_LON_MIN, SD_LON_MAX

    # Satellite CDRs often store latitude descending (90 → −90)
    lat_vals = ds["lat"].values
    lat_slice = (
        slice(SD_LAT_MAX, SD_LAT_MIN) if lat_vals[0] > lat_vals[-1]
        else slice(SD_LAT_MIN, SD_LAT_MAX)
    )

    return ds.sel(lat=lat_slice, lon=slice(lon_lo, lon_hi))


def box_mean(sd: xr.Dataset, var: str) -> float | None:
    """Spatial nanmean over the SD box for one variable; None if all NaN."""
    if var not in sd:
        return None
    arr  = sd[var].values.astype(np.float64)
    mean = np.nanmean(arr)
    return float(mean) if np.isfinite(mean) else None


# ── Monthly aggregation ───────────────────────────────────────────────

def process_month(year: int, month: int, pattern: str) -> dict | None:
    """
    Stream all daily files for one year-month, return a dict of monthly
    spatial means for LAI and FAPAR. Returns None if no valid days found.
    """
    start = date(year, month, 1)
    end   = (
        date(year, month + 1, 1) if month < 12
        else date(year + 1, 1, 1)
    ) - timedelta(days=1)

    lai_vals:   list[float] = []
    fapar_vals: list[float] = []

    d = start
    while d <= end:
        sd = stream_sd_slice(build_path(d.year, d.month, d.day, pattern))
        if sd is not None:
            lai   = box_mean(sd, "LAI")
            fapar = box_mean(sd, "FAPAR")
            if lai   is not None: lai_vals.append(lai)
            if fapar is not None: fapar_vals.append(fapar)
        d += timedelta(days=1)

    if not lai_vals and not fapar_vals:
        return None

    return {
        "year":       year,
        "month":      month,
        "lai_mean":   float(np.nanmean(lai_vals))   if lai_vals   else np.nan,
        "fapar_mean": float(np.nanmean(fapar_vals)) if fapar_vals else np.nan,
        "n_days":     max(len(lai_vals), len(fapar_vals)),
    }


# ── Main ──────────────────────────────────────────────────────────────

def main(test_mode: bool = False) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    year_range = (
        range(START_YEAR, START_YEAR + 1) if test_mode
        else range(START_YEAR, END_YEAR + 1)
    )

    # Resume: load any rows already written in a previous run
    if OUT_PATH.exists():
        existing  = pd.read_csv(OUT_PATH)
        done_keys = set(zip(existing["year"], existing["month"]))
        records   = existing.to_dict("records")
        print(f"Resuming — {len(existing)} year-month rows already cached.")
    else:
        done_keys: set[tuple[int, int]] = set()
        records:   list[dict]           = []

    print(f"Connecting to gs://{BUCKET} (anonymous)...")
    get_fs()  # initialise once; confirms network access

    # Discover the filename pattern from the bucket
    print("Detecting filename pattern...")
    pattern = None
    for yr in range(START_YEAR, START_YEAR + 5):
        pattern = discover_pattern(yr)
        if pattern:
            print(f"  Found: {pattern}  (year {yr})")
            break
    if pattern is None:
        sys.exit(
            "Could not list files from bucket. "
            "Check bucket name and network connectivity."
        )

    print(
        f"\nExtracting SD box  lat {SD_LAT_MIN}–{SD_LAT_MAX},  "
        f"lon {SD_LON_MIN}–{SD_LON_MAX}\n"
    )

    for year in year_range:
        for month in range(1, 13):
            if (year, month) in done_keys:
                continue

            row = process_month(year, month, pattern)
            if row:
                records.append(row)
                done_keys.add((year, month))
                print(
                    f"  {year}-{month:02d}  "
                    f"LAI={row['lai_mean']:.3f}  "
                    f"FAPAR={row['fapar_mean']:.3f}  "
                    f"({row['n_days']} days)"
                )
            else:
                print(f"  {year}-{month:02d}  no data")

            # Save after every month — safe to Ctrl-C and resume
            pd.DataFrame(records).to_csv(OUT_PATH, index=False)

    df = pd.read_csv(OUT_PATH)
    print(f"\nWrote {len(df)} monthly rows to {OUT_PATH}")

    months = ["Jan","Feb","Mar","Apr","May","Jun",
              "Jul","Aug","Sep","Oct","Nov","Dec"]
    avg = (
        df.groupby("month", as_index=False)
        .agg(lai_mean=("lai_mean", "mean"), fapar_mean=("fapar_mean", "mean"))
    )
    print(f"\nMonthly climatology ({START_YEAR}–{END_YEAR if not test_mode else START_YEAR}):")
    print(f"  {'Month':<6}  {'LAI':>8}  {'FAPAR':>8}")
    for _, row in avg.iterrows():
        print(f"  {months[int(row.month)-1]:<6}  {row.lai_mean:>8.3f}  {row.fapar_mean:>8.3f}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Extract NOAA CDR LAI/FAPAR monthly means for San Diego."
    )
    parser.add_argument(
        "--test", action="store_true",
        help="Run only 1982 to verify bucket access and output format.",
    )
    main(test_mode=parser.parse_args().test)
