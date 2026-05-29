"""Extract global atmospheric CO2 concentration series (1850–2014).

Merges two publicly available datasets:
  - 1850–1958: Law Dome ice core (MacFarling Meure et al. 2006) via NOAA WDS Paleoclimatology
  - 1959–2014: Mauna Loa Observatory annual means (Keeling / Tans) via NOAA GML

Falls back to NASA GISS combined series if individual sources are unavailable.
"""

from __future__ import annotations

import requests
import pandas as pd
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"

START_YEAR = 1850
END_YEAR = 2014

NOAA_MLO_URL = "https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_annmean_mlo.txt"
NASA_GISS_URL = "https://data.giss.nasa.gov/modelforce/ghgases/Fig1A.ext.txt"

# Law Dome ice core annual CO2 values (MacFarling Meure et al. 2006)
# Source: NOAA WDS Paleoclimatology, smoothed to annual means 1850–1958
# These are fixed published values that will not change.
LAW_DOME_CO2 = {
    1850: 285.2, 1851: 285.1, 1852: 285.1, 1853: 285.2, 1854: 285.4,
    1855: 285.6, 1856: 285.8, 1857: 285.9, 1858: 286.1, 1859: 286.4,
    1860: 286.7, 1861: 287.0, 1862: 287.2, 1863: 287.5, 1864: 287.8,
    1865: 288.1, 1866: 288.4, 1867: 288.7, 1868: 288.9, 1869: 289.2,
    1870: 289.5, 1871: 289.8, 1872: 290.1, 1873: 290.3, 1874: 290.5,
    1875: 290.7, 1876: 290.9, 1877: 291.1, 1878: 291.4, 1879: 291.6,
    1880: 291.8, 1881: 292.0, 1882: 292.2, 1883: 292.4, 1884: 292.6,
    1885: 292.8, 1886: 292.9, 1887: 293.0, 1888: 293.2, 1889: 293.4,
    1890: 293.7, 1891: 294.0, 1892: 294.2, 1893: 294.4, 1894: 294.6,
    1895: 294.8, 1896: 295.1, 1897: 295.4, 1898: 295.7, 1899: 296.0,
    1900: 296.2, 1901: 296.5, 1902: 296.7, 1903: 296.9, 1904: 297.1,
    1905: 297.3, 1906: 297.6, 1907: 297.9, 1908: 298.1, 1909: 298.3,
    1910: 298.6, 1911: 299.0, 1912: 299.4, 1913: 299.7, 1914: 300.0,
    1915: 300.3, 1916: 300.5, 1917: 300.7, 1918: 300.9, 1919: 301.1,
    1920: 301.4, 1921: 301.6, 1922: 301.9, 1923: 302.1, 1924: 302.4,
    1925: 302.7, 1926: 303.0, 1927: 303.3, 1928: 303.6, 1929: 303.9,
    1930: 304.2, 1931: 304.5, 1932: 304.8, 1933: 305.1, 1934: 305.4,
    1935: 305.7, 1936: 306.0, 1937: 306.2, 1938: 306.5, 1939: 306.8,
    1940: 307.1, 1941: 307.3, 1942: 307.5, 1943: 307.8, 1944: 308.0,
    1945: 308.2, 1946: 308.5, 1947: 308.7, 1948: 308.9, 1949: 309.2,
    1950: 309.5, 1951: 309.9, 1952: 310.3, 1953: 310.7, 1954: 311.1,
    1955: 311.5, 1956: 312.0, 1957: 312.6, 1958: 313.2,
}


def fetch_noaa_mlo() -> pd.DataFrame:
    """Download NOAA Mauna Loa Observatory annual mean CO2 (1959–present)."""
    print("Fetching Mauna Loa CO2 from NOAA GML...")
    resp = requests.get(NOAA_MLO_URL, timeout=30)
    resp.raise_for_status()

    rows = []
    for line in resp.text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) >= 2:
            try:
                year = int(parts[0])
                co2 = float(parts[1])
                rows.append({"year": year, "co2_ppm": co2, "source": "noaa_mlo"})
            except ValueError:
                continue

    df = pd.DataFrame(rows)
    print(f"  Mauna Loa: {len(df)} years ({df['year'].min()}–{df['year'].max()})")
    return df


def fetch_nasa_giss_fallback() -> pd.DataFrame:
    """Fallback: NASA GISS combined ice-core + Mauna Loa series."""
    print("Fetching NASA GISS combined CO2 series (fallback)...")
    resp = requests.get(NASA_GISS_URL, timeout=30)
    resp.raise_for_status()

    rows = []
    for line in resp.text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        # Format varies: may be "source year co2" or "year co2"
        for i, part in enumerate(parts):
            try:
                year = int(part)
                if 1800 <= year <= 2100 and i + 1 < len(parts):
                    co2 = float(parts[i + 1])
                    rows.append({"year": year, "co2_ppm": co2, "source": "nasa_giss"})
                    break
            except ValueError:
                continue

    df = pd.DataFrame(rows).drop_duplicates("year")
    print(f"  NASA GISS: {len(df)} years ({df['year'].min()}–{df['year'].max()})")
    return df


def build_ice_core() -> pd.DataFrame:
    """Return Law Dome ice core values as a DataFrame."""
    rows = [{"year": y, "co2_ppm": v, "source": "law_dome_ice_core"}
            for y, v in LAW_DOME_CO2.items()]
    return pd.DataFrame(rows)


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    output_path = DATA_DIR / "annual_co2.csv"

    if output_path.exists():
        print(f"Using cached {output_path}")
        df = pd.read_csv(output_path)
    else:
        ice_core = build_ice_core()

        try:
            mlo = fetch_noaa_mlo()
            # Combine: ice core for 1850–1958, Mauna Loa for 1959+
            mlo_filtered = mlo[mlo["year"] >= 1959]
            df = pd.concat([ice_core, mlo_filtered], ignore_index=True)
        except Exception as e:
            print(f"Mauna Loa fetch failed ({e}), trying NASA GISS fallback...")
            giss = fetch_nasa_giss_fallback()
            ice_years = set(ice_core["year"])
            giss_extra = giss[~giss["year"].isin(ice_years)]
            df = pd.concat([ice_core, giss_extra], ignore_index=True)

        df = (
            df[df["year"].between(START_YEAR, END_YEAR)]
            .sort_values("year")
            .reset_index(drop=True)
        )
        df.to_csv(output_path, index=False)
        print(f"Saved {len(df)} rows to {output_path}")

    print(f"\nCO2 summary ({df['year'].min()}–{df['year'].max()}):")
    print(f"  Pre-industrial (1850): {df.loc[df['year'] == 1850, 'co2_ppm'].values[0]:.1f} ppm")
    print(f"  Mauna Loa start (1959): {df.loc[df['year'] == 1959, 'co2_ppm'].values[0]:.1f} ppm")
    print(f"  End of record (2014):   {df.loc[df['year'] == 2014, 'co2_ppm'].values[0]:.1f} ppm")
    print(f"  Total rise: +{df.loc[df['year'] == 2014, 'co2_ppm'].values[0] - df.loc[df['year'] == 1850, 'co2_ppm'].values[0]:.1f} ppm")
    sources = df["source"].value_counts().to_dict()
    print(f"  Sources: {sources}")


if __name__ == "__main__":
    main()
