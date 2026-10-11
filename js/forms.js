// forms.js — optional second pass that turns the drawn PDF into a fillable form.
//
// Why a second library: jsPDF draws pages well, but its AcroForm output is incomplete
// (no default appearance/resources on text fields, checkboxes default to checked).
// pdf-lib writes complete field dictionaries and can use the embedded font for typed text.
//
// Pipeline:  jsPDF bytes ──▶ pdf-lib load ──▶ add recorded fields ──▶ bytes
// With "Fillable" off this file is never called, so the plain PDF path is unchanged.
(function () {
  "use strict";

  function b64ToBytes(b64) {
    const bin = atob(b64), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }

  async function addFields(pdfBytes, fields, cfg) {
    const { PDFDocument, PDFName, PDFString, StandardFonts, rgb } = window.PDFLib;
    const pdf = await PDFDocument.load(pdfBytes);
    pdf.registerFontkit(window.fontkit);
    // Full (non-subset) embed: typing needs glyphs that aren't on the page yet.
    const font = cfg.font === "courier"
      ? await pdf.embedFont(StandardFonts.Courier)
      : await pdf.embedFont(b64ToBytes(window.PL_FONTS.regular), { subset: false });
    const form = pdf.getForm();
    const ink = rgb(0.086, 0.098, 0.114);       // #16191D
    const pages = pdf.getPages();
    const seen = new Set();

    for (const f of fields) {
      if (seen.has(f.name)) continue;            // duplicate names would link fields together
      seen.add(f.name);
      const page = pages[f.page], H = page.getHeight();
      const box = {
        x: f.x, y: H - f.y - f.h, width: f.w, height: f.h,
        borderWidth: 0, borderColor: undefined, backgroundColor: undefined, textColor: ink,
      };
      if (f.type === "check") {
        const cb = form.createCheckBox(f.name);
        cb.addToPage(page, box);
      } else {
        const tf = form.createTextField(f.name);
        if (f.multiline) tf.enableMultiline();
        tf.disableRichFormatting();
        tf.addToPage(page, { ...box, font });
        tf.setFontSize(f.size || 9);
      }
    }
    form.updateFieldAppearances(font);

    // Register the font form-wide (AcroForm /DR + /DA). Chrome, Edge and Acrobat
    // regenerate the text appearance while you type and look the font up here;
    // without it they fall back to Helvetica.
    const fontName = font.name;
    const acro = form.acroForm.dict;
    acro.set(PDFName.of("DR"), pdf.context.obj({ Font: { [fontName]: font.ref } }));
    acro.set(PDFName.of("DA"), PDFString.of(`/${fontName} 9 Tf 0 g`));
    return { bytes: await pdf.save(), count: seen.size };
  }

  window.PL = window.PL || {};
  window.PL.forms = { addFields };
})();
