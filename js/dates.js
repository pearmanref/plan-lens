// dates.js — pure date math. No drawing, no DOM.
// Every date is a UTC-midnight Date so local time zone / DST never shifts a day.
// Weekday index convention: 0 = Monday … 6 = Sunday (ISO order).
(function () {
  "use strict";
  const DAY = 86400000;
  const MONTHS = ["January","February","March","April","May","June","July",
                  "August","September","October","November","December"];
  const WD = ["MON","TUE","WED","THU","FRI","SAT","SUN"];
  const WD_LONG = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

  const ymd = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
  const addDays = (d, n) => new Date(d.getTime() + n * DAY);
  const dow = (d) => (d.getUTCDay() + 6) % 7;
  const Y = (d) => d.getUTCFullYear();
  const M = (d) => d.getUTCMonth() + 1;
  const D = (d) => d.getUTCDate();
  const same = (a, b) => a.getTime() === b.getTime();
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const iso = (d) => `${Y(d)}-${pad(M(d))}-${pad(D(d))}`;
  const parseISO = (s) => { const [y, m, d] = s.split("-").map(Number); return ymd(y, m, d || 1); };
  const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const dayOfYear = (d) => Math.round((d - ymd(Y(d), 1, 1)) / DAY) + 1;
  const addMonths = (y, m, n) => { const i = y * 12 + (m - 1) + n; return [Math.floor(i / 12), (i % 12) + 1]; };

  // ISO-8601 week: the week belongs to the year that contains its Thursday.
  function isoWeek(d) {
    const thu = addDays(d, 3 - dow(d));
    const y = Y(thu);
    const w = Math.floor((thu - ymd(y, 1, 1)) / DAY / 7) + 1;
    return { year: y, week: w };
  }
  const weekLabel = (d) => { const w = isoWeek(d); return `${w.year}-W${pad(w.week)}`; };

  // fw = first weekday (0 Mon, 6 Sun). Returns the 7 dates of the week holding `d`.
  function weekOf(d, fw) {
    const start = addDays(d, -((dow(d) - fw + 7) % 7));
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }

  // Rows of 7 real dates covering the month, padded with adjacent-month days.
  function monthGrid(y, m, fw) {
    const first = ymd(y, m, 1), last = ymd(y, m, daysInMonth(y, m));
    let cur = weekOf(first, fw)[0];
    const rows = [];
    while (cur <= last) {
      rows.push(Array.from({ length: 7 }, (_, i) => addDays(cur, i)));
      cur = addDays(cur, 7);
    }
    return rows;
  }

  const weekdayLabels = (fw) => WD.slice(fw).concat(WD.slice(0, fw));

  // UTC offset (minutes) of an IANA zone at a given instant. Uses the browser's
  // bundled tz database via Intl, so it works offline and follows DST.
  function tzOffsetMin(zone, instant) {
    const f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const p = Object.fromEntries(f.formatToParts(instant).map((x) => [x.type, x.value]));
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return Math.round((asUTC - instant.getTime()) / 60000);
  }
  // Difference zoneB - zoneA (minutes) at local noon of date d in zoneA.
  function tzDiffMin(zoneA, zoneB, d) {
    const noonUTC = new Date(d.getTime() + 12 * 3600000);
    const offA = tzOffsetMin(zoneA, noonUTC);
    const instant = new Date(noonUTC.getTime() - offA * 60000);
    return tzOffsetMin(zoneB, instant) - tzOffsetMin(zoneA, instant);
  }
  // Abbreviations are locale-dependent (en-US says "GMT+11" for Sydney, en-AU says "AEDT"),
  // so try several English locales and keep the first real abbreviation.
  const TZ_LOCALES = ["en-US", "en-AU", "en-GB", "en-IN", "en-NZ", "en-CA", "en-ZA", "en-SG"];
  function tzShort(zone, d) {
    const at = new Date(d.getTime() + 12 * 3600000);
    let fallback = zone;
    for (const loc of TZ_LOCALES) {
      try {
        const p = new Intl.DateTimeFormat(loc, { timeZone: zone, timeZoneName: "short" })
          .formatToParts(at).find((x) => x.type === "timeZoneName");
        if (!p) continue;
        if (!/^(GMT|UTC)/.test(p.value)) return p.value;
        if (fallback === zone) fallback = p.value.replace("GMT", "UTC");
      } catch { /* invalid zone */ }
    }
    return fallback;
  }

  window.PL = window.PL || {};
  window.PL.dates = {
    DAY, MONTHS, WD, WD_LONG, ymd, addDays, dow, Y, M, D, same, pad, iso, parseISO,
    daysInMonth, isLeap, dayOfYear, addMonths, isoWeek, weekLabel, weekOf, monthGrid,
    weekdayLabels, tzOffsetMin, tzDiffMin, tzShort,
  };
})();
