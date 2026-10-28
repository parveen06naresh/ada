// Turn a resume file into plain text on the device. PDF and Word readers load only when someone uploads one.
const loaded = {};
function script(src) {
  loaded[src] ??= new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = ok;
    s.onerror = () => { delete loaded[src]; fail(new Error("Could not load the file reader. Check your connection, or paste your resume as text.")); };
    document.head.append(s);
  });
  return loaded[src];
}

// pdf.js returns positioned text runs; rebuild lines from their y positions and spaces from the gaps between runs.
async function pdfText(buf) {
  await script("vendor/pdf.min.js");
  const lib = window.pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
  const pdf = await lib.getDocument({ data: buf }).promise;
  const lines = [];
  for (let i = 1; i <= Math.min(pdf.numPages, 6); i++) {
    const { items } = await (await pdf.getPage(i)).getTextContent();
    let line = "", y = null, end = null;
    for (const it of items) {
      const [x, ty] = [it.transform[4], it.transform[5]];
      if (y !== null && Math.abs(ty - y) > 2) { lines.push(line.trim()); line = ""; end = null; }
      if (end !== null && x - end > 1.5 && !line.endsWith(" ") && !it.str.startsWith(" ")) line += " ";
      line += it.str;
      y = ty;
      end = x + it.width;
      if (it.hasEOL) { lines.push(line.trim()); line = ""; y = null; end = null; }
    }
    if (line.trim()) lines.push(line.trim());
  }
  return lines.filter(Boolean).join("\n");
}

export async function fileToText(file) {
  const name = file.name.toLowerCase();
  if (file.size > 8 * 1024 * 1024) throw new Error("That file is over 8 MB. Export your resume as a normal PDF and try again.");
  if (name.endsWith(".pdf") || file.type === "application/pdf") return pdfText(await file.arrayBuffer());
  if (name.endsWith(".docx")) {
    await script("vendor/mammoth.browser.min.js");
    return (await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
  }
  if (name.endsWith(".doc")) throw new Error("Old .doc files can't be read. Save it as PDF or .docx and try again.");
  return file.text();
}
