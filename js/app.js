// app.js — UI only: config state <-> form, preview paging, presets, PDF export.
// The config object is the single source of truth. Form events write into it,
// then everything downstream (page plan, preview, file name) is recomputed from it.
(function () {
  "use strict";
  const T = PL.dates, R = PL.render, S = PL.surfaces;
  const $ = (id) => document.getElementById(id);
  const KEY_CFG = "planlens.cfg.v1", KEY_PRESETS = "planlens.presets.v1";
  const ACCENTS = ["#2F6690", "#3A6B4F", "#8A4B2A", "#5B4A8A", "#16191D"];

  const store = {
    get(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked: ignore */ } },
  };

  // ── defaults ──────────────────────────────────────────────────────────
  const now = new Date();
  const todayISO = `${now.getFullYear()}-${T.pad(now.getMonth() + 1)}-${T.pad(now.getDate())}`;
  const today = T.parseISO(todayISO);
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  function defaults() {
    return {
      layout: "day",
      monthFrom: todayISO.slice(0, 7), monthTo: todayISO.slice(0, 7),
      dateFrom: todayISO, dateTo: T.iso(T.addDays(today, 6)),
      paper: "letter", orient: "auto", margin: 0.35, weekStart: "0",
      font: "jbm", accent: ACCENTS[0], shadeWeekends: true,
      month: { weekNums: true, minis: true, notes: true },
      week: { lines: true, minis: true, dimOutside: false },
      day: { h0: 6, h1: 22, tasks: 12, halfHours: true, priorities: true,
             tz2: false, zoneA: localZone, zoneB: "Australia/Sydney" },
      fileName: "",
    };
  }
  // Merge saved config over defaults so new options get sane values.
  function merge(base, over) {
    const out = { ...base };
    for (const k in over || {}) {
      out[k] = base[k] && typeof base[k] === "object" && !Array.isArray(base[k]) ? merge(base[k], over[k]) : over[k];
    }
    return out;
  }
  let cfg = merge(defaults(), store.get(KEY_CFG, {}));

  // ── form binding ──────────────────────────────────────────────────────
  // [element id, path in cfg, kind]
  const BINDINGS = [
    ["monthFrom", "monthFrom"], ["monthTo", "monthTo"], ["dateFrom", "dateFrom"], ["dateTo", "dateTo"],
    ["paper", "paper"], ["orient", "orient"], ["margin", "margin", "num"], ["weekStart", "weekStart"],
    ["font", "font"], ["accent", "accent"], ["shadeWeekends", "shadeWeekends", "bool"],
    ["m-weekNums", "month.weekNums", "bool"], ["m-minis", "month.minis", "bool"], ["m-notes", "month.notes", "bool"],
    ["w-lines", "week.lines", "bool"], ["w-minis", "week.minis", "bool"], ["w-dimOutside", "week.dimOutside", "bool"],
    ["d-h0", "day.h0", "num"], ["d-h1", "day.h1", "num"], ["d-tasks", "day.tasks", "num"],
    ["d-halfHours", "day.halfHours", "bool"], ["d-priorities", "day.priorities", "bool"],
    ["d-tz2", "day.tz2", "bool"], ["d-zoneA", "day.zoneA"], ["d-zoneB", "day.zoneB"],
  ];
  const getPath = (o, p) => p.split(".").reduce((a, k) => a[k], o);
  const setPath = (o, p, v) => { const ks = p.split("."); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };

  function fillStaticOptions() {
    $("paper").innerHTML = Object.entries(R.PAPERS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join("");
    const hours = Array.from({ length: 24 }, (_, h) => `<option value="${h}">${T.pad(h)}00</option>`).join("");
    $("d-h0").innerHTML = hours; $("d-h1").innerHTML = hours;
    let zones = [];
    try { zones = Intl.supportedValuesOf("timeZone"); } catch { zones = ["UTC", "Pacific/Honolulu", "America/Los_Angeles", "America/New_York", "Europe/London", "Asia/Tokyo", "Australia/Sydney"]; }
    $("zones").innerHTML = zones.map((z) => `<option value="${z}"></option>`).join("");
    const sw = $("swatches");
    ACCENTS.forEach((c) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "sw"; b.style.background = c; b.dataset.color = c;
      b.setAttribute("aria-label", `Accent ${c}`);
      b.addEventListener("click", () => { cfg.accent = c; $("accent").value = c; changed(); });
      sw.insertBefore(b, $("accent"));
    });
  }

  function writeForm() {
    document.querySelector(`input[name=layout][value=${cfg.layout}]`).checked = true;
    for (const [id, path, kind] of BINDINGS) {
      const el = $(id), v = getPath(cfg, path);
      if (kind === "bool") el.checked = !!v; else el.value = v;
    }
    $("fileName").value = cfg.fileName || "";
  }

  function validZone(z) { try { new Intl.DateTimeFormat("en-US", { timeZone: z }); return true; } catch { return false; } }

  function readForm(e) {
    for (const [id, path, kind] of BINDINGS) {
      if (e && e.target.id !== id) continue;
      const el = $(id);
      let v = kind === "bool" ? el.checked : kind === "num" ? parseFloat(el.value) : el.value;
      if (kind === "num" && Number.isNaN(v)) continue;
      if ((id === "d-zoneA" || id === "d-zoneB") && !validZone(v)) continue; // wait for a full zone name
      if (!v && (id.startsWith("month") || id.startsWith("date"))) continue;
      setPath(cfg, path, v);
    }
  }

  // ── derived state ─────────────────────────────────────────────────────
  let jobs = [], pageIdx = 0;

  function normalise() {
    if (cfg.monthTo < cfg.monthFrom) cfg.monthTo = cfg.monthFrom;
    if (cfg.dateTo < cfg.dateFrom) cfg.dateTo = cfg.dateFrom;
    if (cfg.day.h1 < cfg.day.h0) cfg.day.h1 = cfg.day.h0;
    cfg.day.tasks = Math.max(0, Math.min(30, Math.round(cfg.day.tasks)));
    cfg.margin = Math.max(0, Math.min(1.5, cfg.margin));
  }

  function changed() {
    normalise();
    $("status").textContent = "";
    document.body.dataset.layout = cfg.layout;
    $("tzRowA").hidden = $("tzRowB").hidden = !cfg.day.tz2;
    document.querySelectorAll(".sw").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.color.toLowerCase() === cfg.accent.toLowerCase())));
    jobs = R.planJobs(cfg);
    pageIdx = Math.min(pageIdx, Math.max(0, jobs.length - 1));
    const n = jobs.length;
    $("pageCount").innerHTML = n >= R.MAX_PAGES ? `<span class="warn">${n} pages (max)</span>` : `${n} page${n === 1 ? "" : "s"}`;
    const size = R.pageSize(cfg);
    $("paperInfo").textContent = `${(size.w / 72).toFixed(2)}×${(size.h / 72).toFixed(2)} in`;
    $("fileName").placeholder = R.fileName(cfg);
    renderQuick();
    store.set(KEY_CFG, cfg);
    drawPreview();
  }

  // ── quick ranges ──────────────────────────────────────────────────────
  function renderQuick() {
    const fw = +cfg.weekStart, wk0 = T.weekOf(today, fw)[0];
    const [y, m] = [now.getFullYear(), now.getMonth() + 1];
    const ym = (yy, mm) => `${yy}-${T.pad(mm)}`;
    const sets = {
      month: [
        ["This month", () => { cfg.monthFrom = cfg.monthTo = ym(y, m); }],
        ["Next 3", () => { cfg.monthFrom = ym(y, m); cfg.monthTo = ym(...T.addMonths(y, m, 2)); }],
        ["Rest of year", () => { cfg.monthFrom = ym(y, m); cfg.monthTo = ym(y, 12); }],
        [`${y + 1}`, () => { cfg.monthFrom = ym(y + 1, 1); cfg.monthTo = ym(y + 1, 12); }],
      ],
      week: [
        ["This week", () => { cfg.dateFrom = T.iso(wk0); cfg.dateTo = T.iso(T.addDays(wk0, 6)); }],
        ["Next 4 wks", () => { cfg.dateFrom = T.iso(wk0); cfg.dateTo = T.iso(T.addDays(wk0, 27)); }],
        ["This month", () => { cfg.dateFrom = T.iso(T.ymd(y, m, 1)); cfg.dateTo = T.iso(T.ymd(y, m, T.daysInMonth(y, m))); }],
        ["Next 13 wks", () => { cfg.dateFrom = T.iso(wk0); cfg.dateTo = T.iso(T.addDays(wk0, 90)); }],
      ],
      day: [
        ["Today", () => { cfg.dateFrom = cfg.dateTo = todayISO; }],
        ["Next 7", () => { cfg.dateFrom = todayISO; cfg.dateTo = T.iso(T.addDays(today, 6)); }],
        ["Next 14", () => { cfg.dateFrom = todayISO; cfg.dateTo = T.iso(T.addDays(today, 13)); }],
        ["Rest of month", () => { cfg.dateFrom = todayISO; cfg.dateTo = T.iso(T.ymd(y, m, T.daysInMonth(y, m))); }],
      ],
    };
    const q = $("quick");
    q.innerHTML = "";
    sets[cfg.layout].forEach(([label, fn]) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "chip"; b.textContent = label;
      b.addEventListener("click", () => { fn(); pageIdx = 0; writeForm(); changed(); });
      q.appendChild(b);
    });
  }

  // ── preview ───────────────────────────────────────────────────────────
  let rafId = 0;
  function drawPreview() {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      const cv = $("canvas"), stage = $("stage");
      const size = R.pageSize(cfg);
      const availW = stage.clientWidth - 40, availH = Math.max(stage.clientHeight - 40, 300);
      const fit = Math.max(0.2, Math.min(availW / size.w, availH / size.h));
      const dpr = window.devicePixelRatio || 1;
      cv.style.width = `${size.w * fit}px`; cv.style.height = `${size.h * fit}px`;
      cv.width = Math.round(size.w * fit * dpr); cv.height = Math.round(size.h * fit * dpr);
      const ctx = cv.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
      const job = jobs[pageIdx];
      $("pgLabel").textContent = `${jobs.length ? pageIdx + 1 : 0} / ${jobs.length}`;
      $("prev").disabled = pageIdx <= 0; $("next").disabled = pageIdx >= jobs.length - 1;
      if (!job) { $("pgInfo").textContent = "No pages in range"; return; }
      $("pgInfo").textContent = job.kind === "month" ? `${T.MONTHS[job.m - 1]} ${job.y}`
        : job.kind === "week" ? `${T.weekLabel(job.days[3])} · ${T.iso(job.days[0])} → ${T.iso(job.days[6])}`
        : `${T.WD_LONG[T.dow(job.d)]} ${T.iso(job.d)}`;
      try { R.renderJob(new S.CanvasSurface(ctx, fit * dpr, cfg.font), job, cfg, size); }
      catch (err) { console.error(err); $("pgInfo").textContent = "Preview error: " + err.message; }
    });
  }

  // ── PDF export ────────────────────────────────────────────────────────
  function exportPdf() {
    if (!jobs.length) return;
    const btn = $("download");
    btn.disabled = true; btn.textContent = `Building ${jobs.length} pages…`; $("status").textContent = "";
    setTimeout(() => {   // let the button repaint before the synchronous build
      try {
        const size = R.pageSize(cfg), orient = size.w > size.h ? "landscape" : "portrait";
        const doc = new window.jspdf.jsPDF({ unit: "pt", format: [size.w, size.h], orientation: orient, compress: true });
        const surf = new S.PdfSurface(doc, cfg.font);
        jobs.forEach((job, i) => {
          if (i > 0) doc.addPage([size.w, size.h], orient);
          R.renderJob(surf, job, cfg, size);
        });
        let name = (cfg.fileName || R.fileName(cfg)).trim();
        if (!/\.pdf$/i.test(name)) name += ".pdf";
        doc.setProperties({ title: name.replace(/\.pdf$/i, ""), creator: "Plan Lens" });
        doc.save(name);
        $("status").textContent = `Saved ${name} · ${jobs.length} page${jobs.length === 1 ? "" : "s"}`;
      } catch (err) {
        console.error(err);
        $("status").innerHTML = `<span class="warn">Export failed: ${err.message}</span>`;
      } finally {
        btn.disabled = false; btn.textContent = "Download PDF";
      }
    }, 30);
  }

  // ── presets ───────────────────────────────────────────────────────────
  function listPresets() {
    const ps = store.get(KEY_PRESETS, {}), el = $("presetList");
    const names = Object.keys(ps).sort();
    el.innerHTML = names.length ? "" : `<div class="empty">No saved presets yet.</div>`;
    names.forEach((n) => {
      const row = document.createElement("div");
      row.className = "preset";
      row.innerHTML = `<span title="${n}">${n}</span><button class="link" type="button">load</button><button class="link danger" type="button">delete</button>`;
      const [load, del] = row.querySelectorAll("button");
      load.addEventListener("click", () => {
        cfg = merge(defaults(), ps[n]); pageIdx = 0; writeForm(); changed();
        $("presetMsg").textContent = `Loaded “${n}”.`;
      });
      del.addEventListener("click", () => {
        if (del.dataset.armed) { delete ps[n]; store.set(KEY_PRESETS, ps); listPresets(); $("presetMsg").textContent = `Deleted “${n}”.`; return; }
        del.dataset.armed = "1"; del.textContent = "confirm";
        setTimeout(() => { if (del.isConnected) { delete del.dataset.armed; del.textContent = "delete"; } }, 3000);
      });
      el.appendChild(row);
    });
  }
  function savePreset() {
    const n = $("presetName").value.trim();
    if (!n) { $("presetMsg").textContent = "Type a name first."; return; }
    const ps = store.get(KEY_PRESETS, {});
    ps[n] = JSON.parse(JSON.stringify(cfg));
    store.set(KEY_PRESETS, ps);
    $("presetName").value = ""; listPresets();
    $("presetMsg").textContent = `Saved “${n}”.`;
  }
  function exportCfg() {
    const data = { app: "plan-lens", version: 1, config: cfg, presets: store.get(KEY_PRESETS, {}) };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "plan-lens-config.json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function importCfg(file) {
    file.text().then((txt) => {
      const data = JSON.parse(txt);
      const incoming = data.presets || {};
      const ps = { ...store.get(KEY_PRESETS, {}), ...incoming };
      store.set(KEY_PRESETS, ps);
      if (data.config) { cfg = merge(defaults(), data.config); writeForm(); changed(); }
      listPresets();
      $("presetMsg").textContent = `Imported ${Object.keys(incoming).length} preset(s).`;
    }).catch((err) => { $("presetMsg").textContent = `Import failed: ${err.message}`; });
  }

  // ── theme ─────────────────────────────────────────────────────────────
  function applyTheme(v) {
    if (v) document.documentElement.dataset.theme = v; else delete document.documentElement.dataset.theme;
    store.set("planlens.theme", v);
  }

  // ── wire up ───────────────────────────────────────────────────────────
  fillStaticOptions();
  writeForm();
  const theme = store.get("planlens.theme", "");
  $("theme").value = theme; applyTheme(theme);
  $("theme").addEventListener("change", (e) => applyTheme(e.target.value));

  document.querySelectorAll("input[name=layout]").forEach((r) =>
    r.addEventListener("change", () => { cfg.layout = r.value; pageIdx = 0; changed(); }));
  document.querySelector(".scroll").addEventListener("input", (e) => {
    if (e.target.name === "layout" || e.target.id === "presetName" || e.target.id === "importCfg") return;
    readForm(e); changed();
  });
  // re-sync fields that normalise() may have adjusted once the user leaves them
  document.querySelector(".scroll").addEventListener("change", () => writeForm());
  $("fileName").addEventListener("input", (e) => { cfg.fileName = e.target.value; store.set(KEY_CFG, cfg); });
  $("prev").addEventListener("click", () => { pageIdx = Math.max(0, pageIdx - 1); drawPreview(); });
  $("next").addEventListener("click", () => { pageIdx = Math.min(jobs.length - 1, pageIdx + 1); drawPreview(); });
  document.addEventListener("keydown", (e) => {
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (e.key === "ArrowLeft") $("prev").click();
    if (e.key === "ArrowRight") $("next").click();
  });
  $("download").addEventListener("click", exportPdf);
  $("savePreset").addEventListener("click", savePreset);
  $("presetName").addEventListener("keydown", (e) => { if (e.key === "Enter") savePreset(); });
  $("exportCfg").addEventListener("click", exportCfg);
  $("importCfg").addEventListener("change", (e) => { if (e.target.files[0]) importCfg(e.target.files[0]); e.target.value = ""; });
  new ResizeObserver(() => drawPreview()).observe($("stage"));

  listPresets();
  S.loadPreviewFonts().catch(() => {}).finally(changed);
  changed();
})();
