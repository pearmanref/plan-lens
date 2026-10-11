// render.js — page layouts. Pure geometry against the surface API (see surfaces.js).
//
// Flow:  config ──planJobs()──▶ [job, job, …] ──renderJob(surface, job)──▶ page
// planJobs decides WHICH pages exist; render* decides WHAT a page looks like.
// Adding a page type = one render function + one branch in planJobs.
(function () {
  "use strict";
  const T = PL.dates;

  const PAPERS = {
    letter: { label: "US Letter · 8.5×11 in", w: 612, h: 792 },
    a4: { label: "A4 · 210×297 mm", w: 595.28, h: 841.89 },
    half: { label: "Half Letter · 5.5×8.5 in", w: 396, h: 612 },
    a5: { label: "A5 · 148×210 mm", w: 419.53, h: 595.28 },
  };
  const MAX_PAGES = 400;

  function palette(cfg) {
    return {
      ink: "#16191D", muted: "#7A8491", faint: "#C9CFD6", wash: "#F2F4F6",
      accent: cfg.accent || "#2F6690",
    };
  }

  function pageSize(cfg) {
    const p = PAPERS[cfg.paper] || PAPERS.letter;
    const def = cfg.layout === "month" ? "landscape" : "portrait";
    const o = cfg.orient === "auto" ? def : cfg.orient;
    return o === "landscape" ? { w: p.h, h: p.w } : { w: p.w, h: p.h };
  }

  // ── job planning ──────────────────────────────────────────────────────
  function planJobs(cfg) {
    const jobs = [];
    const fw = +cfg.weekStart;
    if (cfg.layout === "month") {
      let [y, m] = cfg.monthFrom.split("-").map(Number);
      const [y1, m1] = cfg.monthTo.split("-").map(Number);
      while ((y < y1 || (y === y1 && m <= m1)) && jobs.length < MAX_PAGES) {
        jobs.push({ kind: "month", y, m });
        [y, m] = T.addMonths(y, m, 1);
      }
    } else {
      const a = T.parseISO(cfg.dateFrom), b = T.parseISO(cfg.dateTo);
      if (cfg.layout === "day") {
        for (let d = a; d <= b && jobs.length < MAX_PAGES; d = T.addDays(d, 1)) jobs.push({ kind: "day", d });
      } else {
        // every week that touches the range
        for (let w = T.weekOf(a, fw)[0]; w <= b && jobs.length < MAX_PAGES; w = T.addDays(w, 7))
          jobs.push({ kind: "week", days: T.weekOf(w, fw), from: a, to: b });
      }
    }
    return jobs;
  }

  function fileName(cfg) {
    if (cfg.layout === "month")
      return `month_${cfg.monthFrom}${cfg.monthTo !== cfg.monthFrom ? "_to_" + cfg.monthTo : ""}.pdf`;
    const tag = cfg.layout === "day" ? "days" : "weeks";
    return `${tag}_${cfg.dateFrom}${cfg.dateTo !== cfg.dateFrom ? "_to_" + cfg.dateTo : ""}.pdf`;
  }

  // ── shared pieces ─────────────────────────────────────────────────────
  // Mini month: fixed 8 rows (title, weekday letters, 6 weeks) so minis align.
  function miniMonth(s, C, box, y, m, fw, highlight) {
    const rows = T.monthGrid(y, m, fw);
    const lh = box.h / 8, cw = box.w / 7;
    const fs = Math.min(lh * 0.62, cw * 0.55);
    s.text(box.x, box.y + lh * 0.8, `${T.MONTHS[m - 1].slice(0, 3).toUpperCase()} ${y}`, { bold: true, size: fs, color: C.ink });
    T.weekdayLabels(fw).forEach((l, i) =>
      s.text(box.x + cw * (i + 0.5), box.y + lh * 1.8, l[0], { size: fs * 0.9, color: C.muted, align: "center" }));
    const hl = (highlight || []).map((d) => d.getTime());
    rows.forEach((week, r) => {
      const yb = box.y + lh * (2.8 + r);
      if (hl.length && week.some((d) => hl.includes(d.getTime()))) {
        s.rect(box.x, yb - lh * 0.72, box.w, lh, { fill: C.wash });
        s.rect(box.x - 2.2, yb - lh * 0.72, 1.2, lh, { fill: C.accent });
      }
      week.forEach((d, i) => {
        let col = T.M(d) === m ? C.ink : C.faint;
        if (hl.includes(d.getTime()) && T.M(d) === m) col = C.accent;
        s.text(box.x + cw * (i + 0.5), yb, String(T.D(d)), { size: fs, color: col, align: "center" });
      });
    });
  }
  const isWeekend = (d) => T.dow(d) >= 5;

  // One single-line field sitting on each ruled line, so typed text rests on the rule
  // instead of following the viewer's own multi-line spacing.
  function lineFields(s, base, x, w, lineYs, size) {
    const gaps = lineYs.map((y, i) => (i ? y - lineYs[i - 1] : Infinity));
    lineYs.forEach((y, i) => {
      const h = Math.min(size * 1.9, (i ? gaps[i] : gaps[1] || size * 2) - 2);
      s.field({ name: `${base}_L${T.pad(i + 1)}`, x, y: y - h - 0.5, w, h, size });
    });
  }

  // ── month ─────────────────────────────────────────────────────────────
  function renderMonth(s, C, pg, cfg, y, m) {
    const fw = +cfg.weekStart, o = cfg.month;
    const headH = pg.h * 0.12, headB = pg.y + headH;
    const big = headH * 0.52, sub = big * 0.38;
    s.text(pg.x, pg.y + big * 0.95, T.MONTHS[m - 1].toUpperCase(), { bold: true, size: big, color: C.ink });
    const ym = `${y}-${T.pad(m)}`;
    s.text(pg.x, headB - headH * 0.14, ym, { size: sub, color: C.accent });
    s.text(pg.x + s.tw(ym + "  ", sub), headB - headH * 0.14,
      `Q${Math.floor((m - 1) / 3) + 1} · ${T.daysInMonth(y, m)} days`, { size: sub, color: C.muted });

    if (o.minis) {
      const mw = Math.min(headH * 1.25, pg.w * 0.14), gap = mw * 0.25;
      [[0, 1], [1, -1]].forEach(([k, n]) => {
        const [yy, mm] = T.addMonths(y, m, n);
        miniMonth(s, C, { x: pg.x + pg.w - mw * (k + 1) - gap * k, y: pg.y, w: mw, h: headH * 0.94 }, yy, mm, fw);
      });
    }

    const labelH = pg.h * 0.03;
    const notesH = o.notes ? pg.h * 0.07 : 0;
    const G = headB + pg.h * 0.02 + labelH;               // grid top
    const gB = pg.y + pg.h - notesH;                       // grid bottom
    const gutter = o.weekNums ? pg.w * 0.035 : 0;
    const cw = (pg.w - gutter) / 7;
    const weeks = T.monthGrid(y, m, fw);
    const rh = (gB - G) / weeks.length;
    const labels = T.weekdayLabels(fw);

    labels.forEach((l, i) => {
      const we = l === "SAT" || l === "SUN";
      s.text(pg.x + gutter + cw * i + 4, G - labelH * 0.3, l, { bold: true, size: labelH * 0.48, color: we ? C.muted : C.ink });
      if (we && cfg.shadeWeekends) s.rect(pg.x + gutter + cw * i, G, cw, gB - G, { fill: C.wash });
    });
    if (gutter) s.text(pg.x, G - labelH * 0.3, "WK", { bold: true, size: labelH * 0.48, color: C.faint });

    const nfs = Math.min(rh * 0.16, cw * 0.14);
    weeks.forEach((week, r) => {
      const top = G + rh * r;
      if (gutter) {
        const mon = week.find((d) => T.dow(d) === 0);
        s.text(pg.x, top + nfs * 1.25, T.pad(T.isoWeek(mon).week), { size: nfs * 0.72, color: C.muted });
      }
      week.forEach((d, i) => {
        const x = pg.x + gutter + cw * i, inside = T.M(d) === m;
        s.text(x + 5, top + nfs * 1.25, T.pad(T.D(d)), { bold: inside, size: nfs, color: inside ? C.ink : C.faint });
        if (T.D(d) === 1 && !inside)
          s.text(x + 5 + nfs * 1.5, top + nfs * 1.2, T.MONTHS[T.M(d) - 1].slice(0, 3).toUpperCase(), { size: nfs * 0.6, color: C.faint });
        s.field({ name: `${ym}_${T.iso(d)}`, x: x + 3, y: top + nfs * 1.6, w: cw - 6, h: rh - nfs * 1.6 - 3,
          multiline: true, size: Math.max(6, Math.min(8, rh * 0.09)) });
      });
    });
    for (let r = 1; r < weeks.length; r++) s.line(pg.x + gutter, G + rh * r, pg.x + pg.w, G + rh * r, { color: C.faint });
    for (let i = 1; i < 7; i++) s.line(pg.x + gutter + cw * i, G, pg.x + gutter + cw * i, gB, { color: C.faint });
    s.line(pg.x, G, pg.x + pg.w, G, { color: C.ink, width: 1.2 });
    s.line(pg.x + gutter, gB, pg.x + pg.w, gB, { color: C.ink, width: 0.8 });

    if (o.notes) {
      const nT = gB + pg.h * 0.012, nH = pg.y + pg.h - nT;
      s.text(pg.x, nT + labelH * 0.5, "NOTES", { bold: true, size: labelH * 0.42, color: C.muted });
      const nx = pg.x + Math.max(gutter, s.tw("NOTES ", labelH * 0.42));
      const ys = [1, 2].map((k) => nT + nH * k / 2.4 + labelH * 0.3);
      ys.forEach((yy) => s.line(nx, yy, pg.x + pg.w, yy, { color: C.faint }));
      lineFields(s, `${ym}_notes`, nx, pg.x + pg.w - nx, ys, 8);
    }
  }

  // ── week ──────────────────────────────────────────────────────────────
  function renderWeek(s, C, pg, cfg, days, from, to) {
    const fw = +cfg.weekStart, o = cfg.week;
    const headH = pg.h * 0.10, headB = pg.y + headH, big = headH * 0.42;
    const thu = days.find((d) => T.dow(d) === 3);
    const refY = T.Y(thu), refM = T.M(thu);
    s.text(pg.x, pg.y + big * 0.95, T.weekLabel(thu), { bold: true, size: big, color: C.ink });
    const span = `${T.MONTHS[T.M(days[0]) - 1].slice(0, 3)} ${T.pad(T.D(days[0]))} – ` +
      `${T.MONTHS[T.M(days[6]) - 1].slice(0, 3)} ${T.pad(T.D(days[6]))}, ${T.Y(days[6])}`;
    s.text(pg.x, headB - headH * 0.28, span.toUpperCase(), { size: big * 0.4, color: C.accent });
    s.text(pg.x, headB - headH * 0.06, `${T.MONTHS[refM - 1].toUpperCase()} ${refY}`, { size: big * 0.34, color: C.muted });
    if (o.minis) {
      const mw = Math.min(headH * 1.4, pg.w * 0.22);
      miniMonth(s, C, { x: pg.x + pg.w - mw, y: pg.y, w: mw, h: headH }, refY, refM, fw, days);
    }

    const bT = headB + pg.h * 0.018, bB = pg.y + pg.h;
    s.line(pg.x, bT, pg.x + pg.w, bT, { color: C.ink, width: 1.2 });
    const rh = (bB - bT) / 7, lw = Math.max(pg.w * 0.16, 64);
    days.forEach((d, i) => {
      const top = bT + rh * i;
      const inside = !o.dimOutside || (d >= from && d <= to);
      if (isWeekend(d) && cfg.shadeWeekends) s.rect(pg.x, top, pg.w, rh, { fill: C.wash });
      const fs = Math.min(rh * 0.28, lw * 0.28);
      s.text(pg.x + 4, top + fs * 1.15, T.pad(T.D(d)), { bold: true, size: fs, color: inside ? C.ink : C.faint });
      s.text(pg.x + 4, top + fs * 1.9, T.WD[T.dow(d)], { bold: true, size: fs * 0.42, color: inside ? C.accent : C.faint });
      s.text(pg.x + 4, top + fs * 2.4, T.iso(d), { size: fs * 0.32, color: inside ? C.muted : C.faint });
      s.line(pg.x + lw, top + 6, pg.x + lw, top + rh - 6, { color: C.faint });
      const wfs = Math.max(7, Math.min(9.5, pg.h * 0.0115));
      if (o.lines) {
        const n = Math.max(3, Math.floor(rh / 20)), step = rh / n;
        for (let k = 1; k < n; k++) s.line(pg.x + lw + 8, top + step * k, pg.x + pg.w, top + step * k, { color: C.faint, dash: [1, 2] });
        // rule k = 1..n; the last one is the row's bottom border
        const ys = Array.from({ length: n }, (_, k) => top + step * (k + 1));
        lineFields(s, `${T.iso(d)}_week`, pg.x + lw + 8, pg.w - lw - 8, ys, wfs);
      } else {
        s.field({ name: `${T.iso(d)}_week`, x: pg.x + lw + 8, y: top + 3, w: pg.w - lw - 8, h: rh - 6, multiline: true, size: wfs });
      }
      s.line(pg.x, top + rh, pg.x + pg.w, top + rh, { color: i === 6 ? C.ink : C.faint, width: i === 6 ? 0.8 : 0.5 });
    });
  }

  // ── day ───────────────────────────────────────────────────────────────
  function fmtHM(totalMin) {
    const t = ((totalMin % 1440) + 1440) % 1440;
    return T.pad(Math.floor(t / 60)) + T.pad(t % 60);
  }

  function renderDay(s, C, pg, cfg, d) {
    const fw = +cfg.weekStart, o = cfg.day;
    const headH = pg.h * 0.10, headB = pg.y + headH, big = headH * 0.62;
    const num = T.pad(T.D(d));
    s.text(pg.x, pg.y + big * 0.82, num, { bold: true, size: big, color: C.ink });
    const nx = pg.x + s.tw(num, big) + big * 0.25;
    s.text(nx, pg.y + big * 0.40, T.WD_LONG[T.dow(d)].toUpperCase(), { bold: true, size: big * 0.34, color: C.accent });
    s.text(nx, pg.y + big * 0.82, `${T.MONTHS[T.M(d) - 1].toUpperCase()} ${T.Y(d)}`, { size: big * 0.26, color: C.ink });
    const w = T.isoWeek(d), yl = T.isLeap(T.Y(d)) ? 366 : 365;
    s.text(pg.x, headB - headH * 0.02,
      `${T.iso(d)}  ·  ${w.year}-W${T.pad(w.week)}  ·  DAY ${T.pad(T.dayOfYear(d), 3)}/${yl}`,
      { size: big * 0.2, color: C.muted });
    const mw = Math.min(headH * 1.4, pg.w * 0.22);
    miniMonth(s, C, { x: pg.x + pg.w - mw, y: pg.y, w: mw, h: headH }, T.Y(d), T.M(d), fw, [d]);

    const bT = headB + pg.h * 0.02, bB = pg.y + pg.h;
    s.line(pg.x, bT, pg.x + pg.w, bT, { color: C.ink, width: 1.2 });
    const lf = pg.h * 0.012;
    const gap = pg.w * 0.04, leftW = pg.w * 0.58, rx = pg.x + leftW + gap, rw = pg.w - leftW - gap;
    const secT = bT + lf * 2.2;

    // schedule
    const tz = o.tz2 && o.zoneB ? {
      diff: T.tzDiffMin(o.zoneA, o.zoneB, d),
      a: o.labelA || T.tzShort(o.zoneA, d), b: o.labelB || T.tzShort(o.zoneB, d),
    } : null;
    s.text(pg.x, bT + lf * 1.5, "SCHEDULE", { bold: true, size: lf, color: C.muted });
    const hfs = lf * 1.05, colW = s.tw("0000", hfs) + 8;
    const col2W = tz ? s.tw("0000+1", hfs * 0.85) + 8 : 0;
    if (tz) {
      s.text(pg.x + leftW, bT + lf * 1.5, `${tz.a} → ${tz.b}`, { size: lf * 0.85, color: C.muted, align: "right" });
    }
    const n = o.h1 - o.h0 + 1, rh = (bB - secT) / n;
    const id = T.iso(d), ffs = Math.max(7, Math.min(10, lf * 1.05));   // field font size
    const fx = pg.x + colW + col2W, fw2 = leftW - colW - col2W;
    for (let i = 0; i < n; i++) {
      const top = secT + rh * i, hh = T.pad((o.h0 + i) % 24);
      if (o.halfHours) {
        s.field({ name: `${id}_h${hh}00`, x: fx, y: top + 1, w: fw2, h: rh / 2 - 2, size: ffs });
        s.field({ name: `${id}_h${hh}30`, x: fx, y: top + rh / 2 + 1, w: fw2, h: rh / 2 - 2, size: ffs });
      } else {
        s.field({ name: `${id}_h${hh}00`, x: fx, y: top + 1, w: fw2, h: rh - 2, size: ffs });
      }
    }
    for (let i = 0; i < n; i++) {
      const top = secT + rh * i, h = o.h0 + i;
      s.text(pg.x, top + lf * 1.25, T.pad(h % 24) + "00", { size: hfs, color: C.ink });
      if (tz) {
        const t2 = h * 60 + tz.diff;
        const shift = Math.floor(t2 / 1440);
        s.text(pg.x + colW, top + lf * 1.25, fmtHM(t2) + (shift > 0 ? "+1" : shift < 0 ? "-1" : ""),
          { size: hfs * 0.85, color: C.accent });
      }
      s.line(pg.x, top, pg.x + leftW, top, { color: C.faint });
      if (o.halfHours) s.line(pg.x + colW + col2W, top + rh / 2, pg.x + leftW, top + rh / 2, { color: C.faint, dash: [1, 2] });
    }
    s.line(pg.x, bB, pg.x + leftW, bB, { color: C.ink, width: 0.8 });

    // right column: top 3 → tasks → notes (most structured to least)
    const rightH = bB - secT;
    let yc = bT;
    const section = (label, h) => {
      s.text(rx, yc + lf * 1.5, label, { bold: true, size: lf, color: C.muted });
      const top = yc + lf * 2.2; yc = top + h; return top;
    };
    if (o.priorities) {
      const ph = rightH * 0.17 / 3, top = section("TOP 3", rightH * 0.17);
      for (let k = 0; k < 3; k++) {
        const t = top + ph * k;
        s.text(rx, t + ph * 0.62, String(k + 1), { bold: true, size: lf * 1.3, color: C.accent });
        s.line(rx + lf * 1.6, t + ph, rx + rw, t + ph, { color: C.faint });
        s.field({ name: `${id}_top${k + 1}`, x: rx + lf * 1.6, y: t + ph * 0.3, w: rw - lf * 1.6, h: ph * 0.7 - 1, size: ffs });
      }
      yc += lf * 1.6;
    }
    const nt = Math.max(0, +o.tasks || 0);
    if (nt > 0) {
      const tkH = rightH * (o.priorities ? 0.42 : 0.55);
      const top = section("TASKS", tkH), th = tkH / nt, bs = Math.min(th * 0.45, lf * 1.1);
      for (let k = 0; k < nt; k++) {
        const t = top + th * k;
        s.rect(rx, t + th / 2 - bs / 2, bs, bs, { stroke: C.muted, width: 0.6 });
        s.line(rx + bs + 6, t + th, rx + rw, t + th, { color: C.faint });
        const nn = T.pad(k + 1);
        s.field({ name: `${id}_task${nn}_done`, type: "check", x: rx, y: t + th / 2 - bs / 2, w: bs, h: bs });
        s.field({ name: `${id}_task${nn}`, x: rx + bs + 6, y: t + 1, w: rw - bs - 6, h: th - 2, size: ffs });
      }
      yc += lf * 1.6;
    }
    const top = section("NOTES", 0);
    const ys = [];
    for (let yy = top + 20; yy < bB - 2; yy += 20) { s.line(rx, yy, rx + rw, yy, { color: C.faint, dash: [1, 2] }); ys.push(yy); }
    lineFields(s, `${id}_notes`, rx, rw, ys, ffs);
    s.line(rx, bB, rx + rw, bB, { color: C.ink, width: 0.8 });
  }

  function renderJob(s, job, cfg, size) {
    const C = palette(cfg);
    const m = (+cfg.margin || 0) * 72;
    const pg = { x: m, y: m, w: size.w - 2 * m, h: size.h - 2 * m };
    if (job.kind === "month") renderMonth(s, C, pg, cfg, job.y, job.m);
    else if (job.kind === "week") renderWeek(s, C, pg, cfg, job.days, job.from, job.to);
    else renderDay(s, C, pg, cfg, job.d);
  }

  window.PL.render = { PAPERS, MAX_PAGES, pageSize, planJobs, renderJob, fileName };
})();
