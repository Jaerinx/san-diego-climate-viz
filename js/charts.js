/* ── Global unit state ───────────────────────────────────────────────── */
let tempUnit = 'C';               // 'C' or 'F'
let _updateRecChart = null;       // exposed from chartVisitRecommendation closure
let _updateTempSeasonalUnit = null; // exposed from chartSeasonalCurve closure

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
  const xLeft = 58, xRight = W - 48;
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

  // ── Std-dev band (year-to-year variability) ───────────────────────
  const bandData = d3.range(12).map(i => ({
    mean: fByM.get(i + 1),
    std:  fStdByM.get(i + 1),
  }));
  if (bandData.some(d => d.std != null)) {
    svg.append('path')
      .datum(bandData)
      .attr('fill', cfg.posColor).attr('fill-opacity', 0.13).attr('stroke', 'none')
      .attr('pointer-events', 'none')
      .attr('d', d3.area()
        .x((_, i) => x(i + 1))
        .y0(d => d.mean != null ? y(Math.max(yDomain[0], d.mean - (d.std || 0))) : 0)
        .y1(d => d.mean != null ? y(Math.min(yDomain[1], d.mean + (d.std || 0))) : 0)
        .defined(d => d.mean != null)
        .curve(curve)
      );
  }

  // Present dashed line
  svg.append('path').datum(d3.range(1, 13).map(m => pByM.get(m)))
    .attr('fill', 'none').attr('stroke', '#9bb3c9')
    .attr('stroke-width', 1.5).attr('stroke-dasharray', '5,4')
    .attr('pointer-events', 'none').attr('d', lineGen);

  const lastP = pByM.get(12);
  if (lastP != null)
    svg.append('text').attr('x', xRight + 6).attr('y', y(lastP)).attr('dy', '0.35em')
      .attr('fill', '#9bb3c9').attr('font-size', 10).text('now');

  // Future bold line
  svg.append('path').datum(d3.range(1, 13).map(m => fByM.get(m)))
    .attr('fill', 'none').attr('stroke', cfg.posColor)
    .attr('stroke-width', 2.5).attr('stroke-linejoin', 'round')
    .attr('pointer-events', 'none').attr('d', lineGen);

  const lastF = fByM.get(12);
  if (lastF != null)
    svg.append('text').attr('x', xRight + 6).attr('y', y(lastF)).attr('dy', '0.35em')
      .attr('fill', cfg.posColor).attr('font-size', 10).text('2091–2100');

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

    svg.append('circle').attr('cx', x(m)).attr('cy', y(fVal))
      .attr('r', 5).attr('fill', dotColor)
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

    // Present dot (smaller)
    if (pVal != null)
      svg.append('circle').attr('cx', x(m)).attr('cy', y(pVal))
        .attr('r', 3).attr('fill', '#9bb3c9').attr('pointer-events', 'none');
  });
}

/* ── Page 2 chart tab toggle ─────────────────────────────────────── */
function initChartTabs() {
  document.querySelectorAll('.chart-tab-btn').forEach(btn => {
    btn.addEventListener('click', function () {
      const card = this.closest('.chart-toggled-card');
      card.querySelectorAll('.chart-tab-btn').forEach(b => b.classList.remove('active'));
      card.querySelectorAll('.chart-tab-pane').forEach(p => p.classList.remove('active'));
      this.classList.add('active');
      card.querySelector(`.chart-tab-pane[data-tab="${this.dataset.tab}"]`).classList.add('active');
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

    // Heat overlay: 0 at 18°C → 0.30 at 30°C
    const heatOpacity = ((pTemp - 18) / 12) * 0.30;
    const heatEl = document.getElementById('heat-overlay');
    if (heatEl) heatEl.setAttribute('opacity', heatOpacity.toFixed(3));

    // Sky color: cooler blue at 18°C, warmer/hazier at 30°C
    const skyEl = document.getElementById('sky-rect');
    if (skyEl) {
      const r = Math.round(185 + (pTemp - 18) / 12 * 60);
      const g = Math.round(225 - (pTemp - 18) / 12 * 20);
      const b = Math.round(255 - (pTemp - 18) / 12 * 100);
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

  prefTempEl.addEventListener('input', update);
  prefDryEl .addEventListener('input', update);
  prefSunEl .addEventListener('input', update);
  update();

  const personEl = document.getElementById('illus-person');
  if (personEl) {
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
  }

  document.getElementById('btn-next-1').addEventListener('click', () => goTo(2));
  document.getElementById('btn-back-2').addEventListener('click', () => goTo(1));
  document.getElementById('btn-next-2').addEventListener('click', () => goTo(3));
  document.getElementById('btn-back-3').addEventListener('click', () => goTo(2));

  // Step numbers are always clickable — free navigation
  document.querySelectorAll('.step[data-page]').forEach(s => {
    s.addEventListener('click', () => goTo(+s.dataset.page));
  });
}

/* ── Scenario selector (page 3) ─────────────────────────────────── */
let activeScenario = 'ssp585';

function initScenarioSelector(sspData) {
  document.querySelectorAll('.scenario-btn').forEach(btn => {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.scenario-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      activeScenario = this.dataset.ssp;
      if (sspData) updateFutureCharts(sspData);
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

  const labelMap = {
    ssp126: 'SSP 1-2.6 Clean Future',
    ssp245: 'SSP 2-4.5 Middle Road',
    ssp370: 'SSP 3-7.0 High Emissions',
    ssp585: 'SSP 5-8.5 Fossil Future',
  };
  d3.select('#future-scenario-label').text(`${labelMap[activeScenario]} — 2091–2100`);

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
    .text(`${labelMap[activeScenario]} — 2091–2100`);

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
