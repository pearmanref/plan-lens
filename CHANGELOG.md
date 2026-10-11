# Changelog

## v0.2 — 2026-10-10
- Fillable PDF fields (optional): text fields and checkboxes over every writing area.
  - Day: :00/:30 schedule slots, Top 3, tasks + checkboxes, one field per notes line.
  - Week: one field per ruled line in each day row (one box per day when guides are off).
  - Month: one box per day cell, one field per notes line.
  - Typed text uses the embedded JetBrains Mono; field names are date-based (`2026-10-13_h0930`).
- Preview outlines field regions when the option is on.
- Added pdf-lib 1.17.1 + @pdf-lib/fontkit 1.1.1 (MIT) for the form pass.

## v0.1 — 2026-10-10
- Month, week and day page layouts with live preview and PDF export (jsPDF).
- Paper sizes (Letter, A4, Half Letter, A5), orientation, margins, week start, accent color.
- Day pages: configurable hours, optional second time zone (DST-aware).
- Presets with JSON import/export; light/dark UI.
