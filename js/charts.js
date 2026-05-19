/* Five static D3 visualizations — San Diego CMIP6 historical climate (1925–2014) */

const margin = { top: 28, right: 24, bottom: 44, left: 56 };
const width = 900;
const height = 340;
const innerW = width - margin.left - margin.right;
const innerH = height - margin.top - margin.bottom;

function baseSvg(container, title) {
  return d3.select(container)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr("aria-label", title)
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);
}

function addAxes(g, xScale, yScale, xLabel, yLabel) {
  g.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${innerH})`)
    .call(d3.axisBottom(xScale).ticks(8))
    .append("text")
    .attr("class", "axis-label")
    .attr("x", innerW / 2)
    .attr("y", 36)
    .attr("fill", "currentColor")
    .attr("text-anchor", "middle")
    .text(xLabel);

  g.append("g")
    .attr("class", "axis")
    .call(d3.axisLeft(yScale))
    .append("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -innerH / 2)
    .attr("y", -44)
    .attr("fill", "currentColor")
    .attr("text-anchor", "middle")
    .text(yLabel);
}

function addGrid(g, yScale) {
  g.append("g")
    .attr("class", "grid")
    .call(
      d3.axisLeft(yScale)
        .tickSize(-innerW)
        .tickFormat("")
    )
    .lower();
}

/* 1. Annual mean temperature trend */
function chartAnnualTemperature(data) {
  const g = baseSvg("#chart-annual-temp", "Annual mean near-surface temperature near San Diego, 1925–2014");

  const x = d3.scaleLinear()
    .domain(d3.extent(data, (d) => d.year))
    .range([0, innerW]);

  const y = d3.scaleLinear()
    .domain(d3.extent(data, (d) => d.mean_temp_c).map((v, i) => v + (i === 0 ? -0.4 : 0.4)))
    .nice()
    .range([innerH, 0]);

  addGrid(g, y);
  addAxes(g, x, y, "Year", "Mean temperature (°C)");

  const line = d3.line()
    .x((d) => x(d.year))
    .y((d) => y(d.mean_temp_c));

  const rolling = data.map((_, i, arr) => {
    const start = Math.max(0, i - 4);
    const slice = arr.slice(start, i + 1);
    const mean = d3.mean(slice, (d) => d.mean_temp_c);
    return { year: arr[i].year, rolling: mean };
  });

  g.append("path")
    .datum(data)
    .attr("fill", "none")
    .attr("stroke", "#9bb3c9")
    .attr("stroke-width", 1.5)
    .attr("d", line);

  g.append("path")
    .datum(rolling)
    .attr("fill", "none")
    .attr("stroke", "#0b6e99")
    .attr("stroke-width", 2.5)
    .attr("d", d3.line().x((d) => x(d.year)).y((d) => y(d.rolling)));

  g.selectAll("circle")
    .data(data.filter((_, i) => i % 5 === 0))
    .join("circle")
    .attr("cx", (d) => x(d.year))
    .attr("cy", (d) => y(d.mean_temp_c))
    .attr("r", 3)
    .attr("fill", "#0b6e99")
    .attr("opacity", 0.75);

  g.append("text")
    .attr("x", innerW)
    .attr("y", 12)
    .attr("text-anchor", "end")
    .attr("fill", "#5c6b7a")
    .attr("font-size", 11)
    .text("Blue line: 5-year moving average");
}

/* 2. Temperature anomaly from 1961–1990 baseline */
function chartTemperatureAnomaly(data) {
  const g = baseSvg("#chart-anomaly", "Annual temperature anomaly relative to 1961–1990 baseline");

  const x = d3.scaleLinear()
    .domain(d3.extent(data, (d) => d.year))
    .range([0, innerW]);

  const maxAbs = d3.max(data, (d) => Math.abs(d.temp_anomaly_c));
  const y = d3.scaleLinear()
    .domain([-maxAbs * 1.1, maxAbs * 1.1])
    .range([innerH, 0]);

  addGrid(g, y);
  addAxes(g, x, y, "Year", "Anomaly (°C)");

  g.append("line")
    .attr("x1", 0)
    .attr("x2", innerW)
    .attr("y1", y(0))
    .attr("y2", y(0))
    .attr("stroke", "#1a2332")
    .attr("stroke-dasharray", "4 4");

  g.selectAll("rect.bar")
    .data(data)
    .join("rect")
    .attr("class", "bar")
    .attr("x", (d) => x(d.year) - 3)
    .attr("width", 6)
    .attr("y", (d) => (d.temp_anomaly_c >= 0 ? y(d.temp_anomaly_c) : y(0)))
    .attr("height", (d) => Math.abs(y(d.temp_anomaly_c) - y(0)))
    .attr("fill", (d) => (d.temp_anomaly_c >= 0 ? "#c44e52" : "#2a7f62"));
}

/* 3. Modeled sea surface height anomaly (CMIP6 zos) */
function chartSeaLevel(data) {
  const g = baseSvg("#chart-sea-level", "Annual sea surface height anomaly near San Diego coast, 1925–2014");

  const x = d3.scaleLinear()
    .domain(d3.extent(data, (d) => d.year))
    .range([0, innerW]);

  const maxAbs = d3.max(data, (d) => Math.abs(d.zos_anomaly_mm));
  const y = d3.scaleLinear()
    .domain([-maxAbs * 1.15, maxAbs * 1.15])
    .range([innerH, 0]);

  addGrid(g, y);
  addAxes(g, x, y, "Year", "Anomaly vs 1961–1990 (mm)");

  g.append("line")
    .attr("x1", 0)
    .attr("x2", innerW)
    .attr("y1", y(0))
    .attr("y2", y(0))
    .attr("stroke", "#1a2332")
    .attr("stroke-dasharray", "4 4");

  const line = d3.line()
    .x((d) => x(d.year))
    .y((d) => y(d.zos_anomaly_mm));

  const rolling = data.map((_, i, arr) => {
    const start = Math.max(0, i - 4);
    const slice = arr.slice(start, i + 1);
    return {
      year: arr[i].year,
      rolling: d3.mean(slice, (d) => d.zos_anomaly_mm),
    };
  });

  g.append("path")
    .datum(data)
    .attr("fill", "none")
    .attr("stroke", "#9bb3c9")
    .attr("stroke-width", 1.5)
    .attr("d", line);

  g.append("path")
    .datum(rolling)
    .attr("fill", "none")
    .attr("stroke", "#1a5f7a")
    .attr("stroke-width", 2.5)
    .attr("d", d3.line().x((d) => x(d.year)).y((d) => y(d.rolling)));

  g.append("text")
    .attr("x", innerW)
    .attr("y", 12)
    .attr("text-anchor", "end")
    .attr("fill", "#5c6b7a")
    .attr("font-size", 11)
    .text("Teal: 5-year moving average");
}

/* 4. Annual precipitation */
function chartPrecipitation(data) {
  const g = baseSvg("#chart-precip", "Modeled annual precipitation near San Diego");

  const x = d3.scaleBand()
    .domain(data.map((d) => d.year))
    .range([0, innerW])
    .padding(0.08);

  const y = d3.scaleLinear()
    .domain([0, d3.max(data, (d) => d.total_precip_mm) * 1.05])
    .range([innerH, 0]);

  addGrid(g, y);

  g.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${innerH})`)
    .call(d3.axisBottom(x).tickValues(x.domain().filter((y) => y % 10 === 0)))
    .append("text")
    .attr("class", "axis-label")
    .attr("x", innerW / 2)
    .attr("y", 36)
    .attr("fill", "currentColor")
    .attr("text-anchor", "middle")
    .text("Year");

  g.append("g")
    .attr("class", "axis")
    .call(d3.axisLeft(y))
    .append("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -innerH / 2)
    .attr("y", -44)
    .attr("fill", "currentColor")
    .attr("text-anchor", "middle")
    .text("Annual total (mm)");

  const baseline = data[0]?.precip_baseline_mm ?? d3.mean(data, (d) => d.total_precip_mm);

  g.append("line")
    .attr("x1", 0)
    .attr("x2", innerW)
    .attr("y1", y(baseline))
    .attr("y2", y(baseline))
    .attr("stroke", "#c44e52")
    .attr("stroke-dasharray", "5 4");

  g.selectAll("rect")
    .data(data)
    .join("rect")
    .attr("x", (d) => x(d.year))
    .attr("width", x.bandwidth())
    .attr("y", (d) => y(d.total_precip_mm))
    .attr("height", (d) => innerH - y(d.total_precip_mm))
    .attr("fill", (d) => (d.total_precip_mm >= baseline ? "#4a90a4" : "#7ba38c"));
}

/* 5. San Diego County population density (U.S. Census) */
function chartPopulationDensity(annual, census) {
  const g = baseSvg("#chart-population", "San Diego County population density, 1925–2014");

  const x = d3.scaleLinear()
    .domain([START_YEAR, END_YEAR])
    .range([0, innerW]);

  const y = d3.scaleLinear()
    .domain([0, d3.max(annual, (d) => d.density_per_sq_mi) * 1.08])
    .nice()
    .range([innerH, 0]);

  addGrid(g, y);
  addAxes(g, x, y, "Year", "People per square mile");

  const area = d3.area()
    .x((d) => x(d.year))
    .y0(innerH)
    .y1((d) => y(d.density_per_sq_mi));

  g.append("path")
    .datum(annual)
    .attr("fill", "#4a90a4")
    .attr("fill-opacity", 0.35)
    .attr("stroke", "#1a5f7a")
    .attr("stroke-width", 2)
    .attr("d", area);

  g.selectAll("circle.census")
    .data(census)
    .join("circle")
    .attr("class", "census")
    .attr("cx", (d) => x(d.year))
    .attr("cy", (d) => y(d.density_per_sq_mi))
    .attr("r", 5)
    .attr("fill", "#c44e52")
    .attr("stroke", "#fff")
    .attr("stroke-width", 1.5);

  g.append("text")
    .attr("x", innerW)
    .attr("y", 12)
    .attr("text-anchor", "end")
    .attr("fill", "#5c6b7a")
    .attr("font-size", 11)
    .text("Red dots: U.S. Census years");
}

const START_YEAR = 1925;
const END_YEAR = 2014;

async function init() {
  const [annual, anomalies, seaLevel, popAnnual, popCensus, meta] = await Promise.all([
    d3.csv("data/annual_climate.csv", d3.autoType),
    d3.csv("data/annual_anomalies.csv", d3.autoType),
    d3.csv("data/annual_sea_level.csv", d3.autoType),
    d3.csv("data/annual_population_density.csv", d3.autoType),
    d3.csv("data/census_population.csv", d3.autoType),
    d3.json("data/metadata.json"),
  ]);

  if (meta) {
    const zosGrid =
      meta.zos_grid_lat != null
        ? ` · Ocean (zos): ${meta.zos_grid_lat.toFixed(2)}°N, ${meta.zos_grid_lon.toFixed(2)}°`
        : "";
    d3.select("#meta-grid").text(
      `CMIP6 atmosphere grid: ${meta.grid_lat.toFixed(2)}°N, ${meta.grid_lon.toFixed(2)}°${zosGrid} · ${meta.period}`
    );
    d3.select("#meta-source").text(meta.source);
  }

  chartAnnualTemperature(annual);
  chartTemperatureAnomaly(anomalies);
  chartSeaLevel(seaLevel);
  chartPrecipitation(anomalies);
  chartPopulationDensity(popAnnual, popCensus);
}

init().catch((err) => {
  console.error(err);
  document.querySelector("main").innerHTML =
    `<p style="color:#c44e52">Failed to load data. Run <code>python scripts/extract_cmip6.py</code> first.</p>`;
});
