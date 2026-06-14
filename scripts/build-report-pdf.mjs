/**
 * Generates docs/REPORT.pdf — the full Traditional-Chinese project report
 * (報告書) rendered from docs/REPORT.md.
 *
 * The Markdown is converted to a styled, self-contained HTML (screenshots are
 * inlined as base64 data URIs and a CJK font is applied), then WeasyPrint turns
 * that HTML into a paginated PDF with a CJK-capable font (e.g. WenQuanYi Zen Hei
 * or Noto Sans CJK).
 *
 * Docs-only tool. Install the generator dependencies on demand, then run it:
 *   npm i -D marked            # node Markdown renderer
 *   pip install weasyprint     # HTML -> PDF (needs pango/cairo system libs)
 *   node scripts/build-report-pdf.mjs
 */
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { marked } from "marked";

const here = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.join(here, "..", "docs");
const htmlPath = path.join(docsDir, "report.html");
const pdfPath = path.join(docsDir, "REPORT.pdf");

const md = readFileSync(path.join(docsDir, "REPORT.md"), "utf8");

marked.setOptions({ gfm: true, breaks: false });
let body = marked.parse(md);

// GitHub-style heading ids so the in-page Table of Contents links resolve.
const slug = (t) =>
  t.replace(/<[^>]+>/g, "").trim().toLowerCase().replace(/[^\w一-鿿 \-]/g, "").replace(/ +/g, "-");
body = body.replace(/<(h[1-4])>(.*?)<\/\1>/g, (_m, tag, inner) => `<${tag} id="${slug(inner)}">${inner}</${tag}>`);

// Inline the committed screenshots so the PDF is fully self-contained.
body = body.replace(/src="(screenshots\/[^"]+)"/g, (_m, rel) => {
  const b64 = readFileSync(path.join(docsDir, rel)).toString("base64");
  return `src="data:image/png;base64,${b64}"`;
});

const css = `
@page { size: A4; margin: 18mm 16mm; }
* { box-sizing: border-box; }
body { font-family: "WenQuanYi Zen Hei", "Noto Sans CJK TC", sans-serif; color: #1e293b; font-size: 11pt; line-height: 1.7; margin: 0; }
h1 { font-size: 23pt; color: #1d4ed8; border-bottom: 3px solid #2563eb; padding-bottom: 8px; margin: 0 0 6px; }
h2 { font-size: 16pt; color: #0f172a; border-left: 5px solid #2563eb; padding-left: 10px; margin: 26px 0 10px; page-break-before: always; page-break-after: avoid; }
h2:first-of-type { page-break-before: avoid; }
h3 { font-size: 13pt; color: #1e3a8a; margin: 18px 0 6px; page-break-after: avoid; }
h4 { font-size: 11.5pt; color: #334155; margin: 12px 0 4px; }
p { margin: 6px 0; }
a { color: #2563eb; text-decoration: none; }
ul, ol { margin: 6px 0 6px 4px; padding-left: 22px; }
li { margin: 2px 0; }
blockquote { margin: 10px 0; padding: 8px 14px; background: #eff6ff; border-left: 4px solid #2563eb; color: #334155; }
blockquote p { margin: 2px 0; }
code { font-family: "WenQuanYi Zen Hei Mono", monospace; background: #f1f5f9; padding: 1px 5px; border-radius: 3px; font-size: 9.5pt; }
pre { background: #0f172a; color: #e2e8f0; padding: 12px 14px; border-radius: 6px; overflow-x: auto; page-break-inside: avoid; font-size: 8.7pt; line-height: 1.5; }
pre code { background: none; color: inherit; padding: 0; font-size: 8.7pt; }
table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 9.6pt; page-break-inside: avoid; }
th, td { border: 1px solid #cbd5e1; padding: 5px 8px; text-align: left; vertical-align: top; }
th { background: #2563eb; color: #fff; font-weight: bold; }
tr:nth-child(even) td { background: #f8fafc; }
img { max-width: 100%; height: auto; display: block; margin: 8px auto; border: 1px solid #e2e8f0; border-radius: 4px; page-break-inside: avoid; }
em { color: #475569; }
p em { color: #64748b; font-size: 9pt; }
hr { border: none; border-top: 1px solid #e2e8f0; margin: 18px 0; }
`;

const html = `<!DOCTYPE html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<title>Sequential Circuit Studio 專案報告書</title>
<style>${css}</style></head>
<body>${body}</body></html>`;

writeFileSync(htmlPath, html);
execFileSync("python3", ["-m", "weasyprint", htmlPath, pdfPath], { stdio: "inherit" });
rmSync(htmlPath, { force: true });
console.log("Wrote", pdfPath);
