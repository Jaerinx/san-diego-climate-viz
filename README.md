# San Diego Climate — CMIP6 Exploratory Charts (D3)

Website: https://jaerinx.github.io/san-diego-climate-viz/

Five static D3.js visualizations for [DSC 106 Project 3](https://dsc106.com/projects/project3/) checkpoint exploration, using **NOAA Public CMIP6** historical simulations ([Google Cloud Marketplace](https://console.cloud.google.com/marketplace/product/noaa-public/cmip6)).

## Setup

```bash
pip install xarray zarr gcsfs cftime pandas
python scripts/extract_cmip6.py
```

The extraction script follows the [DSC106 CMIP6 colab notebook](https://github.com/dsc-courses/dsc106-2025-fa/blob/main/lectures/climate-lecture/CMIP%20basic_search_and_load-colab.ipynb): it queries the [public zarr catalog CSV](https://storage.googleapis.com/cmip6/cmip6-zarr-consolidated-stores.csv), opens GFDL-ESM4 historical monthly `tas`, `pr`, and ocean `zos` with anonymous `gcsfs`, and builds San Diego County population density from U.S. Census decennial counts. Cached downloads: `data/monthly_raw.csv`, `data/zos_monthly_raw.csv`.

## View charts

Serve the folder locally (required for `fetch` to load CSVs):

```bash
python -m http.server 8080
```

Open http://localhost:8080

## Charts

1. Annual mean temperature with 5-year moving average  
2. Temperature anomaly vs. 1961–1990 baseline  
3. Modeled sea surface height anomaly (CMIP6 `zos`)  
4. Annual precipitation totals  
5. San Diego County population density (U.S. Census)  

## Data note

CMIP6 provides **climate model output**, not direct observations from San Diego weather stations. Values represent modeled historical climate for the nearest ~1° grid cell.
