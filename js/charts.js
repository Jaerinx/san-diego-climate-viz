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

/* ── HERO: Morphing seasonal curve ──────────────────────────────────── */
function chartSeasonalCurve(rawData) {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const years = [...new Set(rawData.map(d => d.year))].sort((a, b) => a - b);
  const YEAR_MIN = years[0];
  const YEAR_MAX = years[years.length - 1];

  const byYear = new Map();
  years.forEach(yr => {
    const rows = rawData.filter(d => d.year === yr).sort((a, b) => a.month - b.month);
    byYear.set(yr, {
      temps:   rows.map(r => r.temp_c),
      precips: rows.map(r => r.precip_mm),
    });
  });

  const monthStats = d3.range(12).map(i => ({
    tempMean:   d3.mean(years, yr => byYear.get(yr).temps[i]),
    precipMean: d3.mean(years, yr => byYear.get(yr).precips[i]),
  }));

  const annualStats = years.map(yr => {
    const { temps, precips } = byYear.get(yr);
    return { year: yr, meanTemp: d3.mean(temps), totalPrecip: d3.sum(precips) };
  });

  function interpData(yr0, yr1, t) {
    const d0 = byYear.get(Math.min(yr0, YEAR_MAX));
    const d1 = byYear.get(Math.min(yr1, YEAR_MAX));
    return {
      temps:   d3.range(12).map(i => d0.temps[i]   * (1 - t) + d1.temps[i]   * t),
      precips: d3.range(12).map(i => d0.precips[i] * (1 - t) + d1.precips[i] * t),
    };
  }

  // ── Shared constants ──────────────────────────────────────────────
  const W = 900;
  const xLeft = 58, xRight = W - 36, iW = xRight - xLeft;
  const curve = d3.curveCatmullRom.alpha(0.5);
  const tooltip = d3.select('.tooltip');

  // x scale (months) shared between both SVGs via closure
  const x = d3.scalePoint()
    .domain(d3.range(1, 13)).range([xLeft, xRight]).padding(0.3);
  const timeX = d3.scaleLinear()
    .domain([YEAR_MIN, YEAR_MAX]).range([xLeft, xRight]);

  // ════════════════════════════════════════════════════════════════
  //  TEMPERATURE SVG  →  #chart-temp-seasonal
  // ════════════════════════════════════════════════════════════════
  const tH = 450;
  const tTop = 28, tBot = 290;
  const tTlTop = 342, tTlBot = 410;  // pushed down to clear month-axis labels

  const tSvg = d3.select('#chart-temp-seasonal')
    .append('svg').attr('viewBox', `0 0 ${W} ${tH}`)
    .attr('role', 'img')
    .attr('aria-label', 'Monthly temperature by year, San Diego 1925-2014');

  const allTemps = rawData.map(d => d.temp_c);
  const tY = d3.scaleLinear()
    .domain([d3.min(allTemps) - 0.8, d3.max(allTemps) + 0.8]).range([tBot, tTop]).nice();

  const tTlY = d3.scaleLinear()
    .domain(d3.extent(annualStats, d => d.meanTemp).map((v, i) => v + (i === 0 ? -0.2 : 0.2)))
    .range([tTlBot, tTlTop]).nice();

  const tempLineGen = d3.line().x((_, i) => x(i + 1)).y(d => tY(d)).curve(curve);

  tSvg.append('g').attr('class', 'grid').attr('transform', `translate(${xLeft},0)`)
    .call(d3.axisLeft(tY).tickSize(-iW).tickFormat('').ticks(5)).lower();
  tSvg.append('g').attr('class', 'axis').attr('transform', `translate(${xLeft},0)`)
    .call(d3.axisLeft(tY).ticks(5))
    .append('text').attr('class', 'axis-label')
    .attr('transform', 'rotate(-90)').attr('x', -(tBot - tTop) / 2 - tTop).attr('y', -44)
    .attr('fill', 'currentColor').attr('text-anchor', 'middle').text('°C');
  tSvg.append('g').attr('class', 'axis').attr('transform', `translate(0,${tBot})`)
    .call(d3.axisBottom(x).tickFormat(i => MONTHS[i - 1]));

  years.forEach(yr => {
    tSvg.append('path').datum(byYear.get(yr).temps)
      .attr('fill', 'none').attr('stroke', '#d0dae4').attr('stroke-width', 0.8)
      .attr('pointer-events', 'none').attr('d', tempLineGen);
  });

  tSvg.append('path').datum(monthStats.map(s => s.tempMean))
    .attr('fill', 'none').attr('stroke', '#9bb3c9')
    .attr('stroke-width', 1.5).attr('stroke-dasharray', '5,4')
    .attr('pointer-events', 'none').attr('d', tempLineGen);
  tSvg.append('text').attr('x', x(12) + 8).attr('y', tY(monthStats[11].tempMean))
    .attr('dy', '0.35em').attr('fill', '#9bb3c9').attr('font-size', 10).text('avg');

  const currentTempLine = tSvg.append('path')
    .attr('fill', 'none').attr('stroke', '#1a2332')
    .attr('stroke-width', 2.5).attr('stroke-linejoin', 'round');

  let activeDotIdx = null;
  const tempDots = tSvg.selectAll('circle.season-dot-t')
    .data(d3.range(12)).join('circle')
    .attr('class', 'season-dot-t').attr('r', 5)
    .attr('stroke', '#fff').attr('stroke-width', 1.5).style('cursor', 'pointer');

  // Temperature mini timeline
  tSvg.append('rect').attr('x', xLeft).attr('y', tTlTop - 4)
    .attr('width', iW).attr('height', tTlBot - tTlTop + 8)
    .attr('fill', '#f0f4f8').attr('rx', 3).lower();
  tSvg.append('text').attr('x', xLeft).attr('y', tTlTop - 8)
    .attr('fill', '#9bb3c9').attr('font-size', 9).attr('font-style', 'italic')
    .text('Annual mean temperature  1925-2014');
  tSvg.append('g').attr('class', 'axis').attr('transform', `translate(${xLeft},0)`)
    .call(d3.axisLeft(tTlY).ticks(3).tickSize(-3));
  tSvg.append('g').attr('class', 'axis').attr('transform', `translate(0,${tTlBot})`)
    .call(d3.axisBottom(timeX).tickValues([1925, 1940, 1955, 1970, 1985, 2000, 2014]).tickFormat(d3.format('d')));
  tSvg.append('path').datum(annualStats)
    .attr('fill', 'none').attr('stroke', '#1a2332').attr('stroke-width', 1.2)
    .attr('pointer-events', 'none')
    .attr('d', d3.line().x(d => timeX(d.year)).y(d => tTlY(d.meanTemp)).curve(d3.curveCatmullRom));
  const tCursor = tSvg.append('line')
    .attr('y1', tTlTop - 4).attr('y2', tTlBot + 4)
    .attr('stroke', '#1a2332').attr('stroke-width', 1.5).attr('opacity', 0.7);
  const tCursorDot = tSvg.append('circle')
    .attr('r', 4).attr('fill', '#1a2332').attr('stroke', '#fff').attr('stroke-width', 1.5);

  // ════════════════════════════════════════════════════════════════
  //  PRECIPITATION SVG  →  #chart-precip-seasonal
  // ════════════════════════════════════════════════════════════════
  const pH = 420;
  const pTop = 28, pBot = 268;
  const pTlTop = 316, pTlBot = 384;  // pushed down to clear month-axis labels

  const pSvg = d3.select('#chart-precip-seasonal')
    .append('svg').attr('viewBox', `0 0 ${W} ${pH}`)
    .attr('role', 'img')
    .attr('aria-label', 'Monthly precipitation by year, San Diego 1925-2014');

  const allPrecips = rawData.map(d => d.precip_mm);
  const pY = d3.scaleLinear()
    .domain([0, d3.max(allPrecips) * 1.08]).range([pBot, pTop]).nice();

  const pTlY = d3.scaleLinear()
    .domain([0, d3.max(annualStats, d => d.totalPrecip) * 1.1])
    .range([pTlBot, pTlTop]).nice();

  const precipLineGen = d3.line().x((_, i) => x(i + 1)).y(d => pY(d)).curve(curve);

  pSvg.append('g').attr('class', 'grid').attr('transform', `translate(${xLeft},0)`)
    .call(d3.axisLeft(pY).tickSize(-iW).tickFormat('').ticks(4)).lower();
  pSvg.append('g').attr('class', 'axis').attr('transform', `translate(${xLeft},0)`)
    .call(d3.axisLeft(pY).ticks(4))
    .append('text').attr('class', 'axis-label')
    .attr('transform', 'rotate(-90)').attr('x', -(pBot - pTop) / 2 - pTop).attr('y', -44)
    .attr('fill', 'currentColor').attr('text-anchor', 'middle').text('mm');
  pSvg.append('g').attr('class', 'axis').attr('transform', `translate(0,${pBot})`)
    .call(d3.axisBottom(x).tickFormat(i => MONTHS[i - 1]));

  years.forEach(yr => {
    pSvg.append('path').datum(byYear.get(yr).precips)
      .attr('fill', 'none').attr('stroke', '#c6d9e8').attr('stroke-width', 0.8)
      .attr('pointer-events', 'none').attr('d', precipLineGen);
  });

  pSvg.append('path').datum(monthStats.map(s => s.precipMean))
    .attr('fill', 'none').attr('stroke', '#9bb3c9')
    .attr('stroke-width', 1.5).attr('stroke-dasharray', '5,4')
    .attr('pointer-events', 'none').attr('d', precipLineGen);
  pSvg.append('text').attr('x', x(12) + 8).attr('y', pY(monthStats[11].precipMean))
    .attr('dy', '0.35em').attr('fill', '#9bb3c9').attr('font-size', 10).text('avg');

  const currentPrecipLine = pSvg.append('path')
    .attr('fill', 'none').attr('stroke', '#1a2332')
    .attr('stroke-width', 2.5).attr('stroke-linejoin', 'round');

  const precipDots = pSvg.selectAll('circle.season-dot-p')
    .data(d3.range(12)).join('circle')
    .attr('class', 'season-dot-p').attr('r', 5)
    .attr('stroke', '#fff').attr('stroke-width', 1.5).style('cursor', 'default');

  // Precipitation mini timeline
  pSvg.append('rect').attr('x', xLeft).attr('y', pTlTop - 4)
    .attr('width', iW).attr('height', pTlBot - pTlTop + 8)
    .attr('fill', '#f0f4f8').attr('rx', 3).lower();
  pSvg.append('text').attr('x', xLeft).attr('y', pTlTop - 8)
    .attr('fill', '#9bb3c9').attr('font-size', 9).attr('font-style', 'italic')
    .text('Annual total precipitation  1925-2014');
  pSvg.append('g').attr('class', 'axis').attr('transform', `translate(${xLeft},0)`)
    .call(d3.axisLeft(pTlY).ticks(3).tickSize(-3));
  pSvg.append('g').attr('class', 'axis').attr('transform', `translate(0,${pTlBot})`)
    .call(d3.axisBottom(timeX).tickValues([1925, 1940, 1955, 1970, 1985, 2000, 2014]).tickFormat(d3.format('d')));
  pSvg.append('path').datum(annualStats)
    .attr('fill', 'none').attr('stroke', '#1a2332').attr('stroke-width', 1.2)
    .attr('pointer-events', 'none')
    .attr('d', d3.line().x(d => timeX(d.year)).y(d => pTlY(d.totalPrecip)).curve(d3.curveCatmullRom));
  const pCursor = pSvg.append('line')
    .attr('y1', pTlTop - 4).attr('y2', pTlBot + 4)
    .attr('stroke', '#1a2332').attr('stroke-width', 1.5).attr('opacity', 0.7);
  const pCursorDot = pSvg.append('circle')
    .attr('r', 4).attr('fill', '#1a2332').attr('stroke', '#fff').attr('stroke-width', 1.5);

  // ── Month trend mini chart (temperature only) ─────────────────────
  function showMonthTrend(monthIdx) {
    const pts = years.map(yr => ({ year: yr, temp: byYear.get(yr).temps[monthIdx] }));
    const curYr = Math.round(+d3.select('#year-slider-t').property('value'));
    const mean = d3.mean(pts, d => d.temp);

    d3.select('#month-trend-title').text(`${MONTHS[monthIdx]}: temperature every year, 1925-2014`);
    d3.select('#month-trend-panel').classed('hidden', false);
    d3.select('#month-trend-chart').select('svg').remove();

    const mW = 820, mH = 150;
    const mM = { top: 16, right: 24, bottom: 36, left: 50 };
    const mIW = mW - mM.left - mM.right, mIH = mH - mM.top - mM.bottom;

    const mSvg = d3.select('#month-trend-chart')
      .append('svg').attr('viewBox', `0 0 ${mW} ${mH}`)
      .append('g').attr('transform', `translate(${mM.left},${mM.top})`);

    const mX = d3.scaleLinear().domain([YEAR_MIN, YEAR_MAX]).range([0, mIW]);
    const mY = d3.scaleLinear()
      .domain(d3.extent(pts, d => d.temp).map((v, i) => v + (i === 0 ? -0.4 : 0.4)))
      .range([mIH, 0]).nice();

    mSvg.append('line').attr('x1', 0).attr('x2', mIW)
      .attr('y1', mY(mean)).attr('y2', mY(mean))
      .attr('stroke', '#9bb3c9').attr('stroke-dasharray', '4,3').attr('stroke-width', 1.2);
    mSvg.append('text').attr('x', mIW + 4).attr('y', mY(mean))
      .attr('dy', '0.35em').attr('font-size', 9).attr('fill', '#9bb3c9').text('avg');
    mSvg.append('g').attr('class', 'axis').attr('transform', `translate(0,${mIH})`)
      .call(d3.axisBottom(mX).ticks(8).tickFormat(d3.format('d')));
    mSvg.append('g').attr('class', 'axis')
      .call(d3.axisLeft(mY).ticks(4))
      .append('text').attr('class', 'axis-label')
      .attr('transform', 'rotate(-90)').attr('x', -mIH / 2).attr('y', -40)
      .attr('fill', 'currentColor').attr('text-anchor', 'middle').text('C');
    mSvg.append('path').datum(pts)
      .attr('fill', 'none').attr('stroke', '#9bb3c9').attr('stroke-width', 1.2)
      .attr('d', d3.line().x(d => mX(d.year)).y(d => mY(d.temp)).curve(d3.curveCatmullRom));
    const cur = pts.find(d => d.year === curYr);
    if (cur) {
      mSvg.append('circle').attr('cx', mX(cur.year)).attr('cy', mY(cur.temp))
        .attr('r', 5).attr('fill', '#c44e52').attr('stroke', '#fff').attr('stroke-width', 1.5);
      mSvg.append('text').attr('x', mX(cur.year)).attr('y', mY(cur.temp) - 9)
        .attr('text-anchor', 'middle').attr('font-size', 10).attr('fill', '#c44e52')
        .text(`${cur.year}: ${cur.temp.toFixed(1)}C`);
    }
  }

  // ── Render functions (60fps via d3.timer) ─────────────────────────
  function renderTemp(floatYr) {
    const yr0 = Math.min(Math.floor(floatYr), YEAR_MAX - 1);
    const { temps } = interpData(yr0, yr0 + 1, floatYr - yr0);
    currentTempLine.attr('d', tempLineGen(temps));
    tempDots.attr('cx', i => x(i + 1)).attr('cy', i => tY(temps[i]))
      .attr('fill', i => temps[i] > monthStats[i].tempMean ? '#c44e52' : '#4a90a4');
    const cx = timeX(floatYr);
    tCursor.attr('x1', cx).attr('x2', cx);
    tCursorDot.attr('cx', cx).attr('cy', tTlY(d3.mean(temps)));
  }

  function renderPrecip(floatYr) {
    const yr0 = Math.min(Math.floor(floatYr), YEAR_MAX - 1);
    const { precips } = interpData(yr0, yr0 + 1, floatYr - yr0);
    currentPrecipLine.attr('d', precipLineGen(precips));
    precipDots.attr('cx', i => x(i + 1)).attr('cy', i => pY(precips[i]))
      .attr('fill', i => precips[i] >= monthStats[i].precipMean ? '#4a90a4' : '#c4936a');
    const cx = timeX(floatYr);
    pCursor.attr('x1', cx).attr('x2', cx);
    pCursorDot.attr('cx', cx).attr('cy', pTlY(d3.sum(precips)));
  }

  // ── Independent animation state ──────────────────────────────────
  const anim = {
    t: { timer: null, playing: false, interval: 500 },
    p: { timer: null, playing: false, interval: 500 },
  };

  function stopAnim(panel) {
    const a = anim[panel];
    if (a.timer) { a.timer.stop(); a.timer = null; }
    a.playing = false;
    d3.select(`#play-btn-${panel}`).html('&#9654; Play');
  }

  function startAnim(panel) {
    stopAnim(panel);
    const a = anim[panel];
    const render = panel === 't' ? renderTemp : renderPrecip;
    const slider = d3.select(`#year-slider-${panel}`);
    const label  = d3.select(`#year-label-${panel}`);
    let startYr = +slider.property('value');
    if (startYr >= YEAR_MAX) {
      startYr = YEAR_MIN;
      slider.property('value', YEAR_MIN);
      label.text(YEAR_MIN);
      render(YEAR_MIN);
    }
    a.playing = true;
    d3.select(`#play-btn-${panel}`).html('&#9646;&#9646; Pause');
    a.timer = d3.timer(elapsed => {
      const floatYr = startYr + elapsed / a.interval;
      if (floatYr >= YEAR_MAX) {
        render(YEAR_MAX);
        slider.property('value', YEAR_MAX);
        label.text(YEAR_MAX);
        stopAnim(panel);
        return;
      }
      render(floatYr);
      slider.property('value', floatYr);
      label.text(Math.round(floatYr));
    });
  }

  d3.select('#play-btn-t').on('click', () => anim.t.playing ? stopAnim('t') : startAnim('t'));
  d3.select('#play-btn-p').on('click', () => anim.p.playing ? stopAnim('p') : startAnim('p'));

  ['t', 'p'].forEach(panel => {
    d3.selectAll(`.speed-btn-${panel}`).on('click', function() {
      d3.selectAll(`.speed-btn-${panel}`).classed('active', false);
      d3.select(this).classed('active', true);
      anim[panel].interval = +d3.select(this).attr('data-ms');
    });
  });

  d3.select('#year-slider-t').on('input', function() {
    stopAnim('t');
    const yr = +this.value;
    d3.select('#year-label-t').text(Math.round(yr));
    renderTemp(yr);
    if (activeDotIdx !== null) showMonthTrend(activeDotIdx);
  });
  d3.select('#year-slider-p').on('input', function() {
    stopAnim('p');
    const yr = +this.value;
    d3.select('#year-label-p').text(Math.round(yr));
    renderPrecip(yr);
  });

  tempDots
    .on('mouseover', function(event, i) {
      const yr = Math.round(+d3.select('#year-slider-t').property('value'));
      const { temps } = byYear.get(Math.min(yr, YEAR_MAX));
      tooltip.style('opacity', 1).html(
        `<strong>${MONTHS[i]} ${yr}</strong><br>Temp: ${temps[i].toFixed(1)} °C`
      );
    })
    .on('mousemove', e => tooltip
      .style('left', (e.pageX + 14) + 'px').style('top', (e.pageY - 36) + 'px'))
    .on('mouseout', () => tooltip.style('opacity', 0))
    .on('click', function(event, i) {
      activeDotIdx = i;
      tempDots.attr('stroke', '#fff').attr('stroke-width', 1.5);
      d3.select(this).attr('stroke', '#1a2332').attr('stroke-width', 2.5);
      showMonthTrend(i);
    });

  precipDots
    .on('mouseover', function(event, i) {
      const yr = Math.round(+d3.select('#year-slider-p').property('value'));
      const { precips } = byYear.get(Math.min(yr, YEAR_MAX));
      tooltip.style('opacity', 1).html(
        `<strong>${MONTHS[i]} ${yr}</strong><br>Precip: ${precips[i].toFixed(1)} mm`
      );
    })
    .on('mousemove', e => tooltip
      .style('left', (e.pageX + 14) + 'px').style('top', (e.pageY - 36) + 'px'))
    .on('mouseout', () => tooltip.style('opacity', 0));

  d3.select('#month-trend-close').on('click', () => {
    d3.select('#month-trend-panel').classed('hidden', true);
    tempDots.attr('stroke', '#fff').attr('stroke-width', 1.5);
    activeDotIdx = null;
  });

  renderTemp(YEAR_MIN);
  renderPrecip(YEAR_MIN);
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

/* ── Cloud cover seasonal chart ────────────────────────────────────── */
function chartCloudCurve(rawData) {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const years = [...new Set(rawData.map(d => d.year))].sort((a, b) => a - b);
  const YEAR_MIN = years[0];
  const YEAR_MAX = years[years.length - 1];

  const byYear = new Map();
  years.forEach(yr => {
    const rows = rawData.filter(d => d.year === yr).sort((a, b) => a.month - b.month);
    byYear.set(yr, rows.map(r => r.clt_pct));
  });

  const monthMeans = d3.range(12).map(i =>
    d3.mean(years, yr => byYear.get(yr)[i])
  );

  const annualMeans = years.map(yr => ({
    year: yr,
    meanClt: d3.mean(byYear.get(yr)),
  }));

  function interpClt(yr0, yr1, t) {
    const d0 = byYear.get(Math.min(yr0, YEAR_MAX));
    const d1 = byYear.get(Math.min(yr1, YEAR_MAX));
    return d3.range(12).map(i => d0[i] * (1 - t) + d1[i] * t);
  }

  // ── Layout (mirrors temp/precip charts) ──────────────────────────
  const W = 900;
  const xLeft = 58, xRight = W - 36, iW = xRight - xLeft;
  const cH = 420;
  const cTop = 28, cBot = 268;
  const cTlTop = 316, cTlBot = 384;

  const svg = d3.select('#chart-cloud-seasonal')
    .append('svg').attr('viewBox', `0 0 ${W} ${cH}`)
    .attr('role', 'img')
    .attr('aria-label', 'Monthly cloud cover by year, San Diego 1925-2014');

  const x = d3.scalePoint()
    .domain(d3.range(1, 13)).range([xLeft, xRight]).padding(0.3);
  const timeX = d3.scaleLinear()
    .domain([YEAR_MIN, YEAR_MAX]).range([xLeft, xRight]);
  const curve = d3.curveCatmullRom.alpha(0.5);

  const cY = d3.scaleLinear().domain([0, 100]).range([cBot, cTop]);

  const cTlY = d3.scaleLinear()
    .domain(d3.extent(annualMeans, d => d.meanClt).map((v, i) => v + (i === 0 ? -2 : 2)))
    .range([cTlBot, cTlTop]).nice();

  const cltLineGen = d3.line().x((_, i) => x(i + 1)).y(d => cY(d)).curve(curve);

  // Grid + axes
  svg.append('g').attr('class', 'grid').attr('transform', `translate(${xLeft},0)`)
    .call(d3.axisLeft(cY).tickSize(-iW).tickFormat('').ticks(5)).lower();
  svg.append('g').attr('class', 'axis').attr('transform', `translate(${xLeft},0)`)
    .call(d3.axisLeft(cY).ticks(5).tickFormat(d => `${d}%`))
    .append('text').attr('class', 'axis-label')
    .attr('transform', 'rotate(-90)').attr('x', -(cBot - cTop) / 2 - cTop).attr('y', -44)
    .attr('fill', 'currentColor').attr('text-anchor', 'middle').text('Cloud cover (%)');
  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${cBot})`)
    .call(d3.axisBottom(x).tickFormat(i => MONTHS[i - 1]));

  // Background lines (all years)
  years.forEach(yr => {
    svg.append('path').datum(byYear.get(yr))
      .attr('fill', 'none').attr('stroke', '#d8e3ea').attr('stroke-width', 0.8)
      .attr('pointer-events', 'none').attr('d', cltLineGen);
  });

  // Mean reference
  svg.append('path').datum(monthMeans)
    .attr('fill', 'none').attr('stroke', '#9bb3c9')
    .attr('stroke-width', 1.5).attr('stroke-dasharray', '5,4')
    .attr('pointer-events', 'none').attr('d', cltLineGen);
  svg.append('text').attr('x', x(12) + 8).attr('y', cY(monthMeans[11]))
    .attr('dy', '0.35em').attr('fill', '#9bb3c9').attr('font-size', 10).text('avg');

  // Current year line + dots
  const currentCltLine = svg.append('path')
    .attr('fill', 'none').attr('stroke', '#1a2332')
    .attr('stroke-width', 2.5).attr('stroke-linejoin', 'round');

  const tooltip = d3.select('.tooltip');
  const cltDots = svg.selectAll('circle.season-dot-c')
    .data(d3.range(12)).join('circle')
    .attr('class', 'season-dot-c').attr('r', 5)
    .attr('stroke', '#fff').attr('stroke-width', 1.5)
    .attr('pointer-events', 'none');

  // Mini timeline
  svg.append('rect').attr('x', xLeft).attr('y', cTlTop - 4)
    .attr('width', iW).attr('height', cTlBot - cTlTop + 8)
    .attr('fill', '#f0f4f8').attr('rx', 3).lower();
  svg.append('text').attr('x', xLeft).attr('y', cTlTop - 8)
    .attr('fill', '#9bb3c9').attr('font-size', 9).attr('font-style', 'italic')
    .text('Annual mean cloud cover  1925-2014');
  svg.append('g').attr('class', 'axis').attr('transform', `translate(${xLeft},0)`)
    .call(d3.axisLeft(cTlY).ticks(3).tickSize(-3).tickFormat(d => `${d}%`));
  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${cTlBot})`)
    .call(d3.axisBottom(timeX).tickValues([1925, 1940, 1955, 1970, 1985, 2000, 2014]).tickFormat(d3.format('d')));
  svg.append('path').datum(annualMeans)
    .attr('fill', 'none').attr('stroke', '#1a2332').attr('stroke-width', 1.2)
    .attr('pointer-events', 'none')
    .attr('d', d3.line().x(d => timeX(d.year)).y(d => cTlY(d.meanClt)).curve(d3.curveCatmullRom));

  const cCursor = svg.append('line')
    .attr('y1', cTlTop - 4).attr('y2', cTlBot + 4)
    .attr('stroke', '#1a2332').attr('stroke-width', 1.5).attr('opacity', 0.7);
  const cCursorDot = svg.append('circle')
    .attr('r', 4).attr('fill', '#1a2332').attr('stroke', '#fff').attr('stroke-width', 1.5);

  // ── Render (called at 60fps) ──────────────────────────────────────
  function renderCloud(floatYr) {
    const yr0 = Math.min(Math.floor(floatYr), YEAR_MAX - 1);
    const clt = interpClt(yr0, yr0 + 1, floatYr - yr0);
    currentCltLine.attr('d', cltLineGen(clt));
    cltDots.attr('cx', i => x(i + 1)).attr('cy', i => cY(clt[i]))
      .attr('fill', i => clt[i] < monthMeans[i] ? '#f4a261' : '#9bb3c9');
    const cx = timeX(floatYr);
    cCursor.attr('x1', cx).attr('x2', cx);
    cCursorDot.attr('cx', cx).attr('cy', cTlY(d3.mean(clt)));
  }

  // ── Animation ─────────────────────────────────────────────────────
  const anim = { timer: null, playing: false, interval: 500 };

  function stopAnim() {
    if (anim.timer) { anim.timer.stop(); anim.timer = null; }
    anim.playing = false;
    d3.select('#play-btn-c').html('&#9654; Play');
  }

  function startAnim() {
    stopAnim();
    const slider = d3.select('#year-slider-c');
    const label  = d3.select('#year-label-c');
    let startYr = +slider.property('value');
    if (startYr >= YEAR_MAX) {
      startYr = YEAR_MIN;
      slider.property('value', YEAR_MIN);
      label.text(YEAR_MIN);
      renderCloud(YEAR_MIN);
    }
    anim.playing = true;
    d3.select('#play-btn-c').html('&#9646;&#9646; Pause');
    anim.timer = d3.timer(elapsed => {
      const floatYr = startYr + elapsed / anim.interval;
      if (floatYr >= YEAR_MAX) {
        renderCloud(YEAR_MAX);
        slider.property('value', YEAR_MAX);
        label.text(YEAR_MAX);
        stopAnim();
        return;
      }
      renderCloud(floatYr);
      slider.property('value', floatYr);
      label.text(Math.round(floatYr));
    });
  }

  d3.select('#play-btn-c').on('click', () => anim.playing ? stopAnim() : startAnim());

  d3.selectAll('.speed-btn-c').on('click', function() {
    d3.selectAll('.speed-btn-c').classed('active', false);
    d3.select(this).classed('active', true);
    anim.interval = +d3.select(this).attr('data-ms');
  });

  d3.select('#year-slider-c').on('input', function() {
    stopAnim();
    const yr = +this.value;
    d3.select('#year-label-c').text(Math.round(yr));
    renderCloud(yr);
  });

  // Dot tooltips
  cltDots.attr('pointer-events', 'all').style('cursor', 'default')
    .on('mouseover', function(event, i) {
      const yr = Math.round(+d3.select('#year-slider-c').property('value'));
      const clt = byYear.get(Math.min(yr, YEAR_MAX));
      tooltip.style('opacity', 1).html(
        `<strong>${MONTHS[i]} ${yr}</strong><br>Cloud cover: ${clt[i].toFixed(1)}%<br>` +
        `Sunshine: ~${(100 - clt[i]).toFixed(0)}%`
      );
    })
    .on('mousemove', e => tooltip.style('left', (e.pageX + 14) + 'px').style('top', (e.pageY - 36) + 'px'))
    .on('mouseout', () => tooltip.style('opacity', 0));

  // Hide the "run script" note since data loaded
  d3.select('#cloud-chart-note').style('display', 'none');

  renderCloud(YEAR_MIN);
}

/* ── Visitor recommendation chart ──────────────────────────────────── */
function chartVisitRecommendation(rawData, cloudByYear) {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const years = [...new Set(rawData.map(d => d.year))].sort((a, b) => a - b);

  // Monthly climatology (mean across all years)
  const meanTemp   = d3.range(12).map(i => d3.mean(rawData.filter(d => d.month === i + 1), d => d.temp_c));
  const meanPrecip = d3.range(12).map(i => d3.mean(rawData.filter(d => d.month === i + 1), d => d.precip_mm));
  const meanClt    = d3.range(12).fill(null);

  const monthAvg = d3.range(12).map(i => ({
    month:  i + 1,
    temp:   meanTemp[i],
    precip: meanPrecip[i],
    clt:    null,
  }));

  let cloudAvailable = false;

  function applyCloudMeans(rows) {
    rows.forEach(row => {
      const i = row.month - 1;
      if (i >= 0 && i < 12 && row.clt_pct != null) {
        meanClt[i]      = row.clt_pct;
        monthAvg[i].clt = row.clt_pct;
      }
    });
    cloudAvailable = true;
    d3.select('#cloud-note').text('');
    d3.select('#sun-pref-row').style('display', null);
    update();
  }

  // Load cloud averages; fall back to computing from full cloud data if available
  d3.csv('data/monthly_cloud_avg.csv', d3.autoType)
    .then(applyCloudMeans)
    .catch(() => {
      if (cloudByYear) {
        const avgs = d3.range(12).map(i => {
          const rows = cloudByYear.filter(d => d.month === i + 1);
          return { month: i + 1, clt_pct: d3.mean(rows, d => d.clt_pct) };
        });
        applyCloudMeans(avgs);
      } else {
        d3.select('#cloud-note').text(
          'Run scripts/extract_cloud.py to include sunshine in recommendations.'
        );
      }
    });

  // Preference state (0–1)
  let prefWarm = 0.5;   // 0 = loves cold, 1 = loves heat
  let prefDry  = 0.4;   // 0 = rain is fine, 1 = must be dry
  let prefSun  = 0.5;   // 0 = love cloudy, 1 = love sunny

  const ACTIVITY_COLOR = { beach: '#f4a261', hike: '#52b788', home: '#aac4d4' };
  const ACTIVITY_LABEL = { beach: 'Beach', hike: 'Hiking', home: 'Indoors' };

  function getActivity(m) {
    const { temp, precip, clt } = m;

    const idealLo = 14 + prefWarm * 8;
    const idealHi = idealLo + 10;
    const tempScore = temp < idealLo
      ? Math.max(0, 1 - (idealLo - temp) / 12)
      : Math.max(0, 1 - (temp - idealHi) / 8);

    const wetPenalty = Math.max(0, 1 - Math.exp(-precip / 25)) * prefDry;
    const sunPenalty = clt !== null ? Math.max(0, 1 - Math.exp(-clt / 40)) * prefSun : 0;
    const outdoorScore = tempScore * (1 - wetPenalty * 0.8) * (1 - sunPenalty * 0.7);

    if (outdoorScore < 0.25) return 'home';
    if (temp > 19 + prefWarm * 5) return 'beach';
    return 'hike';
  }

  // ── SVG ────────────────────────────────────────────────────────────
  const W = 900, H = 200;
  const cardW = 68, cardH = 148;
  const gap = 4;
  const totalW = 12 * cardW + 11 * gap;
  const startX = (W - totalW) / 2;
  const startY = 20;

  const svg = d3.select('#chart-visit-rec')
    .append('svg').attr('viewBox', `0 0 ${W} ${H}`)
    .attr('role', 'img')
    .attr('aria-label', 'Monthly visit recommendations for San Diego');

  // Fixed scale across all years so bar width stays consistent
  const allTemps = rawData.map(d => d.temp_c);
  const barScale = d3.scaleLinear()
    .domain([d3.min(allTemps) - 1, d3.max(allTemps) + 1])
    .range([0, cardW - 16]);

  const cards = svg.selectAll('g.month-card')
    .data(monthAvg).join('g')
    .attr('class', 'month-card')
    .attr('transform', (_, i) => `translate(${startX + i * (cardW + gap)},${startY})`);

  cards.append('rect').attr('class', 'rec-card-bg')
    .attr('width', cardW).attr('height', cardH).attr('rx', 6);

  cards.append('text').attr('class', 'rec-month')
    .attr('x', cardW / 2).attr('y', 17)
    .attr('text-anchor', 'middle')
    .attr('font-size', 11).attr('font-weight', '700').attr('fill', '#1a2332')
    .text(d => MONTHS[d.month - 1]);

  cards.append('text').attr('class', 'rec-act')
    .attr('x', cardW / 2).attr('y', 58)
    .attr('text-anchor', 'middle')
    .attr('font-size', 10).attr('font-weight', '600').attr('fill', '#1a2332');

  cards.append('text').attr('class', 'rec-temp')
    .attr('x', cardW / 2).attr('y', 82)
    .attr('text-anchor', 'middle')
    .attr('font-size', 9).attr('fill', '#3d4f5e');

  cards.append('rect')
    .attr('x', 8).attr('y', 89)
    .attr('width', cardW - 16).attr('height', 4)
    .attr('rx', 2).attr('fill', 'rgba(26,35,50,0.1)');

  cards.append('rect').attr('class', 'rec-bar')
    .attr('x', 8).attr('y', 89).attr('height', 4).attr('rx', 2);

  cards.append('text').attr('class', 'rec-precip')
    .attr('x', cardW / 2).attr('y', 110)
    .attr('text-anchor', 'middle')
    .attr('font-size', 8).attr('fill', '#5c6b7a');

  cards.append('text').attr('class', 'rec-sun')
    .attr('x', cardW / 2).attr('y', 126)
    .attr('text-anchor', 'middle')
    .attr('font-size', 8)
    .style('display', 'none');

  // Tooltip
  const tip = d3.select('.tooltip');
  cards
    .style('cursor', 'default')
    .on('mouseover', function(event, d) {
      const act = getActivity(d);
      tip.style('opacity', 1).html(
        `<strong>${MONTHS[d.month - 1]}</strong><br>` +
        `${ACTIVITY_LABEL[act]}<br>` +
        `Avg temp: ${d.temp.toFixed(1)} °C<br>` +
        `Avg rain: ${d.precip.toFixed(1)} mm` +
        (d.clt !== null ? `<br>Avg cloud: ${d.clt.toFixed(0)}% (${Math.round(100 - d.clt)}% sunny)` : '')
      );
    })
    .on('mousemove', e => tip.style('left', (e.pageX + 14) + 'px').style('top', (e.pageY - 36) + 'px'))
    .on('mouseout', () => tip.style('opacity', 0));

  // ── Update ──────────────────────────────────────────────────────────
  function update() {
    cards.select('rect.rec-card-bg')
      .transition().duration(350)
      .attr('fill', d => ACTIVITY_COLOR[getActivity(d)]);

    cards.select('text.rec-act')
      .text(d => ACTIVITY_LABEL[getActivity(d)]);

    cards.select('text.rec-temp')
      .text(d => `${d.temp.toFixed(1)} °C`);

    cards.select('rect.rec-bar')
      .transition().duration(350)
      .attr('width', d => Math.max(0, Math.min(cardW - 16, barScale(d.temp))))
      .attr('fill', d => getActivity(d) === 'beach' ? '#e76f51' : '#4a90a4');

    cards.select('text.rec-precip')
      .text(d => `${d.precip.toFixed(0)} mm rain`);

    cards.select('text.rec-sun')
      .style('display', d => d.clt !== null ? null : 'none')
      .attr('fill', d => d.clt !== null && d.clt < 50 ? '#e07b3a' : '#9bb3c9')
      .text(d => d.clt !== null ? `~${Math.round(100 - d.clt)}% sunny` : '');
  }

  update();

  // ── Year input ───────────────────────────────────────────────────────
  function setYearData(year) {
    if (year === null) {
      d3.range(12).forEach(i => {
        monthAvg[i].temp   = meanTemp[i];
        monthAvg[i].precip = meanPrecip[i];
        monthAvg[i].clt    = meanClt[i];
      });
      d3.select('#label-year').text('Average');
    } else {
      d3.range(12).forEach(i => {
        const row = rawData.find(d => d.year === year && d.month === i + 1);
        monthAvg[i].temp   = row ? row.temp_c   : meanTemp[i];
        monthAvg[i].precip = row ? row.precip_mm : meanPrecip[i];
        let clt = meanClt[i];
        if (cloudByYear) {
          const cr = cloudByYear.find(d => d.year === year && d.month === i + 1);
          if (cr) clt = cr.clt_pct;
        }
        monthAvg[i].clt = clt;
      });
      d3.select('#label-year').text(year);
    }
    update();
  }

  const YEAR_MIN = years[0], YEAR_MAX = years[years.length - 1];

  d3.select('#pref-year').on('input', function() {
    const v = +this.value;
    if (!this.value || isNaN(v) || v < YEAR_MIN || v > YEAR_MAX) {
      setYearData(null);
    } else {
      setYearData(Math.round(v));
    }
  });

  // Hide sun slider until cloud data loads
  d3.select('#sun-pref-row').style('display', 'none');

  // Preference sliders
  const warmLabels = ['Prefer cold', 'Prefer cool', 'Moderate', 'Prefer warm', 'Prefer hot'];
  const dryLabels  = ["Rain ok", 'Drizzle ok', 'Moderate', 'Prefer dry', 'Must be dry'];
  const sunLabels  = ['Love cloudy', 'Prefer cloudy', 'Moderate', 'Prefer sunny', 'Love sunny'];

  d3.select('#pref-warm').on('input', function() {
    prefWarm = +this.value;
    d3.select('#label-warm').text(warmLabels[Math.round(prefWarm * 4)]);
    update();
  });
  d3.select('#pref-dry').on('input', function() {
    prefDry = +this.value;
    d3.select('#label-dry').text(dryLabels[Math.round(prefDry * 4)]);
    update();
  });
  d3.select('#pref-sun').on('input', function() {
    prefSun = +this.value;
    d3.select('#label-sun').text(sunLabels[Math.round(prefSun * 4)]);
    update();
  });
}

async function init() {
  const [annual, anomalies, seaLevel, popAnnual, popCensus, meta, monthlyClimatology, cloudData] = await Promise.all([
    d3.csv("data/annual_climate.csv", d3.autoType),
    d3.csv("data/annual_anomalies.csv", d3.autoType),
    d3.csv("data/annual_sea_level.csv", d3.autoType),
    d3.csv("data/annual_population_density.csv", d3.autoType),
    d3.csv("data/census_population.csv", d3.autoType),
    d3.json("data/metadata.json"),
    d3.csv("data/monthly_by_year.csv", d3.autoType),
    d3.csv("data/monthly_cloud.csv", d3.autoType).catch(() => null),
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

  chartSeasonalCurve(monthlyClimatology);
  if (cloudData) chartCloudCurve(cloudData);
  chartVisitRecommendation(monthlyClimatology, cloudData);
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
