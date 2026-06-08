import html2canvas from "html2canvas";
import jsPDF from "jspdf";

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

export async function exportReport(element: HTMLElement, fileName = "logic-circuit-report.pdf") {
  const exportElement = createExportClone(element);
  try {
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
    const height = (canvas.height * width) / canvas.width;
    pdf.addImage(image, "PNG", 0, 0, width, Math.min(height, pdf.internal.pageSize.getHeight()));
    pdf.save(fileName);
  } finally {
    exportElement.remove();
  }
}
