/* Five static D3 visualizations — San Diego CMIP6 historical climate (1925–2014) */

const margin = { top: 28, right: 24, bottom: 44, left: 56 };
const width = 900;
const height = 340;
const innerW = width - margin.left - margin.right;
const innerH = height - margin.top - margin.bottom;

// Shared highlight state (year-range) across all charts.
// Brush any chart to focus; click empty space to clear.
const highlightBus = d3.dispatch("highlight");
let activeYearRange = null; // [y0, y1] inclusive, integers

function clampYearRange(range) {
  if (!range) return null;
  const y0 = Math.min(range[0], range[1]);
  const y1 = Math.max(range[0], range[1]);
  // Keep continuous values so the brush window matches the user's drag.
  return [y0, y1];
}

function setYearHighlight(range, source) {
  activeYearRange = range ? clampYearRange(range) : null;
  highlightBus.call("highlight", null, { range: activeYearRange, source });
}

function addHighlightOverlays(g) {
  const overlay = g.append("g").attr("class", "highlight-overlays");
  const shadeLeft = overlay.append("rect").attr("class", "highlight-shade");
  const shadeRight = overlay.append("rect").attr("class", "highlight-shade");
  const windowRect = overlay.append("rect").attr("class", "highlight-window");

  function update(xScale, range) {
    if (!range) {
      shadeLeft.attr("width", 0);
      shadeRight.attr("width", 0);
      windowRect.attr("width", 0);
      return;
    }

    const x0 = xScale(range[0]);
    const x1 = xScale(range[1]);
    const left = Math.max(0, Math.min(x0, x1));
    const right = Math.min(innerW, Math.max(x0, x1));
    const w = Math.max(0, right - left);

    shadeLeft.attr("x", 0).attr("y", 0).attr("width", left).attr("height", innerH);
    shadeRight
      .attr("x", right)
      .attr("y", 0)
      .attr("width", Math.max(0, innerW - right))
      .attr("height", innerH);
    windowRect.attr("x", left).attr("y", 0).attr("width", w).attr("height", innerH);
  }

  return { update };
}

function addMinMaxLabels(g) {
  const layer = g.append("g").attr("class", "minmax-layer");
  const minG = layer.append("g").attr("class", "minmax min");
  const maxG = layer.append("g").attr("class", "minmax max");

  minG.append("circle").attr("r", 4).attr("class", "minmax-dot");
  minG.append("text").attr("class", "minmax-label").attr("dy", -8);

  maxG.append("circle").attr("r", 4).attr("class", "minmax-dot");
  maxG.append("text").attr("class", "minmax-label").attr("dy", -8);

  function hide() {
    minG.style("display", "none");
    maxG.style("display", "none");
  }

  function showOne(group, x, y, text, anchor = "middle") {
    group.style("display", null);
    group.attr("transform", `translate(${x},${y})`);
    group.select("text").attr("text-anchor", anchor).text(text);
  }

  return { hide, showOne, minG, maxG };
}

function minMaxInRange(data, range, getYear, getValue) {
  if (!range) return null;
  // Snap only for filtering points by whole-year data.
  let lo = Math.ceil(Math.min(range[0], range[1]));
  let hi = Math.floor(Math.max(range[0], range[1]));
  // If the selection is narrower than 1 year, snap to nearest year.
  if (lo > hi) {
    const snap = Math.round((range[0] + range[1]) / 2);
    lo = snap;
    hi = snap;
  }

  const filtered = data.filter((d) => {
    const y = getYear(d);
    const v = getValue(d);
    return Number.isFinite(y) && Number.isFinite(v) && y >= lo && y <= hi;
  });
  if (!filtered.length) return null;

  // Compute robust min/max points by explicit numeric comparisons.
  let minPoint = filtered[0];
  let maxPoint = filtered[0];
  for (let i = 1; i < filtered.length; i += 1) {
    const p = filtered[i];
    if (getValue(p) < getValue(minPoint)) minPoint = p;
    if (getValue(p) > getValue(maxPoint)) maxPoint = p;
  }
  return { minD: minPoint, maxD: maxPoint };
}

function addSharedBrush(g, xScale, source) {
  let syncing = false;
  const brush = d3.brushX()
    .extent([[0, 0], [innerW, innerH]])
    .on("end", (event) => {
      // Ignore programmatic brush moves triggered by cross-chart syncing.
      if (syncing) return;

      if (!event.selection) {
        setYearHighlight(null, source);
        return;
      }
      const [px0, px1] = event.selection;
      const y0 = xScale.invert(px0);
      const y1 = xScale.invert(px1);
      setYearHighlight([y0, y1], source);
    });

  const gb = g.append("g").attr("class", "brush").call(brush);

  // Double-click inside plot area clears highlight.
  // (Single click fires after a brush drag ends, which would clear immediately.)
  g.append("rect")
    .attr("class", "brush-click-catcher")
    .attr("x", 0)
    .attr("y", 0)
    .attr("width", innerW)
    .attr("height", innerH)
    .attr("fill", "transparent")
    .lower()
    .on("dblclick", () => setYearHighlight(null, source));

  // Sync brush position when highlight changes elsewhere.
  // IMPORTANT: d3-dispatch namespaces are `type.name` (single dot).
  // Use distinct names so we don't overwrite other listeners.
  highlightBus.on(`highlight.${source}BrushSync`, ({ range, source: src }) => {
    if (src === source) return;
    if (!range) {
      syncing = true;
      gb.call(brush.move, null);
      syncing = false;
      return;
    }
    syncing = true;
    gb.call(brush.move, [xScale(range[0]), xScale(range[1])]);
    syncing = false;
  });
}

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
    .attr("class", "annual-point")
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

  const overlays = addHighlightOverlays(g);
  const minmax = addMinMaxLabels(g);
  addSharedBrush(g, x, "annualTemp");
  highlightBus.on("highlight.annualTempRender", ({ range }) => {
    overlays.update(x, range);
    g.selectAll("circle.annual-point")
      .classed("dim", (d) => !!range && (d.year < range[0] || d.year > range[1]));

    const mm = minMaxInRange(data, range, (d) => d.year, (d) => d.mean_temp_c);
    if (!mm) {
      minmax.hide();
      return;
    }

    const fmt = d3.format(".2f");
    minmax.showOne(minmax.minG, x(mm.minD.year), y(mm.minD.mean_temp_c), `min ${fmt(mm.minD.mean_temp_c)}°C`);
    minmax.showOne(minmax.maxG, x(mm.maxD.year), y(mm.maxD.mean_temp_c), `max ${fmt(mm.maxD.mean_temp_c)}°C`);
  });
  overlays.update(x, activeYearRange);
  minmax.hide();
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

  const overlays = addHighlightOverlays(g);
  const minmax = addMinMaxLabels(g);
  addSharedBrush(g, x, "tempAnom");
  highlightBus.on("highlight.tempAnomRender", ({ range }) => {
    overlays.update(x, range);
    g.selectAll("rect.bar")
      .classed("dim", (d) => !!range && (d.year < range[0] || d.year > range[1]));

    const mm = minMaxInRange(data, range, (d) => d.year, (d) => d.temp_anomaly_c);
    if (!mm) {
      minmax.hide();
      return;
    }

    const fmt = d3.format("+.2f");
    minmax.showOne(minmax.minG, x(mm.minD.year), y(mm.minD.temp_anomaly_c), `min ${fmt(mm.minD.temp_anomaly_c)}°C`);
    minmax.showOne(minmax.maxG, x(mm.maxD.year), y(mm.maxD.temp_anomaly_c), `max ${fmt(mm.maxD.temp_anomaly_c)}°C`);
  });
  overlays.update(x, activeYearRange);
  minmax.hide();
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

  const overlays = addHighlightOverlays(g);
  const minmax = addMinMaxLabels(g);
  addSharedBrush(g, x, "seaLevel");
  highlightBus.on("highlight.seaLevelRender", ({ range }) => {
    overlays.update(x, range);

    const mm = minMaxInRange(data, range, (d) => d.year, (d) => d.zos_anomaly_mm);
    if (!mm) {
      minmax.hide();
      return;
    }

    const fmt = d3.format("+.1f");
    minmax.showOne(minmax.minG, x(mm.minD.year), y(mm.minD.zos_anomaly_mm), `min ${fmt(mm.minD.zos_anomaly_mm)} mm`);
    minmax.showOne(minmax.maxG, x(mm.maxD.year), y(mm.maxD.zos_anomaly_mm), `max ${fmt(mm.maxD.zos_anomaly_mm)} mm`);
  });
  overlays.update(x, activeYearRange);
  minmax.hide();
}

/* 4. Annual precipitation */
function chartPrecipitation(data) {
  const g = baseSvg("#chart-precip", "Modeled annual precipitation near San Diego");

  const x = d3.scaleBand()
    .domain(data.map((d) => d.year))
    .range([0, innerW])
    .padding(0.08);

  const xYear = d3.scaleLinear()
    .domain(d3.extent(data, (d) => d.year))
    .range([0, innerW]);

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
    .attr("class", "precip-bar")
    .attr("x", (d) => x(d.year))
    .attr("width", x.bandwidth())
    .attr("y", (d) => y(d.total_precip_mm))
    .attr("height", (d) => innerH - y(d.total_precip_mm))
    .attr("fill", (d) => (d.total_precip_mm >= baseline ? "#4a90a4" : "#7ba38c"));

  const overlays = addHighlightOverlays(g);
  const minmax = addMinMaxLabels(g);
  addSharedBrush(g, xYear, "precip");
  highlightBus.on("highlight.precipRender", ({ range }) => {
    overlays.update(xYear, range);
    g.selectAll("rect.precip-bar")
      .classed("dim", (d) => !!range && (d.year < range[0] || d.year > range[1]));

    const mm = minMaxInRange(data, range, (d) => d.year, (d) => d.total_precip_mm);
    if (!mm) {
      minmax.hide();
      return;
    }

    const fmt = d3.format(".0f");
    const xMin = xYear(mm.minD.year);
    const xMax = xYear(mm.maxD.year);
    minmax.showOne(minmax.minG, xMin, y(mm.minD.total_precip_mm), `min ${fmt(mm.minD.total_precip_mm)} mm`);
    minmax.showOne(minmax.maxG, xMax, y(mm.maxD.total_precip_mm), `max ${fmt(mm.maxD.total_precip_mm)} mm`);
  });
  overlays.update(xYear, activeYearRange);
  minmax.hide();
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

  const overlays = addHighlightOverlays(g);
  const minmax = addMinMaxLabels(g);
  addSharedBrush(g, x, "population");
  highlightBus.on("highlight.populationRender", ({ range }) => {
    overlays.update(x, range);
    g.selectAll("circle.census")
      .classed("dim", (d) => !!range && (d.year < range[0] || d.year > range[1]));

    const mm = minMaxInRange(annual, range, (d) => d.year, (d) => d.density_per_sq_mi);
    if (!mm) {
      minmax.hide();
      return;
    }

    const fmt = d3.format(".0f");
    minmax.showOne(minmax.minG, x(mm.minD.year), y(mm.minD.density_per_sq_mi), `min ${fmt(mm.minD.density_per_sq_mi)}`);
    minmax.showOne(minmax.maxG, x(mm.maxD.year), y(mm.maxD.density_per_sq_mi), `max ${fmt(mm.maxD.density_per_sq_mi)}`);
  });
  overlays.update(x, activeYearRange);
  minmax.hide();
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
