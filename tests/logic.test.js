const L = require('../logic.js');

let failures = 0;
function check(name, actual, expected, tol = 0.001) {
  const ok =
    typeof expected === 'number'
      ? Math.abs(actual - expected) <= tol
      : actual === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (got ${actual}, want ${expected})`);
  if (!ok) failures++;
}

// Known example from the spreadsheet: 12,000 mi/yr lease starting 2026-07-17,
// 101 miles logged by day 5 (2026-07-21) => net surplus +63.38.
const settings = {
  startDate: '2026-07-17',
  startOdometer: 0,
  annualAllowance: 12000,
  termMonths: 36,
};
const entries = [{ id: 'a', date: '2026-07-21', odometer: 101 }];
const s = L.computeStats(settings, entries, '2026-07-21');

check('daysElapsed (start date is day 1)', s.daysElapsed, 5);
check('dailyRate', s.dailyRate, 12000 / 365);
check('milesAllotted', s.milesAllotted, 164.3836, 0.001);
check('milesDriven', s.milesDriven, 101);
check('net surplus ≈ +63.4', s.surplus, 63.3836, 0.001);
check('totalAllowance', s.totalAllowance, 36000);
check('endDate', s.endDate, '2029-07-17');
check('totalDays', s.totalDays, 1096); // 2026-07-17 → 2029-07-17 spans a leap year
check('daysRemaining', s.daysRemaining, 1091);
check('paceNeeded', s.paceNeeded, (36000 - 101) / 1091, 0.001);
check('trend last surplus', s.trend[0].surplus, 63.3836, 0.001);
check('delta for entry', s.deltas['a'], 101);

// Non-zero starting odometer
const s2 = L.computeStats(
  { ...settings, startOdometer: 10 },
  [{ id: 'a', date: '2026-07-21', odometer: 111 }],
  '2026-07-21'
);
check('milesDriven with startOdometer', s2.milesDriven, 101);

// Before lease start: clamp to 0
const s3 = L.computeStats(settings, [], '2026-07-01');
check('daysElapsed clamps at 0', s3.daysElapsed, 0);
check('surplus 0 before start', s3.surplus, 0);

// After lease end: clamp to totalDays
const s4 = L.computeStats(settings, [], '2030-01-01');
check('daysElapsed clamps at totalDays', s4.daysElapsed, 1096);
check('paceNeeded 0 at lease end', s4.paceNeeded, 0);

// Multiple entries: latest by date wins; deltas are between consecutive readings
const s5 = L.computeStats(
  settings,
  [
    { id: 'b', date: '2026-08-01', odometer: 400 },
    { id: 'a', date: '2026-07-21', odometer: 101 },
  ],
  '2026-08-01'
);
check('latest entry odometer', s5.latestEntry.odometer, 400);
check('delta second entry', s5.deltas['b'], 299);
check('trend is date-sorted', s5.trend[0].id, 'a');

// Month-end clamping in addMonths
check('addMonths clamps day', L.addMonths('2026-01-31', 1), '2026-02-28');
check('addMonths leap year', L.addMonths('2028-01-31', 1), '2028-02-29');

// Whole-lease projections (avg pace 101/5 = 20.2 mi/day)
check('avgPace', s.avgPace, 20.2);
check('projectedDriven', s.projectedDriven, 20.2 * 1096, 0.01);
check('projectedEndSurplus', s.projectedEndSurplus, 36000 - 20.2 * 1096, 0.01);
check('remainingAllowance', s.remainingAllowance, 35899);

// Odometer interpolation
const iSet = { ...settings };
const iEntries = [
  { id: 'a', date: '2026-07-21', odometer: 100 },
  { id: 'b', date: '2026-07-31', odometer: 200 },
];
check('interp before start', L.odometerAtDate(iSet, iEntries, '2026-07-01'), 0);
check('interp at reading', L.odometerAtDate(iSet, iEntries, '2026-07-21'), 100);
check('interp midway', L.odometerAtDate(iSet, iEntries, '2026-07-26'), 150);
check('interp after last (no extrapolation)', L.odometerAtDate(iSet, iEntries, '2027-01-01'), 200);

// Per-year stats at day 5: year 1 current, years 2–3 upcoming
const ys = L.computeYearStats(settings, entries, '2026-07-21');
check('year count', ys.length, 3);
check('y1 status', ys[0].status, 'current');
check('y1 range', ys[0].startDate + '..' + ys[0].endDate, '2026-07-17..2027-07-16');
check('y1 days (365)', ys[0].days, 365);
check('y1 allowance', ys[0].allowance, 12000);
check('y1 driven', ys[0].driven, 101);
check('y1 surplus matches lease surplus in year 1', ys[0].surplus, 63.3836, 0.001);
check('y1 avgPace', ys[0].avgPace, 20.2);
check('y1 projected', ys[0].projectedDriven, 20.2 * 365, 0.01);
check('y1 paceNeeded', ys[0].paceNeeded, (12000 - 101) / 360, 0.001);
check('y2 status', ys[1].status, 'upcoming');
check('y2 days (366, leap 2028)', ys[1].days, 366);
check('y2 allowance accrual', ys[1].allowance, (12000 / 365) * 366, 0.001);
check('y3 range', ys[2].startDate + '..' + ys[2].endDate, '2028-07-17..2029-07-16');
check('y3 days', ys[2].days, 365);

// A completed year attributes miles by interpolation across the boundary
const ys2 = L.computeYearStats(
  settings,
  [
    { id: 'a', date: '2027-07-06', odometer: 11000 },  // 11 days before y1 ends
    { id: 'b', date: '2027-07-26', odometer: 12000 },  // 10 days into y2
  ],
  '2027-07-26'
);
// boundary 2027-07-16 is 10/20 between readings → odo 11500
check('y1 complete status', ys2[0].status, 'complete');
check('y1 driven via interpolation', ys2[0].driven, 11500);
check('y2 driven via interpolation', ys2[1].driven, 500);
check('y2 current status', ys2[1].status, 'current');

// OCR extraction
check('extract "Odometer 101 mi"', L.extractOdometer('Odometer 101 mi').value, 101);
check('extract high confidence', L.extractOdometer('Odometer 101 mi').confidence, 'high');
check('extract with comma', L.extractOdometer('Odometer 12,345 mi').value, 12345);
check('extract label only', L.extractOdometer('Odometer 8,210\nFuel 80%').value, 8210);
check('extract number+mi only', L.extractOdometer('blah 4,502 mi blah').value, 4502);
check(
  'extract fallback largest number',
  L.extractOdometer('80% 12345 42').value,
  12345
);
check('extract fallback is low confidence', L.extractOdometer('80% 12345 42').confidence, 'low');
check('extract nothing', L.extractOdometer('no numbers here'), null);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll tests passed.');
process.exit(failures ? 1 : 0);
