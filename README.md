# San Diego's Seasonal Climate, 1925–now–2100

An interactive explorable explanation for [DSC 106 Final Project](https://dsc106.com/projects/final_project/). Explore a century of modeled San Diego weather, set your outdoor preferences, choose an emissions scenario, and see how the seasons your great-grandchildren might inherit compare to today.

**Team:** D3Cat — Calvin Chen, Hieu Nguyen, Moniriddh Bunyay, Palina Volskaya

**Live site:** https://jaerinx.github.io/san-diego-climate-viz/

**Demo video:**  *(replace with your public YouTube link)*

**Repository:** https://github.com/Jaerinx/san-diego-climate-viz

## About the project

This is a six-step narrative built with D3.js:

1. **Intro** — stakes and overview (1925 · now · 2100)
2. **Preferences** — ideal temperature, rain tolerance, and sunniness shape personalized activity recommendations
3. **Today** — morphing seasonal curves for temperature, precipitation, and cloud cover (1925–2014), plus a two-era activity calendar
4. **Scenarios** — choose among four CMIP6 SSP pathways (1-2.6 through 5-8.5)
5. **Your Future** — projected 2091–2100 climate and local consequences for the chosen scenario
6. **Big Picture** — all scenarios compared, monthly warming heatmap, and key takeaways

Historical data comes from GFDL-ESM4 CMIP6 historical runs; future projections use the same model under ScenarioMIP SSPs. Values represent **climate model output** for the nearest ~1° grid cell to San Diego, not direct weather-station observations.

## Visualizations and interactions

- **Seasonal curve charts** — year slider and play controls morph monthly temp, precip, and cloud cover; click a month on the temperature chart for a per-month trend panel
- **Activity calendar** — month-by-month outdoor recommendations (beach, hiking, indoors, fire risk, storm risk) driven by user preferences
- **Scenario selector** — pick a future emissions path and view personalized future activity and climate charts
- **Future comparison** — dashed present-day baseline vs. solid projected curves with variability bands
- **Consequence cards** — beach loss, kelp, flooding, and wildfire severity by scenario
- **All-scenarios overview** — overlaid temperature curves and a warming heatmap by month and scenario
- **Unit toggle** — switch temperature display between °C and °F

## Setup

Data CSVs are committed in `data/`, so the site works out of the box on GitHub Pages. Re-run the extraction scripts only if you need to refresh downloads from NOAA CMIP6 on Google Cloud.

```bash
pip install xarray zarr gcsfs cftime pandas numpy
```

| Script | Purpose | Main outputs |
|--------|---------|--------------|
| `scripts/extract_cmip6.py` | Historical monthly temperature and precipitation | `data/monthly_by_year.csv`, `data/monthly_raw.csv`, … |
| `scripts/extract_cloud.py` | Historical cloud fraction | `data/monthly_cloud.csv`, `data/monthly_cloud_avg.csv` |
| `scripts/extract_ssp.py` | SSP future scenario climatologies | `data/ssp_monthly_climatology.csv` |

Extraction follows the [DSC 106 CMIP6 colab notebook](https://github.com/dsc-courses/dsc106-2025-fa/blob/main/lectures/climate-lecture/CMIP%20basic_search_and_load-colab.ipynb): query the [public zarr catalog](https://storage.googleapis.com/cmip6/cmip6-zarr-consolidated-stores.csv), open GFDL-ESM4 `r1i1p1f1` with anonymous `gcsfs`.

Run scripts from the repo root:

```bash
python scripts/extract_cmip6.py
python scripts/extract_cloud.py
python scripts/extract_ssp.py
```

## Run locally

CSV loading requires a local web server (opening `index.html` directly via `file://` will not work):

```bash
python -m http.server 8080
```

Open http://localhost:8080

## Project structure

```
index.html          # Explorable explanation (six pages)
js/charts.js        # D3 visualizations and interactions
css/style.css       # Layout and styling
data/               # Processed CSVs consumed by the site
scripts/            # Python extraction scripts
```

## Data sources

- **Historical & future climate:** [NOAA Public CMIP6 on Google Cloud](https://console.cloud.google.com/marketplace/product/noaa-public/cmip6) — GFDL-ESM4 historical and ScenarioMIP (SSP 1-2.6, 2-4.5, 3-7.0, 5-8.5)
- **Variables:** `tas` (temperature), `pr` (precipitation), `clt` (cloud fraction)
- **Present baseline:** 2005–2014 mean; **future window:** 2091–2100 mean
- **Course context:** extends the dataset lineage from [DSC 106 Project 3](https://dsc106.com/projects/project3/)

CMIP6 values are model simulations. Population and sea-level auxiliary files in `data/` were produced during earlier project milestones and may be used for future chart extensions.
