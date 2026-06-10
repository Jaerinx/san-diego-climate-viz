from __future__ import annotations

import calendar
import json
from pathlib import Path

import gcsfs
import numpy as np
import pandas as pd
import xarray as xr

# San Diego approximate coordinates (notebook uses lon = 360 - 117.1611)
SAN_DIEGO_LAT = 32.7157
SAN_DIEGO_LON = 360 - 117.1611

START_YEAR = 1925
END_YEAR = 2014
BASELINE_START = 1961
BASELINE_END = 1990

CATALOG_CSV = "https://storage.googleapis.com/cmip6/cmip6-zarr-consolidated-stores.csv"
SOURCE_ID = "GFDL-ESM4"
INSTITUTION_ID = "NOAA-GFDL"
MEMBER_ID = "r1i1p1f1"

ROOT = Path(__file__).resolve().parents[1]
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
        _catalog = pd.read_csv(CATALOG_CSV)
    return _catalog


def find_zstore(variable_id: str, table_id: str = "Amon", grid_label: str | None = None) -> str:
    df = get_catalog()
    match = df[
        (df["activity_id"] == "CMIP")
        & (df["table_id"] == table_id)
        & (df["variable_id"] == variable_id)
        & (df["experiment_id"] == "historical")
        & (df["source_id"] == SOURCE_ID)
        & (df["institution_id"] == INSTITUTION_ID)
        & (df["member_id"] == MEMBER_ID)
    ]
    if grid_label is not None:
        match = match[match["grid_label"] == grid_label]
    if match.empty:
        raise RuntimeError(f"No zarr store found for {variable_id} ({table_id})")
    return str(match.iloc[0]["zstore"])


def load_point_series(
    variable_id: str,
    table_id: str = "Amon",
    grid_label: str | None = None,
) -> tuple[xr.DataArray, float, float]:
    zstore = find_zstore(variable_id, table_id=table_id, grid_label=grid_label)
    ds = xr.open_zarr(get_gcs().get_mapper(zstore), consolidated=True)
    series = (
        ds[variable_id]
        .sel(lon=SAN_DIEGO_LON, lat=SAN_DIEGO_LAT, method="nearest")
        .load()
        .squeeze(drop=True)
    )
    lat_actual = float(series["lat"].values)
    lon_actual = float(series["lon"].values)
    return series, lat_actual, lon_actual


def kelvin_to_c(values: np.ndarray) -> np.ndarray:
    return values - 273.15


def kg_m2_s_to_mm_month(values: np.ndarray, days_in_month: np.ndarray) -> np.ndarray:
    # pr flux (kg m-2 s-1) * seconds/day * days -> kg m-2 ~ mm
    seconds_per_day = 86400
    return values * seconds_per_day * days_in_month


# U.S. Census decennial county population; land area from 2010 Census county gazetteer
SAN_DIEGO_COUNTY_LAND_SQ_MI = 4207
CENSUS_POPULATION = {
    1920: 112_248,
    1930: 295_341,
    1940: 435_573,
    1950: 556_202,
    1960: 1_033_011,
    1970: 1_357_854,
    1980: 1_861_272,
    1990: 2_498_016,
    2000: 2_813_833,
    2010: 3_095_313,
}


def build_sea_level_series() -> tuple[pd.DataFrame, float, float]:
    zos_cache = DATA_DIR / "zos_monthly_raw.csv"
    if zos_cache.exists():
        zos_df = pd.read_csv(zos_cache)
        lat_actual = float(zos_df["lat"].iloc[0])
        lon_actual = float(zos_df["lon"].iloc[0])
    else:
        print("Loading CMIP6 sea surface height (zos) from ocean grid...")
        zos, lat_actual, lon_actual = load_point_series("zos", table_id="Omon", grid_label="gr")
        zos_df = zos.to_dataframe(name="zos_m").reset_index()
        zos_df["year"] = zos_df["time"].map(lambda t: int(t.year))
        zos_df["month"] = zos_df["time"].map(lambda t: int(t.month))
        zos_df["lat"] = lat_actual
        zos_df["lon"] = lon_actual
        zos_df.drop(columns=["time"]).to_csv(zos_cache, index=False)

    zos_df = zos_df[(zos_df["year"] >= START_YEAR) & (zos_df["year"] <= END_YEAR)]
    annual = (
        zos_df.groupby("year", as_index=False)
        .agg(mean_zos_m=("zos_m", "mean"))
        .sort_values("year")
    )
    baseline = annual[
        (annual["year"] >= BASELINE_START) & (annual["year"] <= BASELINE_END)
    ]
    zos_base = baseline["mean_zos_m"].mean()
    annual["zos_baseline_m"] = zos_base
    annual["zos_anomaly_mm"] = (annual["mean_zos_m"] - zos_base) * 1000
    annual.to_csv(DATA_DIR / "annual_sea_level.csv", index=False)
    return annual, lat_actual, lon_actual


def build_population_density() -> pd.DataFrame:
    census = pd.DataFrame(
        {
            "year": list(CENSUS_POPULATION.keys()),
            "population": list(CENSUS_POPULATION.values()),
        }
    )
    census["density_per_sq_mi"] = census["population"] / SAN_DIEGO_COUNTY_LAND_SQ_MI
    census["is_census_year"] = True
    census.to_csv(DATA_DIR / "census_population.csv", index=False)

    years = np.arange(START_YEAR, END_YEAR + 1)
    density = np.interp(years, census["year"], census["density_per_sq_mi"])
    annual = pd.DataFrame(
        {
            "year": years,
            "density_per_sq_mi": density,
            "is_census_year": np.isin(years, census["year"].to_numpy()),
        }
    )
    annual.to_csv(DATA_DIR / "annual_population_density.csv", index=False)
    return annual


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    raw_cache = DATA_DIR / "monthly_raw.csv"
    if raw_cache.exists():
        merged = pd.read_csv(raw_cache)
        meta_defaults = (
            json.loads((DATA_DIR / "metadata.json").read_text(encoding="utf-8"))
            if (DATA_DIR / "metadata.json").exists()
            else {}
        )
        lat_actual = meta_defaults.get("grid_lat", SAN_DIEGO_LAT)
        lon_actual = meta_defaults.get("grid_lon", SAN_DIEGO_LON)
    else:
        print("Loading CMIP6 catalog and opening zarr stores (anonymous GCS)...")
        tas, lat_actual, lon_actual = load_point_series("tas")
        pr, _, _ = load_point_series("pr")
        tas_df = tas.to_dataframe(name="tas_k").reset_index()
        pr_df = pr.to_dataframe(name="pr_flux").reset_index()
        merged = pd.merge(tas_df, pr_df, on="time", how="inner")
        merged["year"] = merged["time"].map(lambda t: int(t.year))
        merged["month"] = merged["time"].map(lambda t: int(t.month))
        merged.drop(columns=["time"]).to_csv(raw_cache, index=False)
        merged = pd.read_csv(raw_cache)

    merged = merged[(merged["year"] >= START_YEAR) & (merged["year"] <= END_YEAR)].copy()

    merged["tas_c"] = kelvin_to_c(merged["tas_k"].to_numpy())
    days = merged["month"].map(lambda m: calendar.monthrange(2000, int(m))[1]).to_numpy()
    merged["pr_mm"] = kg_m2_s_to_mm_month(merged["pr_flux"].to_numpy(), days)

    annual = (
        merged.groupby("year", as_index=False)
        .agg(
            mean_temp_c=("tas_c", "mean"),
            total_precip_mm=("pr_mm", "sum"),
        )
        .sort_values("year")
    )
    annual.to_csv(DATA_DIR / "annual_climate.csv", index=False)

    baseline = annual[
        (annual["year"] >= BASELINE_START) & (annual["year"] <= BASELINE_END)
    ]
    temp_base = baseline["mean_temp_c"].mean()
    precip_base = baseline["total_precip_mm"].mean()

    annual["temp_anomaly_c"] = annual["mean_temp_c"] - temp_base
    annual["precip_anomaly_mm"] = annual["total_precip_mm"] - precip_base
    annual["temp_baseline_c"] = temp_base
    annual["precip_baseline_mm"] = precip_base
    annual.to_csv(DATA_DIR / "annual_anomalies.csv", index=False)

    monthly = (
        merged.groupby(["year", "month"], as_index=False)
        .agg(mean_temp_c=("tas_c", "mean"))
        .sort_values(["year", "month"])
    )
    merged["decade"] = (merged["year"] // 10) * 10
    decade_stats = (
        merged.groupby("decade", as_index=False)
        .agg(
            mean_temp_c=("tas_c", "mean"),
            total_precip_mm=("pr_mm", "sum"),
            temp_std_c=("tas_c", "std"),
        )
        .sort_values("decade")
    )
    decade_stats.to_csv(DATA_DIR / "decade_summary.csv", index=False)

    sea_level, zos_lat, zos_lon = build_sea_level_series()
    population = build_population_density()

    metadata = {
        "source": "NOAA Public CMIP6 on Google Cloud (GFDL-ESM4 historical, r1i1p1f1)",
        "catalog": CATALOG_CSV,
        "variables": {
            "tas": "Near-surface air temperature",
            "pr": "Precipitation flux",
            "zos": "Sea surface height (model ocean grid)",
        },
        "location_label": "San Diego region (nearest CMIP6 grid cell)",
        "grid_lat": lat_actual,
        "grid_lon": lon_actual,
        "zos_grid_lat": zos_lat,
        "zos_grid_lon": zos_lon,
        "period": f"{START_YEAR}-{END_YEAR}",
        "baseline_period": f"{BASELINE_START}-{BASELINE_END}",
        "population_source": "U.S. Census decennial county population (San Diego County, FIPS 06073)",
        "population_land_sq_mi": SAN_DIEGO_COUNTY_LAND_SQ_MI,
        "note": "CMIP6 values are model simulations. Population density uses census counts, not CMIP6.",
    }
    (DATA_DIR / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    print("Wrote CSV files to", DATA_DIR)
    print("Grid cell:", metadata["grid_lat"], metadata["grid_lon"])
    print(
        "Years:",
        len(annual),
        "Annual mean temp range:",
        round(annual["mean_temp_c"].min(), 2),
        "-",
        round(annual["mean_temp_c"].max(), 2),
        "°C",
    )
    print(
        "Sea level anomaly range (mm):",
        round(sea_level["zos_anomaly_mm"].min(), 1),
        "-",
        round(sea_level["zos_anomaly_mm"].max(), 1),
    )
    print(
        "Population density:",
        round(population["density_per_sq_mi"].iloc[0], 1),
        "-",
        round(population["density_per_sq_mi"].iloc[-1], 1),
        "per sq mi",
    )


if __name__ == "__main__":
    main()
