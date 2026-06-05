/* ── Global unit state ───────────────────────────────────────────────── */
let tempUnit = 'C';               // 'C' or 'F'
let _updateRecChart = null;       // exposed from chartVisitRecommendation closure
let _updateTempSeasonalUnit = null; // exposed from chartSeasonalCurve closure
let globalSspData = null;         // set in init() so goTo(3) can re-trigger animations
let globalGoTo = null;            // exposed from initPageNav so other functions can navigate

function fmtTemp(c) {
  return tempUnit === 'F'
    ? `${((c * 9 / 5) + 32).toFixed(1)}°F`
    : `${c.toFixed(1)}°C`;
}

function cToDisplay(c) {
  return tempUnit === 'F' ? (c * 9 / 5 + 32) : c;
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
  const tYAxisG = tSvg.append('g').attr('class', 'axis').attr('transform', `translate(${xLeft},0)`)
    .call(d3.axisLeft(tY).ticks(5));
  tYAxisG.append('text').attr('class', 'axis-label')
    .attr('transform', 'rotate(-90)').attr('x', -(tBot - tTop) / 2 - tTop).attr('y', -44)
    .attr('fill', 'currentColor').attr('text-anchor', 'middle').text('°C');
  tSvg.append('g').attr('class', 'axis').attr('transform', `translate(0,${tBot})`)
    .call(d3.axisBottom(x).tickFormat(i => MONTHS[i - 1]));

  const tYearPaths = tSvg.selectAll('.yr-line-t')
    .data(years).join('path')
    .attr('class', 'yr-line-t')
    .attr('fill', 'none').attr('stroke', '#d0dae4').attr('stroke-width', 0.8)
    .attr('pointer-events', 'none').attr('opacity', 0)
    .attr('d', yr => tempLineGen(byYear.get(yr).temps));

  tSvg.append('path').datum(monthStats.map(s => s.tempMean))
    .attr('fill', 'none').attr('stroke', '#9bb3c9')
    .attr('stroke-width', 1.5).attr('stroke-dasharray', '5,4')
    .attr('pointer-events', 'none').attr('d', tempLineGen);
  tSvg.append('text').attr('x', x(12) + 8).attr('y', tY(monthStats[11].tempMean))
    .attr('dy', '0.35em').attr('fill', '#9bb3c9').attr('font-size', 10).text('avg');

  const currentTempLine = tSvg.append('path')
    .attr('class', 'current-year-line')
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

  const pYearPaths = pSvg.selectAll('.yr-line-p')
    .data(years).join('path')
    .attr('class', 'yr-line-p')
    .attr('fill', 'none').attr('stroke', '#c6d9e8').attr('stroke-width', 0.8)
    .attr('pointer-events', 'none').attr('opacity', 0)
    .attr('d', yr => precipLineGen(byYear.get(yr).precips));

  pSvg.append('path').datum(monthStats.map(s => s.precipMean))
    .attr('fill', 'none').attr('stroke', '#9bb3c9')
    .attr('stroke-width', 1.5).attr('stroke-dasharray', '5,4')
    .attr('pointer-events', 'none').attr('d', precipLineGen);
  pSvg.append('text').attr('x', x(12) + 8).attr('y', pY(monthStats[11].precipMean))
    .attr('dy', '0.35em').attr('fill', '#9bb3c9').attr('font-size', 10).text('avg');

  const currentPrecipLine = pSvg.append('path')
    .attr('class', 'current-year-line')
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
    const rawPts = years.map(yr => ({ year: yr, temp: byYear.get(yr).temps[monthIdx] }));
    const pts = rawPts.map(d => ({ year: d.year, val: cToDisplay(d.temp), rawTemp: d.temp }));
    const curYr = Math.round(+d3.select('#year-slider-t').property('value'));
    const mean = d3.mean(pts, d => d.val);

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
    const pad = tempUnit === 'F' ? 0.8 : 0.4;
    const mY = d3.scaleLinear()
      .domain(d3.extent(pts, d => d.val).map((v, i) => v + (i === 0 ? -pad : pad)))
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
      .attr('fill', 'currentColor').attr('text-anchor', 'middle').text(tempUnit === 'F' ? '°F' : '°C');
    mSvg.append('path').datum(pts)
      .attr('fill', 'none').attr('stroke', '#9bb3c9').attr('stroke-width', 1.2)
      .attr('d', d3.line().x(d => mX(d.year)).y(d => mY(d.val)).curve(d3.curveCatmullRom));
    const cur = pts.find(d => d.year === curYr);
    if (cur) {
      mSvg.append('circle').attr('cx', mX(cur.year)).attr('cy', mY(cur.val))
        .attr('r', 5).attr('fill', '#c44e52').attr('stroke', '#fff').attr('stroke-width', 1.5);
      mSvg.append('text').attr('x', mX(cur.year)).attr('y', mY(cur.val) - 9)
        .attr('text-anchor', 'middle').attr('font-size', 10).attr('fill', '#c44e52')
        .text(`${cur.year}: ${fmtTemp(cur.rawTemp)}`);
    }
  }

  // ── Render functions (60fps via d3.timer) ─────────────────────────
  function renderTemp(floatYr) {
    const yr0 = Math.min(Math.floor(floatYr), YEAR_MAX - 1);
    const { temps } = interpData(yr0, yr0 + 1, floatYr - yr0);
    currentTempLine.attr('d', tempLineGen(temps));
    tYearPaths.attr('opacity', yr => yr <= floatYr ? 1 : 0);
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
    pYearPaths.attr('opacity', yr => yr <= floatYr ? 1 : 0);
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
        `<strong>${MONTHS[i]} ${yr}</strong><br>Temp: ${fmtTemp(temps[i])}`
      );
    })
    .on('mousemove', e => tooltip
      .style('left', (e.clientX + 14) + 'px').style('top', (e.clientY - 36) + 'px'))
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
      .style('left', (e.clientX + 14) + 'px').style('top', (e.clientY - 36) + 'px'))
    .on('mouseout', () => tooltip.style('opacity', 0));

  d3.select('#month-trend-close').on('click', () => {
    d3.select('#month-trend-panel').classed('hidden', true);
    tempDots.attr('stroke', '#fff').attr('stroke-width', 1.5);
    activeDotIdx = null;
  });

  renderTemp(YEAR_MIN);
  renderPrecip(YEAR_MIN);

  _updateTempSeasonalUnit = function() {
    tYAxisG.call(d3.axisLeft(tY).ticks(5).tickFormat(c =>
      tempUnit === 'F' ? Math.round(c * 9 / 5 + 32) : c
    ));
    tYAxisG.select('text.axis-label').text(tempUnit === 'F' ? '°F' : '°C');
  };
}


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

  // Background lines — revealed as each year passes
  const cYearPaths = svg.selectAll('.yr-line-c')
    .data(years).join('path')
    .attr('class', 'yr-line-c')
    .attr('fill', 'none').attr('stroke', '#d8e3ea').attr('stroke-width', 0.8)
    .attr('pointer-events', 'none').attr('opacity', 0)
    .attr('d', yr => cltLineGen(byYear.get(yr)));

  // Mean reference
  svg.append('path').datum(monthMeans)
    .attr('fill', 'none').attr('stroke', '#9bb3c9')
    .attr('stroke-width', 1.5).attr('stroke-dasharray', '5,4')
    .attr('pointer-events', 'none').attr('d', cltLineGen);
  svg.append('text').attr('x', x(12) + 8).attr('y', cY(monthMeans[11]))
    .attr('dy', '0.35em').attr('fill', '#9bb3c9').attr('font-size', 10).text('avg');

  // Current year line + dots
  const currentCltLine = svg.append('path')
    .attr('class', 'current-year-line')
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
    cYearPaths.attr('opacity', yr => yr <= floatYr ? 1 : 0);
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
    .on('mousemove', e => tooltip.style('left', (e.clientX + 14) + 'px').style('top', (e.clientY - 36) + 'px'))
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

  // Recent decade (2005-2014) averages
  const RECENT_START = 2005;
  const recentMonthAvg = d3.range(12).map(i => ({
    month:  i + 1,
    temp:   d3.mean(rawData.filter(d => d.year >= RECENT_START && d.month === i + 1), d => d.temp_c),
    precip: d3.mean(rawData.filter(d => d.year >= RECENT_START && d.month === i + 1), d => d.precip_mm),
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
    // Also compute recent cloud from per-year data
    if (cloudByYear) {
      d3.range(12).forEach(i => {
        const recent = cloudByYear.filter(d => d.year >= RECENT_START && d.month === i + 1);
        if (recent.length) recentMonthAvg[i].clt = d3.mean(recent, d => d.clt_pct);
      });
    }
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

  // Preference state
  const FIRE_THRESHOLD = 27;  // °C — hardcoded env. threshold, not user-adjustable
  let prefTemp = 24;  // user's ideal outdoor temperature
  let prefDry  = 0.4;
  let prefSun  = 0.5;

  const ACTIVITY_COLOR = {
    beach: '#f4a261', hike: '#52b788', home: '#aac4d4',
    fire:  '#e63946', storm: '#457b9d',
  };
  const ACTIVITY_LABEL = {
    beach: 'Beach', hike: 'Hiking', home: 'Indoors',
    fire: 'Fire Risk', storm: 'Storm Risk',
  };

  function getActivity(m) {
    const { temp, precip, clt } = m;
    const presentMean = meanPrecip[m.month - 1];
    const idealLo  = prefTemp - 8;
    const comfortHi = prefTemp + 2;

    if (precip > presentMean * 2.5) return 'storm';
    if (temp > FIRE_THRESHOLD && precip < 5) return 'fire';

    const tempScore = temp < idealLo
      ? Math.max(0, 1 - (idealLo - temp) / 8)
      : temp > comfortHi
      ? Math.max(0, 1 - (temp - comfortHi) / 4)
      : 1.0;

    const wetPenalty = Math.max(0, 1 - Math.exp(-precip / 25)) * prefDry;
    const sunPenalty = clt !== null ? Math.max(0, 1 - Math.exp(-clt / 40)) * prefSun : 0;
    const score = tempScore * (1 - wetPenalty * 0.8) * (1 - sunPenalty * 0.7);

    if (score < 0.25) return 'home';
    if (temp >= 20) return 'beach';
    return 'hike';
  }

  // ── Two-row SVG: 90-year avg (top) + recent 2005-2014 (bottom) ────
  const W = 900;
  const cardW = 68, cardH = 100, gap = 4;
  const totalW = 12 * cardW + 11 * gap;   // 860
  const startX = (W - totalW) / 2;        // 20
  const row1LabelY = 14, row1CardsY = 30;
  const row2LabelY = row1CardsY + cardH + 22;
  const row2CardsY = row2LabelY + 18;
  const svgH = row2CardsY + cardH + 14;

  const svg = d3.select('#chart-visit-rec')
    .append('svg').attr('viewBox', `0 0 ${W} ${svgH}`)
    .attr('role', 'img').attr('aria-label', 'Monthly activity recommendations, two time windows');

  svg.append('text').attr('x', startX).attr('y', row1LabelY + 11)
    .attr('font-size', 11).attr('font-weight', '600').attr('fill', '#5c6b7a')
    .text('90-year average (1925–2014)');
  svg.append('text').attr('x', startX).attr('y', row2LabelY + 11)
    .attr('font-size', 11).attr('font-weight', '600').attr('fill', '#0b6e99')
    .text('Recent decade (2005–2014)');

  function makeCardRow(data, cardsY, cls) {
    const g = svg.selectAll(`g.${cls}`)
      .data(data).join('g').attr('class', cls)
      .attr('transform', (_, i) => `translate(${startX + i * (cardW + gap)},${cardsY})`);

    g.append('rect').attr('class', `${cls}-bg`)
      .attr('width', cardW).attr('height', cardH).attr('rx', 5);
    g.append('text').attr('x', cardW / 2).attr('y', 14).attr('text-anchor', 'middle')
      .attr('font-size', 10).attr('font-weight', '700').attr('fill', '#1a2332')
      .text(d => MONTHS[d.month - 1]);
    g.append('text').attr('class', `${cls}-act`)
      .attr('x', cardW / 2).attr('y', 32).attr('text-anchor', 'middle')
      .attr('font-size', 9).attr('font-weight', '600').attr('fill', '#1a2332');
    g.append('text').attr('class', `${cls}-temp`)
      .attr('x', cardW / 2).attr('y', 48).attr('text-anchor', 'middle')
      .attr('font-size', 8).attr('fill', '#3d4f5e');
    g.append('rect').attr('x', 8).attr('y', 55)
      .attr('width', cardW - 16).attr('height', 3).attr('rx', 1.5)
      .attr('fill', 'rgba(26,35,50,0.12)');
    g.append('text').attr('class', `${cls}-precip`)
      .attr('x', cardW / 2).attr('y', 74).attr('text-anchor', 'middle')
      .attr('font-size', 8).attr('fill', '#5c6b7a');
    return g;
  }

  const histCards   = makeCardRow(monthAvg,      row1CardsY, 'hist-card');
  const recentCards = makeCardRow(recentMonthAvg, row2CardsY, 'recent-card');

  // Tooltip
  const tip = d3.select('.tooltip');
  [histCards, recentCards].forEach(group => {
    group.style('cursor', 'default')
      .on('mouseover', function(event, d) {
        const act = getActivity(d);
        tip.style('opacity', 1).html(
          `<strong>${MONTHS[d.month - 1]}</strong><br>` +
          `${ACTIVITY_LABEL[act]}<br>` +
          `${fmtTemp(d.temp)} · ${d.precip.toFixed(0)} mm rain` +
          (d.clt !== null ? `<br>${Math.round(100 - d.clt)}% sunny` : '')
        );
      })
      .on('mousemove', e => tip.style('left', (e.clientX + 14) + 'px').style('top', (e.clientY - 36) + 'px'))
      .on('mouseout', () => tip.style('opacity', 0));
  });

  // ── Update (called whenever prefs change) ───────────────────────────
  function updateRow(group, cls) {
    group.select(`rect.${cls}-bg`).transition().duration(350)
      .attr('fill', d => ACTIVITY_COLOR[getActivity(d)]);
    group.select(`text.${cls}-act`).text(d => ACTIVITY_LABEL[getActivity(d)]);
    group.select(`text.${cls}-temp`).text(d => fmtTemp(d.temp));
    group.select(`text.${cls}-precip`).text(d => `${d.precip.toFixed(0)} mm rain`);
  }

  function update() {
    updateRow(histCards,   'hist-card');
    updateRow(recentCards, 'recent-card');
  }

  _updateRecChart = update;  // expose for unit toggle
  update();

  // Hide sun slider until cloud data loads
  d3.select('#sun-pref-row').style('display', 'none');

  // Preference sliders
  const dryLabels = ['Rain ok', 'Drizzle ok', 'Moderate', 'Prefer dry', 'Must be dry'];
  const sunLabels = ['Love cloudy', 'Prefer cloudy', 'Moderate', 'Prefer sunny', 'Love sunny'];

  d3.select('#pref-temp').on('input', function() {
    prefTemp = +this.value;
    d3.select('#label-pref-temp').text(fmtTemp(prefTemp));
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

/* ── Future seasonal curve (mirrors page 2 format) ──────────────── */
let activeFutureVar = 'temp_c';

function chartFutureSeasonalCurve(containerId, present, future, variable) {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  const isTempF = variable === 'temp_c' && tempUnit === 'F';
  const toDisplay = isTempF ? v => (v != null ? v * 9 / 5 + 32 : null) : v => v;
  const toDisplayDelta = isTempF ? v => (v != null ? v * 9 / 5 : null) : v => v;

  const cfg = {
    temp_c:    {
      yLabel: tempUnit === 'F' ? 'Temperature (°F)' : 'Temperature (°C)',
      posColor: '#c44e52', negColor: '#4a90a4',
      unit: tempUnit === 'F' ? '°F' : '°C',
    },
    precip_mm: { yLabel: 'Precipitation (mm)', posColor: '#4a90a4', negColor: '#c4936a', unit: 'mm' },
    clt_pct:   { yLabel: 'Cloud cover (%)', posColor: '#9bb3c9', negColor: '#f4a261', unit: '%' },
  }[variable];

  const presentVals = present.map(d => d[variable]).filter(v => v != null).map(toDisplay);
  const futureVals  = future .map(d => d[variable]).filter(v => v != null).map(toDisplay);
  if (!futureVals.length) return;

  const allVals = [...presentVals, ...futureVals];
  const pad = Math.max((d3.max(allVals) - d3.min(allVals)) * 0.15, 1);

  const W = 900, H = 320;
  const xLeft = 58, xRight = W - 118;
  const top = 28, bot = 264;

  const svg = d3.select(container).append('svg')
    .attr('viewBox', `0 0 ${W} ${H}`)
    .attr('role', 'img')
    .attr('aria-label', `Projected ${cfg.yLabel}: today vs 2091-2100`);

  const x = d3.scalePoint().domain(d3.range(1, 13)).range([xLeft, xRight]).padding(0.3);
  const y = d3.scaleLinear()
    .domain([d3.min(allVals) - pad, d3.max(allVals) + pad])
    .range([bot, top]).nice();

  const curve = d3.curveCatmullRom.alpha(0.5);

  // Grid
  svg.append('g').attr('class', 'grid').attr('transform', `translate(${xLeft},0)`)
    .call(d3.axisLeft(y).tickSize(-(xRight - xLeft)).tickFormat('').ticks(5)).lower();

  // Axes
  svg.append('g').attr('class', 'axis').attr('transform', `translate(${xLeft},0)`)
    .call(d3.axisLeft(y).ticks(5))
    .append('text').attr('class', 'axis-label')
    .attr('transform', 'rotate(-90)').attr('x', -(bot - top) / 2 - top).attr('y', -44)
    .attr('fill', 'currentColor').attr('text-anchor', 'middle').text(cfg.yLabel);

  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${bot})`)
    .call(d3.axisBottom(x).tickFormat(i => MONTHS[i - 1]));

  const pByM    = new Map(present.map(d => [d.month, toDisplay(d[variable])]));
  const fByM    = new Map(future .map(d => [d.month, toDisplay(d[variable])]));
  const fStdByM = new Map(future .map(d => [d.month, toDisplayDelta(d[`${variable}_std`])]));
  const yDomain = y.domain();

  const lineGen = d3.line().x((_, i) => x(i + 1)).y(d => y(d))
    .defined(d => d != null).curve(curve);

  // ── Std-dev band (year-to-year variability) — fades in ───────────
  const bandData = d3.range(12).map(i => ({
    mean: fByM.get(i + 1),
    std:  fStdByM.get(i + 1),
  }));
  if (bandData.some(d => d.std != null)) {
    svg.append('path')
      .datum(bandData)
      .attr('fill', cfg.posColor).attr('fill-opacity', 0).attr('stroke', 'none')
      .attr('pointer-events', 'none')
      .attr('d', d3.area()
        .x((_, i) => x(i + 1))
        .y0(d => d.mean != null ? y(Math.max(yDomain[0], d.mean - (d.std || 0))) : 0)
        .y1(d => d.mean != null ? y(Math.min(yDomain[1], d.mean + (d.std || 0))) : 0)
        .defined(d => d.mean != null)
        .curve(curve)
      )
      .transition().delay(150).duration(600).ease(d3.easeCubicOut)
      .attr('fill-opacity', 0.13);
  }

  // Present dashed line — visible immediately (the baseline "today")
  svg.append('path').datum(d3.range(1, 13).map(m => pByM.get(m)))
    .attr('fill', 'none').attr('stroke', '#9bb3c9')
    .attr('stroke-width', 1.5).attr('stroke-dasharray', '5,4')
    .attr('pointer-events', 'none').attr('d', lineGen);

  const lastP = pByM.get(12);
  if (lastP != null)
    svg.append('text').attr('x', xRight + 6).attr('y', y(lastP)).attr('dy', '0.35em')
      .attr('fill', '#9bb3c9').attr('font-size', 10).text('now');

  // Future bold line — draws itself in left-to-right
  const futurePath = svg.append('path').datum(d3.range(1, 13).map(m => fByM.get(m)))
    .attr('fill', 'none').attr('stroke', cfg.posColor)
    .attr('stroke-width', 2.5).attr('stroke-linejoin', 'round')
    .attr('pointer-events', 'none').attr('d', lineGen);

  const futureLen = futurePath.node().getTotalLength();
  futurePath
    .attr('stroke-dasharray', futureLen)
    .attr('stroke-dashoffset', futureLen)
    .transition().delay(150).duration(900).ease(d3.easeLinear)
    .attr('stroke-dashoffset', 0);

  const lastF = fByM.get(12);
  if (lastF != null)
    svg.append('text').attr('x', xRight + 6).attr('y', y(lastF)).attr('dy', '0.35em')
      .attr('fill', cfg.posColor).attr('font-size', 10).attr('opacity', 0).text('2091–2100')
      .transition().delay(1000).duration(300).attr('opacity', 1);

  // Dots on future line — color by direction of change, tooltip shows std dev
  const tooltip = d3.select('.tooltip');
  d3.range(12).forEach(i => {
    const m = i + 1;
    const pVal = pByM.get(m);
    const fVal = fByM.get(m);
    const fStd = fStdByM.get(m);
    if (fVal == null) return;
    const isMore = pVal != null && fVal > pVal;
    const dotColor = variable === 'clt_pct'
      ? (isMore ? '#9bb3c9' : '#f4a261')
      : (isMore ? cfg.posColor : cfg.negColor);

    const dot = svg.append('circle').attr('cx', x(m)).attr('cy', y(fVal))
      .attr('r', 5).attr('fill', dotColor).attr('opacity', 0)
      .attr('stroke', '#fff').attr('stroke-width', 1.5).style('cursor', 'pointer')
      .on('mouseover', function(event) {
        const delta = pVal != null ? (fVal - pVal) : null;
        tooltip.style('opacity', 1).html(
          `<strong>${MONTHS[i]}</strong><br>` +
          `2091–2100 avg: ${fVal.toFixed(1)} ${cfg.unit}<br>` +
          (fStd != null ? `Year-to-year spread: ±${fStd.toFixed(1)} ${cfg.unit}<br>` : '') +
          (delta !== null ? `vs. today: ${delta > 0 ? '+' : ''}${delta.toFixed(1)} ${cfg.unit}` : '')
        );
      })
      .on('mousemove', e => tooltip.style('left', (e.clientX + 14) + 'px').style('top', (e.clientY - 36) + 'px'))
      .on('mouseout', () => tooltip.style('opacity', 0));

    dot.transition().delay(900 + i * 50).duration(200).attr('opacity', 1);

    // Present dot (smaller)
    if (pVal != null)
      svg.append('circle').attr('cx', x(m)).attr('cy', y(pVal))
        .attr('r', 3).attr('fill', '#9bb3c9').attr('pointer-events', 'none');
  });
}

/* ── Page 2 chart tab toggle ─────────────────────────────────────── */
function animateBoldLine(pane) {
  if (!pane) return;
  const boldLine = pane.querySelector('.current-year-line');
  if (!boldLine) return;
  const len = boldLine.getTotalLength();
  if (!len) return;
  d3.select(boldLine)
    .attr('stroke-dasharray', len)
    .attr('stroke-dashoffset', len)
    .transition().duration(900).ease(d3.easeLinear)
    .attr('stroke-dashoffset', 0)
    .on('end', () => {
      d3.select(boldLine).attr('stroke-dasharray', null).attr('stroke-dashoffset', null);
    });
}

function initChartTabs() {
  document.querySelectorAll('#page-3 .chart-tab-btn').forEach(btn => {
    btn.addEventListener('click', function () {
      const card = this.closest('.chart-toggled-card');
      card.querySelectorAll('.chart-tab-btn').forEach(b => b.classList.remove('active'));
      card.querySelectorAll('.chart-tab-pane').forEach(p => p.classList.remove('active'));
      this.classList.add('active');
      const pane = card.querySelector(`.chart-tab-pane[data-tab="${this.dataset.tab}"]`);
      pane.classList.add('active');
      animateBoldLine(pane);
    });
  });
}

/* ── Page 3 future variable toggle ───────────────────────────────── */
const futureVarDescriptions = {
  ssp126: {
    temp_c:    'About 1°C of average warming, felt mostly in fall and winter: October climbs 2.2°C and November 1.8°C. Summers shift only slightly, with August peaking around 25.8°C instead of today\'s 24.4°C. The seasonal rhythm of San Diego stays mostly intact, which is kind of the whole point of aggressive climate action.',
    precip_mm: 'December nearly doubles in rainfall (from 32.8mm to 62.4mm) while August loses almost all of its rain, dropping to just 1.8mm from today\'s 25.7mm. Total annual amounts stay similar but get compressed into fewer, wetter winter months. Year-to-year variability is still wide, so even this optimistic scenario sees unpredictable winters.',
    clt_pct:   'Cloud patterns shuffle but stay fairly close to today overall. August clears up by about 11 percentage points while June and September get cloudier. San Diego\'s marine layer holds on reasonably well here. Of the four futures, this one keeps the cloud cover pattern most similar to what we have now.',
  },
  ssp245: {
    temp_c:    'About 1.8°C of average warming, with fall getting hit hardest: October climbs 3.3°C and November 2.9°C. August reaches 26.3°C and September 25.7°C, stretching summer well into fall. June also warms 2°C, so the whole calendar shifts and San Diego starts feeling like it\'s running about a season ahead of schedule.',
    precip_mm: 'February nearly doubles from 61mm to 95.8mm, while January drops sharply from 64mm to just 34mm. Total annual rainfall ends up slightly below today, concentrated into fewer, more intense events. August also loses almost all its rain. Wet events get wetter and dry spells get longer, which drives both flash flood and drought risk up at the same time.',
    clt_pct:   'Cloud cover drops noticeably across most of the year, especially in winter. January loses over 10 percentage points and December loses about 8. Less cloud means more direct sunlight reaching the surface, which amplifies warming beyond what the temperature numbers alone suggest. Clearer skies sound appealing until you think about what they mean for heat.',
  },
  ssp370: {
    temp_c:    'About 2.65°C of average warming, with October jumping 4.6°C and November 3.7°C. August averages exactly 27°C, which is the fire risk threshold in this model. June warms nearly 3°C, shrinking the comfortable spring shoulder season to almost nothing. At this level, the compounding effects on wildfire, water supply, and outdoor livability start becoming hard to ignore.',
    precip_mm: 'February goes from 61mm to nearly 104mm, almost doubling, while August loses essentially all of its rain. December also gets wetter by about 24mm. The year-to-year spread is very wide throughout winter, meaning individual years could look wildly different from the average line. Boom-or-bust winters become the norm rather than the exception.',
    clt_pct:   'Cloud cover redistributes dramatically: July gains 12 percentage points and September gains 14, while January loses 11. Basically summer gets cloudier and winter gets clearer. The marine layer shifts its timing rather than disappearing altogether. Cloudier summers sound like cooling relief but they happen alongside much higher temperatures, so the surface still ends up hotter overall.',
  },
  ssp585: {
    temp_c:    'The biggest warming scenario at about 3.2°C on average, but fall and summer feel it most: October and November each jump 4.5°C, and August rises nearly 4°C to 28.3°C. Even January warms by 3.9°C. May reaches 20°C so beach-weather conditions arrive in spring. Basically every month would feel noticeably different to someone who grew up with San Diego\'s current climate.',
    precip_mm: 'January becomes extremely wet at 108mm, nearly double today\'s 64mm, while December dries out to just 10.8mm, basically a swap of two consecutive months. September also spikes with an extra 12mm out of nowhere. The shaded band is widest here across almost every month, meaning year-to-year unpredictability is at its highest and planning around rainfall becomes genuinely difficult.',
    clt_pct:   'Summer cloud cover jumps dramatically: July nearly doubles from 22% to 39%, September gains 14 percentage points, and June adds 13.5. Meanwhile March clears out significantly, losing 15.6 points. The cloudier summers might seem counterintuitive for the hottest scenario, but trapped heat still dominates. The seasonal pattern of San Diego\'s sky shifts so much it would feel almost unrecognizable.',
  },
};

function setFutureChartDesc(variable) {
  const el = document.getElementById('future-chart-desc');
  if (el) el.textContent = (futureVarDescriptions[activeScenario] || {})[variable] || '';
}

function initFutureChartTabs(sspData) {
  setFutureChartDesc('temp_c');
  document.querySelectorAll('.future-tab-btn').forEach(btn => {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.future-tab-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      activeFutureVar = this.dataset.var;
      setFutureChartDesc(activeFutureVar);
      if (sspData) {
        const present = sspData.filter(d => d.scenario.startsWith('present'));
        const future  = sspData.filter(d => d.scenario.startsWith(activeScenario));
        chartFutureSeasonalCurve('chart-future-seasonal', present, future, activeFutureVar);
      }
    });
  });
}

/* ── °C / °F toggle ─────────────────────────────────────────────── */
function initUnitToggle(sspData) {
  const btn = document.getElementById('unit-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    tempUnit = tempUnit === 'C' ? 'F' : 'C';
    btn.textContent = tempUnit === 'F' ? 'Switch to °C' : 'Switch to °F';
    btn.classList.toggle('active', tempUnit === 'F');

    // Update slider label
    const sl = document.getElementById('pref-temp');
    if (sl) d3.select('#label-pref-temp').text(fmtTemp(+sl.value));

    // Update pref-ends range labels
    const loEl = document.getElementById('pref-temp-lo');
    const hiEl = document.getElementById('pref-temp-hi');
    if (loEl) loEl.textContent = tempUnit === 'F' ? '64°F: Love cool days' : '18°C: Love cool days';
    if (hiEl) hiEl.textContent = tempUnit === 'F' ? '86°F: Love the heat'  : '30°C: Love the heat';

    // Update temp seasonal axis
    if (_updateTempSeasonalUnit) _updateTempSeasonalUnit();

    // Re-render rec cards
    if (_updateRecChart) _updateRecChart();

    // Re-render future cards
    if (sspData) updateFutureCharts(sspData);
  });
}

/* ── Weather illustration (page 1) ──────────────────────────────── */
function initWeatherIllustration() {
  const prefTempEl = document.getElementById('pref-temp');
  const prefDryEl  = document.getElementById('pref-dry');
  const prefSunEl  = document.getElementById('pref-sun');
  if (!prefTempEl) return;

  function update() {
    const pTemp = +prefTempEl.value;
    const pDry  = +prefDryEl.value;
    const pSun  = +prefSunEl.value;

    // Sky color: blue at 18°C → white at 24°C → red at 30°C
    const skyEl = document.getElementById('sky-rect');
    if (skyEl) {
      let r, g, b;
      if (pTemp <= 24) {
        const t = (pTemp - 18) / 6;
        r = Math.round(205 + t * (245 - 205));  // 205 → 245 (soft blue → near-white)
        g = Math.round(228 + t * (245 - 228));  // 228 → 245
        b = Math.round(255 + t * (255 - 255));  // 255 → 255
      } else {
        const t = (pTemp - 24) / 6;
        r = Math.round(245 + t * (255 - 245));  // 245 → 255 (near-white → soft warm)
        g = Math.round(245 + t * (210 - 245));  // 245 → 210
        b = Math.round(255 + t * (190 - 255));  // 255 → 190
      }
      skyEl.setAttribute('fill', `rgb(${r},${g},${b})`);
    }

    // Raindrops: visible when rain tolerance is low (rain ok = left side of slider)
    const rainOpacity = Math.max(0, 1 - pDry * 2.5);
    const rainEl = document.getElementById('illus-rain');
    if (rainEl) rainEl.setAttribute('opacity', rainOpacity.toFixed(2));

    // Sun vs clouds: sun appears above 0.5, clouds below 0.5
    const sunOpacity   = pSun >= 0.5 ? (pSun - 0.5) * 2 : 0;
    const cloudOpacity = pSun <= 0.5 ? 1 - pSun * 2   : 0;
    const sunEl    = document.getElementById('illus-sun');
    const cloudsEl = document.getElementById('illus-clouds');
    if (sunEl)    sunEl.setAttribute('opacity', sunOpacity.toFixed(2));
    if (cloudsEl) cloudsEl.setAttribute('opacity', cloudOpacity.toFixed(2));
  }

  function updateRecSummary() {
    const el = document.getElementById('rec-pref-summary');
    if (!el) return;
    const t = fmtTemp(+prefTempEl.value);
    const dryLabels = ['Rain ok', 'Rain ok-ish', 'Moderate', 'Prefer dry', 'Must be dry'];
    const sunLabels = ['Love clouds', 'Like clouds', 'Moderate', 'Like sun', 'Love sun'];
    const dI = Math.round(+prefDryEl.value / 0.25);
    const sI = Math.round(+prefSunEl.value / 0.25);
    el.innerHTML = `Ideal temp: <strong>${t}</strong> &nbsp;·&nbsp; Rain: <strong>${dryLabels[dI]}</strong> &nbsp;·&nbsp; Sun: <strong>${sunLabels[sI]}</strong>`;
  }

  prefTempEl.addEventListener('input', () => { update(); updateRecSummary(); });
  prefDryEl .addEventListener('input', () => { update(); updateRecSummary(); });
  prefSunEl .addEventListener('input', () => { update(); updateRecSummary(); });
  update();
  updateRecSummary();

  const personEl = document.getElementById('illus-person');
  if (personEl) {
    // Mark drop as done after it finishes so it never replays
    personEl.addEventListener('animationend', function onDrop(e) {
      if (e.animationName === 'stickman-drop') {
        personEl.classList.add('drop-done');
        personEl.removeEventListener('animationend', onDrop);
      }
    });

    personEl.addEventListener('click', () => {
      if (personEl.classList.contains('flipping')) return;
      personEl.classList.add('flipping');
      personEl.addEventListener('animationend', () => personEl.classList.remove('flipping'), { once: true });
    });
  }
}

/* ── Page navigation ─────────────────────────────────────────────── */
function initPageNav() {
  let current = 1;
  let page2Visited = false;

  function goTo(n) {
    document.querySelectorAll('.page').forEach((p, i) => {
      p.classList.toggle('active', i + 1 === n);
    });
    document.querySelectorAll('.step[data-page]').forEach(s => {
      const pg = +s.dataset.page;
      s.classList.toggle('active',    pg === n);
      s.classList.toggle('completed', pg < n);
    });
    current = n;
    document.querySelector('.page-container').scrollTop = 0;

    if (n === 3 && !page2Visited) {
      page2Visited = true;
      setTimeout(() => {
        const activePane = document.querySelector('#page-3 .chart-tab-pane.active');
        animateBoldLine(activePane);
      }, 80);
    }

    if (n === 5 && globalSspData) {
      updateFutureCharts(globalSspData);
    }

    if (n === 6 && globalSspData) {
      chartAllScenarios(globalSspData);
      chartTempAnomalyHeatmap(globalSspData);
    }
  }

  document.getElementById('btn-next-1').addEventListener('click', () => goTo(2));
  document.getElementById('btn-back-2').addEventListener('click', () => goTo(1));
  document.getElementById('btn-next-2').addEventListener('click', () => goTo(3));
  document.getElementById('btn-back-3').addEventListener('click', () => goTo(2));
  document.getElementById('btn-next-3').addEventListener('click', () => goTo(4));
  document.getElementById('btn-back-4').addEventListener('click', () => goTo(3));
  document.getElementById('btn-back-5').addEventListener('click', () => goTo(4));
  document.getElementById('btn-next-5').addEventListener('click', () => goTo(6));
  document.getElementById('btn-back-6').addEventListener('click', () => goTo(5));

  document.querySelectorAll('.step[data-page]').forEach(s => {
    s.addEventListener('click', () => goTo(+s.dataset.page));
  });

  globalGoTo = goTo;
}

/* ── Scenario selector (page 3) ─────────────────────────────────── */
let activeScenario = 'ssp585'; // default if user skips page 4

const SCENARIO_NAMES = {
  ssp126: 'Clean Future',
  ssp245: 'Middle Road',
  ssp370: 'High Emissions',
  ssp585: 'Fossil Future',
};
const SCENARIO_FULL = {
  ssp126: 'SSP 1-2.6 Clean Future',
  ssp245: 'SSP 2-4.5 Middle Road',
  ssp370: 'SSP 3-7.0 High Emissions',
  ssp585: 'SSP 5-8.5 Fossil Future',
};

const SCENARIO_COLORS = {
  ssp126: '#2a8c6e',
  ssp245: '#e8a030',
  ssp370: '#d9593a',
  ssp585: '#7a1020',
};

function updateP5Header() {
  const chipEl = document.getElementById('p5-chosen-name');
  const fullEl = document.getElementById('future-scenario-label');
  const col = SCENARIO_COLORS[activeScenario] || 'var(--accent)';
  if (chipEl) {
    chipEl.textContent = SCENARIO_NAMES[activeScenario] || activeScenario;
    chipEl.style.color = col;
    chipEl.style.borderColor = col;
    chipEl.onclick = () => document.getElementById('btn-back-5')?.click();
  }
  if (fullEl) fullEl.textContent = SCENARIO_FULL[activeScenario] || activeScenario;
}

function initScenarioSelector(sspData) {
  document.querySelectorAll('.scenario-card-v').forEach(btn => {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.scenario-card-v').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      activeScenario = this.dataset.ssp;
      updateP5Header();

      const col = SCENARIO_COLORS[activeScenario] || '#1571a8';
      const self = this;

      // Phase 1 (0ms): dim others, lift + glow the chosen card
      document.querySelectorAll('.scenario-card-v').forEach(b => {
        if (b !== self) {
          b.style.transition = 'opacity 0.22s ease, transform 0.22s ease';
          b.style.opacity = '0.18';
          b.style.transform = 'translateY(4px) scale(0.98)';
        } else {
          b.style.transition = 'transform 0.18s ease, box-shadow 0.18s ease';
          b.style.transform = 'scale(1.03)';
          b.style.boxShadow = `0 8px 36px ${col}60`;
        }
      });

      // Phase 2 (160ms): color wash floods in
      const overlay = document.createElement('div');
      overlay.style.cssText = `position:fixed;inset:0;z-index:9999;pointer-events:none;background:${col};opacity:0;transition:opacity 0.22s ease;`;
      document.body.appendChild(overlay);
      setTimeout(() => { overlay.style.opacity = '0.42'; }, 160);

      // Phase 3 (380ms): navigate at peak of wash, then wash fades out
      setTimeout(() => {
        globalGoTo?.(5);
        overlay.style.transition = 'opacity 0.35s ease';
        overlay.style.opacity = '0';
        setTimeout(() => {
          overlay.remove();
          document.querySelectorAll('.scenario-card-v').forEach(b => {
            b.style.opacity = '';
            b.style.transform = '';
            b.style.boxShadow = '';
            b.style.transition = '';
          });
        }, 380);
      }, 380);
    });
  });
}

/* ── Future charts (called once SSP data is available) ──────────── */
function updateFutureCharts(sspData) {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const ACTIVITY_COLOR = {
    beach: '#f4a261', hike: '#52b788', home: '#aac4d4',
    fire:  '#e63946', storm: '#457b9d',
  };
  const ACTIVITY_LABEL = {
    beach: 'Beach', hike: 'Hiking', home: 'Indoors',
    fire: 'Fire Risk', storm: 'Storm Risk',
  };

  const present = sspData.filter(d => d.scenario.startsWith('present'));
  const future  = sspData.filter(d => d.scenario.startsWith(activeScenario));

  updateP5Header();

  // ── Activity recommendation cards ─────────────────────────────────
  const recEl = document.getElementById('chart-future-rec');
  recEl.classList.remove('future-placeholder');
  recEl.innerHTML = '';

  const FIRE_THRESHOLD = 27;
  const _prefTemp = +document.getElementById('pref-temp').value;
  const prefDry   = +document.getElementById('pref-dry').value;
  const prefSun   = +document.getElementById('pref-sun').value;

  const presentPrecipByMonth = new Map(present.map(d => [d.month, d.precip_mm]));

  function getActivity(row) {
    const { temp_c: temp, precip_mm: precip, clt_pct: clt } = row;
    const presentMean = presentPrecipByMonth.get(row.month) ?? 0;
    const idealLo  = _prefTemp - 8;
    const comfortHi = _prefTemp + 2;

    if (precip > presentMean * 2.5) return 'storm';
    if (temp > FIRE_THRESHOLD && precip < 5) return 'fire';

    const tempScore = temp < idealLo
      ? Math.max(0, 1 - (idealLo - temp) / 8)
      : temp > comfortHi
      ? Math.max(0, 1 - (temp - comfortHi) / 4)
      : 1.0;
    const wetPenalty = Math.max(0, 1 - Math.exp(-precip / 25)) * prefDry;
    const sunPenalty = clt != null ? Math.max(0, 1 - Math.exp(-clt / 40)) * prefSun : 0;
    const score = tempScore * (1 - wetPenalty * 0.8) * (1 - sunPenalty * 0.7);
    if (score < 0.25) return 'home';
    if (temp >= 20) return 'beach';
    return 'hike';
  }

  // Layout constants — row labels sit above each card row
  const W = 900;
  const cardW = 68, cardH = 100, gap = 4;
  const totalW = 12 * cardW + 11 * gap;   // 860
  const startX = (W - totalW) / 2;        // 20 — enough room for cards, labels go above
  const row1LabelY = 16;
  const row1CardsY = 34;
  const row2LabelY = row1CardsY + cardH + 22;  // 156
  const row2CardsY = row2LabelY + 18;           // 174
  const svgH      = row2CardsY + cardH + 16;    // 290

  const recSvg = d3.select(recEl)
    .append('svg')
    .attr('viewBox', `0 0 ${W} ${svgH}`)
    .attr('role', 'img')
    .attr('aria-label', 'Monthly activity comparison: present vs. future');

  // Row labels above each row
  recSvg.append('text').attr('x', startX).attr('y', row1LabelY + 11)
    .attr('font-size', 11).attr('font-weight', '600').attr('fill', '#5c6b7a')
    .text('Today (2005–2014)');
  recSvg.append('text').attr('x', startX).attr('y', row2LabelY + 11)
    .attr('font-size', 11).attr('font-weight', '600').attr('fill', '#0b6e99')
    .text(`${SCENARIO_FULL[activeScenario] || activeScenario}, 2091–2100`);

  [
    { data: present, cardsY: row1CardsY },
    { data: future,  cardsY: row2CardsY },
  ].forEach(({ data, cardsY }) => {
    const cards = recSvg.selectAll(null)
      .data(data).join('g')
      .attr('transform', (_, i) => `translate(${startX + i * (cardW + gap)},${cardsY})`);

    cards.append('rect')
      .attr('width', cardW).attr('height', cardH).attr('rx', 5)
      .attr('fill', d => ACTIVITY_COLOR[getActivity(d)]);

    cards.append('text')
      .attr('x', cardW / 2).attr('y', 14).attr('text-anchor', 'middle')
      .attr('font-size', 10).attr('font-weight', '700').attr('fill', '#1a2332')
      .text(d => MONTHS[d.month - 1]);

    cards.append('text')
      .attr('x', cardW / 2).attr('y', 32).attr('text-anchor', 'middle')
      .attr('font-size', 9).attr('font-weight', '600').attr('fill', '#1a2332')
      .text(d => ACTIVITY_LABEL[getActivity(d)]);

    cards.append('text')
      .attr('x', cardW / 2).attr('y', 48).attr('text-anchor', 'middle')
      .attr('font-size', 8).attr('fill', '#3d4f5e')
      .text(d => fmtTemp(d.temp_c));

    cards.append('rect')
      .attr('x', 8).attr('y', 55).attr('width', cardW - 16).attr('height', 3)
      .attr('rx', 1.5).attr('fill', 'rgba(26,35,50,0.15)');

    cards.append('text')
      .attr('x', cardW / 2).attr('y', 74).attr('text-anchor', 'middle')
      .attr('font-size', 8).attr('fill', '#5c6b7a')
      .text(d => `${d.precip_mm.toFixed(0)} mm rain`);
  });

  // ── Future seasonal chart (same format as page 2) ─────────────────
  chartFutureSeasonalCurve('chart-future-seasonal', present, future, activeFutureVar);
  setFutureChartDesc(activeFutureVar);
  chartConsequences(activeScenario);
}

/* ── Page 5: Local consequence cards ────────────────────────────── */
// Severity and descriptions grounded in the model data:
// - Fire threshold 27°C: crossed only in ssp370 (Aug=27.0°C) and ssp585 (Aug=28.3°C)
// - October warming: ssp126=+2.2°C, ssp245=+3.3°C, ssp370=+4.6°C, ssp585=+4.5°C
// - Feb precip: ssp245 +35mm (+57%), ssp370 +43mm (+70%)
// - Jan precip: ssp585 +44mm (+68%), nearly doubles
// - IPCC AR6 sea level medians: ssp126~320mm, ssp245~440mm, ssp370~630mm, ssp585~900mm
const CONSEQ_DATA = {
  ssp126: [
    { id:'beach', title:'Beach Loss',       level:1, label:'Manageable',
      desc:'Seas rise ~0.3m by 2100. Most beaches narrow at exposed headlands but survive. The wide sandy stretches remain accessible.' },
    { id:'kelp',  title:'Kelp Forests',     level:1, label:'Manageable',
      desc:'Average warming of only +1°C. Summer ocean temps edge higher but stay within a range kelp can manage with good local conservation.' },
    { id:'flood', title:'Coastal Flooding', level:1, label:'Manageable',
      desc:'December gains ~30mm of rainfall but total annual amounts stay similar. Infrastructure handles most events without major disruption.' },
    { id:'fire',  title:'Wildfire Risk',    level:1, label:'Manageable',
      desc:'August reaches 25.8°C, well below the 27°C danger threshold. Wildfire seasons extend slightly at the edges but no critical line is crossed.' },
  ],
  ssp245: [
    { id:'beach', title:'Beach Loss',       level:2, label:'Notable',
      desc:'~0.4m rise. Narrower beaches face serious squeeze at exposed spots. Sections already backed by development become vulnerable to seasonal flooding.' },
    { id:'kelp',  title:'Kelp Forests',     level:2, label:'Notable',
      desc:'October alone jumps +3.3°C, extending warm-water months deep into fall. Kelp recovery between heat events becomes increasingly difficult to sustain.' },
    { id:'flood', title:'Coastal Flooding', level:2, label:'Notable',
      desc:'February nearly doubles in rainfall (+35mm, from 61 to 96mm). Individual storm events overwhelm drainage systems not built for this intensity.' },
    { id:'fire',  title:'Wildfire Risk',    level:2, label:'Notable',
      desc:'August hits 26.3°C, just 0.7°C below the 27°C fire threshold. October climbs 3.3°C. The region inches toward the edge without yet crossing it.' },
  ],
  ssp370: [
    { id:'beach', title:'Beach Loss',       level:3, label:'Significant',
      desc:'~0.6m rise crosses the threshold where many beaches get trapped between rising water and fixed seawalls. The squeeze accelerates dramatically.' },
    { id:'kelp',  title:'Kelp Forests',     level:3, label:'Significant',
      desc:'October surges +4.6°C above today. Sustained warm periods outpace kelp reproduction cycles; large-scale collapse of kelp forests becomes likely.' },
    { id:'flood', title:'Coastal Flooding', level:3, label:'Significant',
      desc:'February hits +43mm above today (+70%). Year-to-year variability also widens sharply: some years bring catastrophic floods, others almost nothing.' },
    { id:'fire',  title:'Wildfire Risk',    level:3, label:'Significant',
      desc:'August reaches exactly 27°C, crossing the fire threshold for the first time. October (+4.6°C) creates a dangerous second fire window late in fall.' },
  ],
  ssp585: [
    { id:'beach', title:'Beach Loss',       level:4, label:'Severe',
      desc:'~0.9m rise combined with intensified storm surge. Several of San Diego\'s iconic beaches become trapped and physically disappear by end of century.' },
    { id:'kelp',  title:'Kelp Forests',     level:4, label:'Severe',
      desc:'All months warmer by 3 to 4°C. Persistent high temperatures year-round prevent kelp recruitment. Ecosystem collapse becomes near-certain.' },
    { id:'flood', title:'Coastal Flooding', level:4, label:'Severe',
      desc:'January nearly doubles (+44mm). Added to ~0.9m sea level rise, low-lying areas like Imperial Beach face repeated inundation that becomes the norm.' },
    { id:'fire',  title:'Wildfire Risk',    level:4, label:'Severe',
      desc:'August hits 28.3°C, well above the 27°C threshold. August also loses 25mm of rain. Fire danger months are entrenched and far more extreme.' },
  ],
};

const ICONS = {
  beach:`<svg viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M2 22 Q9 14 18 22 Q27 30 34 22"/><path d="M2 28 Q9 20 18 28 Q27 36 34 28"/><rect x="2" y="30" width="32" height="4" rx="1" fill="currentColor" stroke="none" opacity="0.2"/></svg>`,
  kelp: `<svg viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M8 35 Q4 26 10 18 Q5 10 11 3"/><path d="M18 35 Q22 25 16 16 Q21 8 15 1"/><path d="M28 35 Q24 26 30 18 Q25 10 31 3"/></svg>`,
  flood:`<svg viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="12" width="18" height="14" rx="1"/><path d="M7 12 L18 4 L29 12"/><path d="M2 30 Q7 24 12 30 Q17 36 22 30 Q27 24 34 30"/></svg>`,
  fire: `<svg viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 34 Q6 26 10 17 Q14 9 12 3 Q20 11 18 20 Q26 11 24 3 Q32 13 28 23 Q33 19 31 27 Q29 34 18 34"/></svg>`,
};

const LEVEL_COLORS = ['','#2a8c6e','#e8a030','#d9593a','#7a1020'];

function chartConsequences(scenario) {
  const container = document.getElementById('consequence-grid');
  if (!container) return;
  const items = CONSEQ_DATA[scenario] || CONSEQ_DATA.ssp585;
  container.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'conseq-grid';

  items.forEach(item => {
    const col = LEVEL_COLORS[item.level];
    const dots = [1,2,3,4].map(l =>
      `<span class="sev-dot${l <= item.level ? ' on' : ''}" style="${l <= item.level ? `background:${col}` : ''}"></span>`
    ).join('');
    const card = document.createElement('div');
    card.className = 'conseq-card';
    card.style.borderColor = col + '55';
    card.innerHTML = `
      <div class="conseq-icon" style="color:${col}">${ICONS[item.id]}</div>
      <div class="conseq-body">
        <div class="conseq-header">
          <span class="conseq-title">${item.title}</span>
          <span class="conseq-level-badge" style="color:${col};border-color:${col}66;background:${col}12">${item.label}</span>
        </div>
        <div class="conseq-severity">${dots}</div>
        <p class="conseq-desc">${item.desc}</p>
      </div>`;
    grid.appendChild(card);
  });
  container.appendChild(grid);
}

/* ── Page 6: Temperature anomaly heatmap ────────────────────────── */
function chartTempAnomalyHeatmap(sspData) {
  const container = document.getElementById('chart-anomaly-heatmap');
  if (!container || !sspData) return;
  container.innerHTML = '';

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const SSPS = [
    { key:'ssp126', label:'Clean Future',   color:'#2a8c6e', warming:'+~1.8°C avg' },
    { key:'ssp245', label:'Middle Road',    color:'#e8a030', warming:'+~2.7°C avg' },
    { key:'ssp370', label:'High Emissions', color:'#d9593a', warming:'+~3.6°C avg' },
    { key:'ssp585', label:'Fossil Future',  color:'#7a1020', warming:'+~4.4°C avg' },
  ];
  const isTempF = tempUnit === 'F';

  const present = sspData.filter(d => d.scenario.startsWith('present'));
  const pByM = new Map(present.map(d => [d.month, d.temp_c]));

  // delta[monthIndex][scenarioIndex]
  const deltas = MONTHS.map((_, mi) => SSPS.map(s => {
    const row = sspData.find(d => d.scenario.startsWith(s.key) && d.month === mi + 1);
    const raw = row ? row.temp_c - pByM.get(mi + 1) : 0;
    return isTempF ? raw * 9 / 5 : raw;
  }));

  const allD = deltas.flat();
  const maxD = d3.max(allD);
  const colorScale = d3.scaleSequential([0, maxD], d3.interpolateRgb('#fff4ee', '#7a1020'));

  const W = 900;
  const labelW = 52, rightPad = 12;
  const cellW = Math.floor((W - labelW - rightPad) / 4);
  const cellH = 34, topH = 58;
  const H = topH + 12 * cellH + 28;

  const svg = d3.select(container).append('svg').attr('viewBox', `0 0 ${W} ${H}`);
  const tooltip = d3.select('.tooltip');

  // Column headers
  SSPS.forEach((s, si) => {
    const cx = labelW + si * cellW + cellW / 2;
    svg.append('rect')
      .attr('x', labelW + si * cellW + 3).attr('y', 4)
      .attr('width', cellW - 6).attr('height', topH - 8).attr('rx', 7)
      .attr('fill', s.color + '15').attr('stroke', s.color + '60').attr('stroke-width', 1.5);
    svg.append('text').attr('x', cx).attr('y', 22).attr('text-anchor', 'middle')
      .attr('font-size', 11.5).attr('font-weight', '700').attr('fill', s.color).text(s.label);
    svg.append('text').attr('x', cx).attr('y', 38).attr('text-anchor', 'middle')
      .attr('font-size', 9.5).attr('fill', s.color).attr('opacity', 0.8).text(s.warming);
  });

  // Month rows
  MONTHS.forEach((mon, mi) => {
    const rowY = topH + mi * cellH;
    svg.append('text').attr('x', labelW - 6).attr('y', rowY + cellH / 2)
      .attr('text-anchor', 'end').attr('dy', '0.35em')
      .attr('font-size', 11).attr('font-weight', '500').attr('fill', 'var(--muted)').text(mon);

    SSPS.forEach((s, si) => {
      const delta = deltas[mi][si];
      const cx = labelW + si * cellW;
      const fill = colorScale(delta);
      const darkCell = delta > maxD * 0.55;

      svg.append('rect')
        .attr('x', cx + 3).attr('y', rowY + 3)
        .attr('width', cellW - 6).attr('height', cellH - 6).attr('rx', 5)
        .attr('fill', fill).style('cursor', 'default')
        .on('mouseover', function(event) {
          tooltip.style('opacity', 1).html(
            `<strong>${mon} · ${s.label}</strong><br>+${delta.toFixed(2)}${isTempF ? '°F' : '°C'} warmer than today`
          );
        })
        .on('mousemove', e => tooltip.style('left', (e.clientX + 14) + 'px').style('top', (e.clientY - 36) + 'px'))
        .on('mouseout', () => tooltip.style('opacity', 0));

      svg.append('text')
        .attr('x', cx + cellW / 2).attr('y', rowY + cellH / 2).attr('dy', '0.35em')
        .attr('text-anchor', 'middle').attr('font-size', 11).attr('font-weight', '600')
        .attr('fill', darkCell ? '#fff' : '#1c2b3a')
        .text(`+${delta.toFixed(1)}${isTempF ? '°F' : '°C'}`);
    });
  });

}

/* ── Page 6: Sea level rise chart ────────────────────────────────── */
let seaLevelRendered = false;
async function chartSeaLevel() {
  if (seaLevelRendered) return;
  const container = document.getElementById('chart-sea-level');
  if (!container) return;

  const hist = await d3.csv('data/annual_sea_level.csv', d3.autoType).catch(() => null);
  if (!hist) return;
  seaLevelRendered = true;
  container.innerHTML = '';

  // Normalize so 1995-2014 mean = 0 (match IPCC baseline)
  const baseline = d3.mean(hist.filter(d => d.year >= 1995 && d.year <= 2014), d => d.zos_anomaly_mm);
  const histNorm = hist.map(d => ({ year: d.year, val: d.zos_anomaly_mm - baseline }));

  // IPCC AR6 median projections above 1995-2014 baseline (mm)
  const projections = [
    { key:'ssp126', color:'#2a8c6e', label:'Clean Future',   rise: 320 },
    { key:'ssp245', color:'#e8a030', label:'Middle Road',    rise: 440 },
    { key:'ssp370', color:'#d9593a', label:'High Emissions', rise: 630 },
    { key:'ssp585', color:'#7a1020', label:'Fossil Future',  rise: 900 },
  ];

  const W = 900, H = 260;
  const xLeft = 58, xRight = W - 80, top = 24, bot = 218;
  const xDomain = [1925, 2100];
  const allVals = histNorm.map(d => d.val).concat(projections.map(p => p.rise));
  const yPad = 40;

  const svg = d3.select(container).append('svg').attr('viewBox', `0 0 ${W} ${H}`);
  const x = d3.scaleLinear().domain(xDomain).range([xLeft, xRight]);
  const y = d3.scaleLinear().domain([d3.min(allVals) - yPad, d3.max(allVals) + yPad]).range([bot, top]).nice();
  const lineGen = d3.line().x(d => x(d.year)).y(d => y(d.val)).curve(d3.curveCatmullRom);

  svg.append('g').attr('class','grid').attr('transform',`translate(${xLeft},0)`)
    .call(d3.axisLeft(y).tickSize(-(xRight-xLeft)).tickFormat('').ticks(5)).lower();
  svg.append('g').attr('class','axis').attr('transform',`translate(${xLeft},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat(d => `${d>0?'+':''}${d}mm`))
    .append('text').attr('class','axis-label').attr('transform','rotate(-90)')
    .attr('x',-(bot-top)/2-top).attr('y',-50).attr('fill','currentColor').attr('text-anchor','middle')
    .text('Sea level anomaly (mm)');
  svg.append('g').attr('class','axis').attr('transform',`translate(0,${bot})`)
    .call(d3.axisBottom(x).tickFormat(d3.format('d')).tickValues([1925,1950,1975,2000,2025,2050,2075,2100]));

  // Zero line
  svg.append('line').attr('x1',xLeft).attr('x2',xRight).attr('y1',y(0)).attr('y2',y(0))
    .attr('stroke','var(--grid)').attr('stroke-width',1.5).attr('stroke-dasharray','4,3');

  // Historical solid line
  svg.append('path').datum(histNorm).attr('fill','none')
    .attr('stroke','var(--ink)').attr('stroke-width',2).attr('d',lineGen);

  const lastHist = histNorm[histNorm.length - 1];

  // Projected dashed lines from 2014 endpoint to 2100
  projections.forEach((p, pi) => {
    const projLine = d3.line().x(d => x(d.year)).y(d => y(d.val));
    const pts = [{ year: lastHist.year, val: lastHist.val }, { year: 2100, val: p.rise }];
    const path = svg.append('path').datum(pts)
      .attr('fill','none').attr('stroke', p.color).attr('stroke-width', 2)
      .attr('stroke-dasharray','6,4').attr('d', projLine);
    const len = path.node().getTotalLength();
    path.attr('stroke-dashoffset', len)
      .transition().delay(pi * 200).duration(900).ease(d3.easeLinear).attr('stroke-dashoffset', 0);

    // Endpoint dot + label
    svg.append('circle').attr('cx', x(2100)).attr('cy', y(p.rise)).attr('r', 5)
      .attr('fill', p.color).attr('opacity', 0)
      .transition().delay(pi * 200 + 900).duration(200).attr('opacity', 1);
    svg.append('text').attr('x', x(2100) + 8).attr('y', y(p.rise)).attr('dy','0.35em')
      .attr('font-size', 10).attr('fill', p.color).attr('font-weight','600')
      .attr('opacity', 0).text(`${p.label} (+${p.rise}mm)`)
      .transition().delay(pi * 200 + 1000).duration(200).attr('opacity', 1);
  });

  // "Historical" and "Projected" area labels
  svg.append('text').attr('x', x(1970)).attr('y', top + 12)
    .attr('font-size', 10).attr('fill','var(--muted)').attr('text-anchor','middle').text('Historical (model)');
  svg.append('text').attr('x', x(2060)).attr('y', top + 12)
    .attr('font-size', 10).attr('fill','var(--muted)').attr('text-anchor','middle').text('Projected (IPCC AR6)');
  svg.append('line').attr('x1', x(2014)).attr('x2', x(2014)).attr('y1', top + 4).attr('y2', bot)
    .attr('stroke','var(--grid)').attr('stroke-width',1).attr('stroke-dasharray','3,3');
}

/* ── Page 6: All scenarios temperature comparison ───────────────── */
function chartAllScenarios(sspData) {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const container = document.getElementById('chart-all-scenarios');
  if (!container || !sspData) return;
  container.innerHTML = '';

  const present = sspData.filter(d => d.scenario.startsWith('present'));
  const SSPS = [
    { key: 'ssp126', color: '#2a8c6e', label: 'SSP 1-2.6' },
    { key: 'ssp245', color: '#e8a030', label: 'SSP 2-4.5' },
    { key: 'ssp370', color: '#d9593a', label: 'SSP 3-7.0' },
    { key: 'ssp585', color: '#7a1020', label: 'SSP 5-8.5' },
  ];

  const isTempF = tempUnit === 'F';
  const toD = v => v != null ? (isTempF ? v * 9 / 5 + 32 : v) : null;
  const yLabel = isTempF ? 'Temperature (°F)' : 'Temperature (°C)';

  const pByM = new Map(present.map(d => [d.month, toD(d.temp_c)]));
  const allVals = [...present.map(d => toD(d.temp_c))];
  SSPS.forEach(s => {
    sspData.filter(d => d.scenario.startsWith(s.key)).forEach(d => allVals.push(toD(d.temp_c)));
  });

  const W = 900, H = 300;
  const xLeft = 58, xRight = W - 48, top = 24, bot = 248;
  const curve = d3.curveCatmullRom.alpha(0.5);

  const svg = d3.select(container).append('svg').attr('viewBox', `0 0 ${W} ${H}`);
  const x = d3.scalePoint().domain(d3.range(1, 13)).range([xLeft, xRight]).padding(0.3);
  const pad = (d3.max(allVals) - d3.min(allVals)) * 0.12;
  const y = d3.scaleLinear().domain([d3.min(allVals) - pad, d3.max(allVals) + pad]).range([bot, top]).nice();
  const lineGen = d3.line().x((_, i) => x(i + 1)).y(d => y(d)).defined(d => d != null).curve(curve);

  svg.append('g').attr('class', 'grid').attr('transform', `translate(${xLeft},0)`)
    .call(d3.axisLeft(y).tickSize(-(xRight - xLeft)).tickFormat('').ticks(5)).lower();
  svg.append('g').attr('class', 'axis').attr('transform', `translate(${xLeft},0)`)
    .call(d3.axisLeft(y).ticks(5))
    .append('text').attr('class', 'axis-label').attr('transform', 'rotate(-90)')
    .attr('x', -(bot - top) / 2 - top).attr('y', -44).attr('fill', 'currentColor').attr('text-anchor', 'middle').text(yLabel);
  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${bot})`)
    .call(d3.axisBottom(x).tickFormat(i => MONTHS[i - 1]));

  // Today — dashed
  svg.append('path').datum(d3.range(1, 13).map(m => pByM.get(m)))
    .attr('fill', 'none').attr('stroke', '#9bb3c9').attr('stroke-width', 1.5)
    .attr('stroke-dasharray', '5,4').attr('pointer-events', 'none').attr('d', lineGen);

  // Each future scenario — animated draw
  SSPS.forEach((s, si) => {
    const byM = new Map(sspData.filter(d => d.scenario.startsWith(s.key)).map(d => [d.month, toD(d.temp_c)]));
    const path = svg.append('path').datum(d3.range(1, 13).map(m => byM.get(m)))
      .attr('fill', 'none').attr('stroke', s.color).attr('stroke-width', 2.2).attr('stroke-linejoin', 'round')
      .attr('pointer-events', 'none').attr('d', lineGen);
    const len = path.node().getTotalLength();
    path.attr('stroke-dasharray', len).attr('stroke-dashoffset', len)
      .transition().delay(si * 180).duration(800).ease(d3.easeLinear).attr('stroke-dashoffset', 0);
  });
}

/* ── Page 6: Extreme weather risk chart ─────────────────────────── */
function chartExtremeRisk(sspData) {
  const container = document.getElementById('chart-extreme-risk');
  if (!container || !sspData) return;
  container.innerHTML = '';

  const SCENARIOS = [
    { key: 'present', label: 'Today',         color: '#9bb3c9' },
    { key: 'ssp126',  label: 'Clean Future',   color: '#2a8c6e' },
    { key: 'ssp245',  label: 'Middle Road',    color: '#e8a030' },
    { key: 'ssp370',  label: 'High Emissions', color: '#d9593a' },
    { key: 'ssp585',  label: 'Fossil Future',  color: '#7a1020' },
  ];
  const RISKS = [
    { key: 'fire',  label: 'Fire danger months', test: d => d.temp_c > 27 && d.precip_mm < 5 },
    { key: 'heat',  label: 'Extreme heat months', test: d => d.temp_c > 30 },
    { key: 'flood', label: 'Heavy rain months',   test: d => d.precip_mm > 80 },
  ];

  const data = SCENARIOS.map(s => {
    const months = sspData.filter(d => d.scenario.startsWith(s.key));
    const counts = {};
    RISKS.forEach(r => { counts[r.key] = months.filter(r.test).length; });
    return { ...s, ...counts };
  });

  const W = 900, H = 260;
  const xLeft = 160, xRight = W - 40, top = 20, bot = 220;
  const nScen = SCENARIOS.length;
  const nRisk = RISKS.length;
  const groupH = (bot - top) / nRisk;
  const barH = Math.min(22, groupH * 0.38);
  const barGap = barH * 0.35;
  const maxVal = d3.max(data, d => Math.max(d.fire, d.heat, d.flood));

  const svg = d3.select(container).append('svg').attr('viewBox', `0 0 ${W} ${H}`);
  const x = d3.scaleLinear().domain([0, Math.max(maxVal + 1, 4)]).range([xLeft, xRight]);

  // Gridlines
  svg.append('g').attr('class', 'grid').attr('transform', `translate(0,${bot})`)
    .call(d3.axisBottom(x).ticks(5).tickSize(-(bot - top)).tickFormat('')).lower();
  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${bot})`)
    .call(d3.axisBottom(x).ticks(5).tickFormat(d => `${d} mo`));

  const tooltip = d3.select('.tooltip');

  RISKS.forEach((risk, ri) => {
    const gy = top + ri * groupH + groupH / 2 - (nScen * (barH + barGap)) / 2;
    svg.append('text').attr('x', xLeft - 8).attr('y', gy + (nScen * (barH + barGap)) / 2)
      .attr('text-anchor', 'end').attr('dy', '0.35em')
      .attr('font-size', 11).attr('fill', 'var(--muted)').attr('font-weight', '600')
      .text(risk.label);

    data.forEach((scen, si) => {
      const barY = gy + si * (barH + barGap);
      const val = scen[risk.key];
      const bar = svg.append('rect')
        .attr('x', xLeft).attr('y', barY)
        .attr('width', 0).attr('height', barH).attr('rx', 3).attr('fill', scen.color)
        .style('cursor', 'pointer')
        .on('mouseover', function(event) {
          tooltip.style('opacity', 1).html(
            `<strong>${scen.label}</strong><br>${risk.label}: <strong>${val}</strong> month${val !== 1 ? 's' : ''}/yr`
          );
        })
        .on('mousemove', e => tooltip.style('left', (e.clientX + 14) + 'px').style('top', (e.clientY - 36) + 'px'))
        .on('mouseout', () => tooltip.style('opacity', 0));

      bar.transition().delay(ri * 120 + si * 60).duration(600).ease(d3.easeCubicOut)
        .attr('width', x(val) - xLeft);

      if (val > 0) {
        svg.append('text').attr('x', x(val) + 4).attr('y', barY + barH / 2).attr('dy', '0.35em')
          .attr('font-size', 10).attr('fill', 'var(--muted)').attr('opacity', 0).text(val)
          .transition().delay(ri * 120 + si * 60 + 600).duration(200).attr('opacity', 1);
      }
    });
  });

  // Scenario color legend on right
  const legX = xRight + 10, legY = top + 8;
  SCENARIOS.forEach((s, i) => {
    svg.append('rect').attr('x', legX - 64).attr('y', legY + i * 18).attr('width', 10).attr('height', 10).attr('rx', 2).attr('fill', s.color);
    svg.append('text').attr('x', legX - 50).attr('y', legY + i * 18 + 5).attr('dy', '0.35em')
      .attr('font-size', 9.5).attr('fill', 'var(--muted)').text(s.label);
  });
}

async function init() {
  const [meta, monthlyClimatology, cloudData, sspData] = await Promise.all([
    d3.json("data/metadata.json"),
    d3.csv("data/monthly_by_year.csv", d3.autoType),
    d3.csv("data/monthly_cloud.csv", d3.autoType).catch(() => null),
    d3.csv("data/ssp_monthly_climatology.csv", d3.autoType).catch(() => null),
  ]);

  if (meta) {
    d3.select("#meta-source").text(meta.source);
  }

  globalSspData = sspData;

  chartSeasonalCurve(monthlyClimatology);
  if (cloudData) chartCloudCurve(cloudData);
  chartVisitRecommendation(monthlyClimatology, cloudData);

  initPageNav();
  initChartTabs();
  initWeatherIllustration();
  initUnitToggle(sspData);
  initScenarioSelector(sspData);
  initFutureChartTabs(sspData);

  if (sspData) updateFutureCharts(sspData);
}

init().catch((err) => {
  console.error(err);
  document.getElementById('page-1').querySelector('.page-inner').insertAdjacentHTML(
    'afterbegin',
    `<p style="color:#c44e52;padding:1rem">Failed to load data. Run <code>python scripts/extract_cmip6.py</code> first.</p>`
  );
});
