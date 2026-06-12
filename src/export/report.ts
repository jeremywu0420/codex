// jspdf and html2canvas are heavy; load them on demand so they stay out of the main bundle.
async function loadExportLibraries() {
  const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
  return { html2canvas, jsPDF };
}

export interface ExportReportOptions {
  fileName?: string;
  includeCodeGenerator?: boolean;
}

function createExportClone(element: HTMLElement) {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.classList.add("pdf-export-root");
  clone.style.position = "absolute";
  clone.style.left = "-10000px";
  clone.style.top = "0";
  clone.style.width = `${element.scrollWidth}px`;
  clone.style.maxWidth = "none";
  clone.style.pointerEvents = "none";
  document.body.appendChild(clone);
  return clone;
}

function applyExportOptions(cloneRoot: HTMLElement, options: ExportReportOptions) {
  if (options.includeCodeGenerator) return;
  cloneRoot.querySelectorAll(".code-generator-panel").forEach((element) => element.remove());
}

function copyCanvasContents(sourceRoot: HTMLElement, cloneRoot: HTMLElement) {
  const sourceCanvases = sourceRoot.querySelectorAll("canvas");
  const cloneCanvases = cloneRoot.querySelectorAll("canvas");
  sourceCanvases.forEach((sourceCanvas, index) => {
    const cloneCanvas = cloneCanvases[index];
    if (!cloneCanvas) return;
    cloneCanvas.width = sourceCanvas.width;
    cloneCanvas.height = sourceCanvas.height;
    const context = cloneCanvas.getContext("2d");
    if (!context) return;
    context.drawImage(sourceCanvas, 0, 0);
  });
}

function normalizeExportOptions(options: ExportReportOptions | string): Required<ExportReportOptions> {
  if (typeof options === "string") {
    return {
      fileName: options,
      includeCodeGenerator: true,
    };
  }
  return {
    fileName: options.fileName ?? "logic-circuit-report.pdf",
    includeCodeGenerator: options.includeCodeGenerator ?? true,
  };
}

export async function exportReport(element: HTMLElement, options: ExportReportOptions | string = {}) {
  const { html2canvas, jsPDF } = await loadExportLibraries();
  const exportOptions = normalizeExportOptions(options);
  const exportElement = createExportClone(element);
  try {
    applyExportOptions(exportElement, exportOptions);
    await document.fonts?.ready;
    copyCanvasContents(element, exportElement);
    const canvas = await html2canvas(exportElement, {
      backgroundColor: "#f8fafc",
      scale: 2,
      windowWidth: exportElement.scrollWidth,
      windowHeight: exportElement.scrollHeight,
    });
    const image = canvas.toDataURL("image/png");
    const pdf = new jsPDF("p", "mm", "a4");
    const width = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const height = (canvas.height * width) / canvas.width;
    let y = 0;

    pdf.addImage(image, "PNG", 0, y, width, height);
    while (height + y > pageHeight) {
      y -= pageHeight;
      pdf.addPage();
      pdf.addImage(image, "PNG", 0, y, width, height);
    }

    pdf.save(exportOptions.fileName);
  } finally {
    exportElement.remove();
  }
}
