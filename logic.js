/* Core lease-mileage math. Pure functions, no DOM — shared by the app and tests.
   All dates are "YYYY-MM-DD" strings, computed in UTC so DST never shifts a day. */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MileageLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const MS_PER_DAY = 86400000;

  function parseDate(str) {
    const [y, m, d] = str.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  }

  function formatDate(utcMs) {
    const d = new Date(utcMs);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  }

  function diffDays(aStr, bStr) {
    return Math.round((parseDate(aStr) - parseDate(bStr)) / MS_PER_DAY);
  }

  // Calendar-aware month add; day-of-month clamps (Jan 31 + 1mo = Feb 28/29).
  function addMonths(dateStr, months) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const targetMonth = m - 1 + months;
    const ty = y + Math.floor(targetMonth / 12);
    const tm = ((targetMonth % 12) + 12) % 12;
    const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
    return formatDate(Date.UTC(ty, tm, Math.min(d, lastDay)));
  }

  function clamp(v, lo, hi) {
    return Math.min(Math.max(v, lo), hi);
  }

  /**
   * settings: { startDate, startOdometer, annualAllowance, termMonths }
   * entries:  [{ id, date, odometer }] in any order
   * todayStr: "YYYY-MM-DD"
   */
  function computeStats(settings, entries, todayStr) {
    const { startDate, startOdometer, annualAllowance, termMonths } = settings;
    const endDate = addMonths(startDate, termMonths);
    const totalDays = diffDays(endDate, startDate);
    // Lease start date counts as day 1 (a full day's allotment accrues on day 1).
    const daysElapsed = clamp(diffDays(todayStr, startDate) + 1, 0, totalDays);
    const daysRemaining = totalDays - daysElapsed;
    const dailyRate = annualAllowance / 365;
    const totalAllowance = annualAllowance * (termMonths / 12);
    const milesAllotted = dailyRate * daysElapsed;

    const sorted = [...entries].sort(
      (a, b) => parseDate(a.date) - parseDate(b.date) || a.odometer - b.odometer
    );
    const latest = sorted.length ? sorted[sorted.length - 1] : null;
    const milesDriven = latest ? latest.odometer - startOdometer : 0;

    const surplus = milesAllotted - milesDriven;
    const paceNeeded =
      daysRemaining > 0 ? (totalAllowance - milesDriven) / daysRemaining : 0;

    // Surplus/deficit as of each logged entry, for the trend view.
    const trend = sorted.map((e) => {
      const elapsedAt = clamp(diffDays(e.date, startDate) + 1, 0, totalDays);
      return {
        id: e.id,
        date: e.date,
        odometer: e.odometer,
        milesDriven: e.odometer - startOdometer,
        surplus: dailyRate * elapsedAt - (e.odometer - startOdometer),
      };
    });

    // Miles driven between consecutive readings (for the history list).
    const deltas = {};
    let prevOdo = startOdometer;
    for (const e of sorted) {
      deltas[e.id] = e.odometer - prevOdo;
      prevOdo = e.odometer;
    }

    // Whole-lease projections at the actual average pace so far.
    const avgPace = daysElapsed > 0 ? milesDriven / daysElapsed : 0;
    const projectedDriven = avgPace * totalDays;

    return {
      endDate,
      totalDays,
      daysElapsed,
      daysRemaining,
      dailyRate,
      totalAllowance,
      milesAllotted,
      milesDriven,
      surplus,
      paceNeeded,
      avgPace,
      projectedDriven,
      projectedEndSurplus: totalAllowance - projectedDriven,
      remainingAllowance: totalAllowance - milesDriven,
      pctMilesUsed: totalAllowance > 0 ? (milesDriven / totalAllowance) * 100 : 0,
      pctTimeElapsed: totalDays > 0 ? (daysElapsed / totalDays) * 100 : 0,
      latestEntry: latest,
      trend,
      deltas,
    };
  }

  /* Odometer estimate on an arbitrary date: linear interpolation between the
     readings that surround it. Before the lease start → starting odometer;
     after the last reading → last reading (no extrapolation into the future). */
  function odometerAtDate(settings, entries, dateStr) {
    const points = [
      { date: settings.startDate, odometer: settings.startOdometer },
      ...[...entries].sort(
        (a, b) => parseDate(a.date) - parseDate(b.date) || a.odometer - b.odometer
      ),
    ];
    const t = parseDate(dateStr);
    if (t <= parseDate(points[0].date)) return points[0].odometer;
    for (let i = 1; i < points.length; i++) {
      const cur = parseDate(points[i].date);
      if (t <= cur) {
        const prev = parseDate(points[i - 1].date);
        if (cur === prev) return points[i].odometer;
        const f = (t - prev) / (cur - prev);
        return points[i - 1].odometer + f * (points[i].odometer - points[i - 1].odometer);
      }
    }
    return points[points.length - 1].odometer;
  }

  /* Per-lease-year breakdown. Year N runs from start+12(N−1) months to
     start+12N months (the last segment may be shorter). Allotment accrues at
     the same daily rate as the lease total, so a 366-day year earns slightly
     more than the nominal annual allowance — consistent with the daily model. */
  function computeYearStats(settings, entries, todayStr) {
    const { startDate, annualAllowance, termMonths } = settings;
    const dailyRate = annualAllowance / 365;
    const years = Math.ceil(termMonths / 12);
    const segments = [];
    for (let i = 1; i <= years; i++) {
      const segStart = addMonths(startDate, 12 * (i - 1));
      const segEnd = addMonths(startDate, Math.min(12 * i, termMonths));
      const days = diffDays(segEnd, segStart);
      // Same day-1 convention as the lease: the segment's first day accrues fully.
      const daysElapsed = clamp(diffDays(todayStr, segStart) + 1, 0, days);
      const status =
        daysElapsed <= 0 ? 'upcoming' : daysElapsed >= days ? 'complete' : 'current';
      // Segment end boundary is the day before segEnd (segEnd = next year's day 1).
      const endOdo = odometerAtDate(
        settings, entries,
        status === 'current' ? todayStr : formatDate(parseDate(segEnd) - MS_PER_DAY)
      );
      const startOdo = odometerAtDate(
        settings, entries, formatDate(parseDate(segStart) - MS_PER_DAY)
      );
      const driven = Math.max(0, endOdo - startOdo);
      const allowance = dailyRate * days;
      const allottedToDate = dailyRate * daysElapsed;
      const daysLeft = days - daysElapsed;
      const avgPace = daysElapsed > 0 ? driven / daysElapsed : 0;
      segments.push({
        index: i,
        startDate: segStart,
        endDate: formatDate(parseDate(segEnd) - MS_PER_DAY),
        days,
        daysElapsed,
        daysLeft,
        status,
        allowance,
        allottedToDate,
        driven,
        surplus: allottedToDate - driven,
        avgPace,
        projectedDriven: status === 'current' ? avgPace * days : driven,
        paceNeeded: daysLeft > 0 ? (allowance - driven) / daysLeft : 0,
        pctUsed: allowance > 0 ? (driven / allowance) * 100 : 0,
        pctTime: days > 0 ? (daysElapsed / days) * 100 : 0,
      });
    }
    return segments;
  }

  /* Extract an odometer value from OCR text. The Toyota app shows
     "Odometer 101 mi" at the top of the screen. Returns
     { value, confidence: 'high'|'medium'|'low' } or null. */
  function extractOdometer(text) {
    if (!text) return null;
    const clean = text.replace(/[Oo](?=\d)/g, '0'); // O misread as digit-adjacent
    // High confidence: number sandwiched between "Odometer" and "mi".
    let m = clean.match(/odometer\D{0,12}?([\d][\d,]*)\s*mi\b/i);
    if (m) return { value: toNum(m[1]), confidence: 'high' };
    // Medium: number right after "Odometer".
    m = clean.match(/odometer\D{0,12}?([\d][\d,]*)/i);
    if (m) return { value: toNum(m[1]), confidence: 'medium' };
    // Medium: number followed by "mi".
    m = clean.match(/([\d][\d,]*)\s*mi\b/i);
    if (m) return { value: toNum(m[1]), confidence: 'medium' };
    // Low: largest standalone number in the text.
    const nums = clean.match(/[\d][\d,]*/g);
    if (nums) {
      const vals = nums.map(toNum).filter((n) => n > 0 && n < 1000000);
      if (vals.length) return { value: Math.max(...vals), confidence: 'low' };
    }
    return null;

    function toNum(s) {
      return parseInt(s.replace(/,/g, ''), 10);
    }
  }

  return { parseDate, formatDate, diffDays, addMonths, clamp, computeStats, computeYearStats, odometerAtDate, extractOdometer };
});
