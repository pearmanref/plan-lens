// surfaces.js — two drawing backends behind one tiny API.
//
// Renderers never touch canvas or jsPDF directly; they call:
//   s.text(x, y, str, {bold, size, color, align})   // y = baseline
//   s.line(x1, y1, x2, y2, {color, width, dash})
//   s.rect(x, y, w, h, {fill, stroke, width})
//   s.tw(str, size)                                  // text width
//   s.field({name, x, y, w, h, type, multiline, size}) // fillable region (text | check)
// Units are PDF points (1/72 in), origin top-left, y grows downward.
// Because both backends implement the same calls, the preview IS the PDF layout.
(function () {
  "use strict";
  const MONO_ADVANCE = 0.6; // JetBrains Mono and Courier are both 600/1000 em

  const FONTS = {
    jbm: { css: '"PL JetBrains Mono", "JetBrains Mono", monospace', pdf: "JBM" },
    courier: { css: '"Courier New", Courier, monospace', pdf: "courier" },
  };

  let fontsLoaded = null;
  function b64ToBuf(b64) {
    const bin = atob(b64), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }
  // Register the embedded font with the page once, for the canvas preview.
  function loadPreviewFonts() {
    if (fontsLoaded) return fontsLoaded;
    const F = window.PL_FONTS;
    const faces = [
      new FontFace("PL JetBrains Mono", b64ToBuf(F.regular), { weight: "400" }),
      new FontFace("PL JetBrains Mono", b64ToBuf(F.bold), { weight: "700" }),
    ];
    fontsLoaded = Promise.all(faces.map((f) => f.load())).then((ls) => ls.forEach((f) => document.fonts.add(f)));
    return fontsLoaded;
  }

  class CanvasSurface {
    constructor(ctx, scale, fontKey, showFields) {
      this.ctx = ctx; this.k = scale; this.font = FONTS[fontKey] || FONTS.jbm; this.showFields = !!showFields;
    }
    // Preview only: outline where fillable fields will land.
    field(f) {
      if (!this.showFields) return;
      const c = this.ctx, k = this.k;
      c.save();
      c.fillStyle = "rgba(47,102,144,0.06)";
      c.fillRect(f.x * k, f.y * k, f.w * k, f.h * k);
      c.strokeStyle = "rgba(47,102,144,0.45)"; c.lineWidth = 1; c.setLineDash([3, 2]);
      c.strokeRect(f.x * k + 0.5, f.y * k + 0.5, f.w * k - 1, f.h * k - 1);
      c.restore();
    }
    tw(str, size) { return String(str).length * MONO_ADVANCE * size; }
    text(x, y, str, o = {}) {
      const c = this.ctx, k = this.k;
      c.font = `${o.bold ? 700 : 400} ${(o.size || 10) * k}px ${this.font.css}`;
      c.fillStyle = o.color || "#000";
      c.textAlign = o.align || "left";
      c.textBaseline = "alphabetic";
      c.fillText(String(str), x * k, y * k);
    }
    line(x1, y1, x2, y2, o = {}) {
      const c = this.ctx, k = this.k;
      c.strokeStyle = o.color || "#000";
      c.lineWidth = Math.max((o.width || 0.5) * k, 0.6);
      c.setLineDash(o.dash ? o.dash.map((v) => v * k) : []);
      c.beginPath(); c.moveTo(x1 * k, y1 * k); c.lineTo(x2 * k, y2 * k); c.stroke();
      c.setLineDash([]);
    }
    rect(x, y, w, h, o = {}) {
      const c = this.ctx, k = this.k;
      if (o.fill) { c.fillStyle = o.fill; c.fillRect(x * k, y * k, w * k, h * k); }
      if (o.stroke) {
        c.strokeStyle = o.stroke; c.lineWidth = Math.max((o.width || 0.5) * k, 0.6);
        c.strokeRect(x * k, y * k, w * k, h * k);
      }
    }
  }

  class PdfSurface {
    constructor(doc, fontKey) {
      this.doc = doc; this.font = FONTS[fontKey] || FONTS.jbm;
      this.page = 0; this.fields = [];   // fields are recorded here, added later by forms.js
      if (this.font.pdf === "JBM") {
        const F = window.PL_FONTS;
        doc.addFileToVFS("JBM-Regular.ttf", F.regular);
        doc.addFileToVFS("JBM-Bold.ttf", F.bold);
        doc.addFont("JBM-Regular.ttf", "JBM", "normal");
        doc.addFont("JBM-Bold.ttf", "JBM", "bold");
      }
    }
    tw(str, size) { return String(str).length * MONO_ADVANCE * size; }
    field(f) { this.fields.push({ ...f, page: this.page }); }
    text(x, y, str, o = {}) {
      const d = this.doc;
      d.setFont(this.font.pdf, o.bold ? "bold" : "normal");
      d.setFontSize(o.size || 10);
      d.setTextColor(o.color || "#000000");
      d.text(String(str), x, y, { align: o.align || "left", baseline: "alphabetic" });
    }
    line(x1, y1, x2, y2, o = {}) {
      const d = this.doc;
      d.setDrawColor(o.color || "#000000");
      d.setLineWidth(o.width || 0.5);
      d.setLineDashPattern(o.dash || [], 0);
      d.line(x1, y1, x2, y2);
      d.setLineDashPattern([], 0);
    }
    rect(x, y, w, h, o = {}) {
      const d = this.doc;
      if (o.fill) { d.setFillColor(o.fill); d.rect(x, y, w, h, "F"); }
      if (o.stroke) { d.setDrawColor(o.stroke); d.setLineWidth(o.width || 0.5); d.rect(x, y, w, h, "S"); }
    }
  }

  window.PL = window.PL || {};
  window.PL.surfaces = { CanvasSurface, PdfSurface, loadPreviewFonts, FONTS };
})();
