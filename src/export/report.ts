import html2canvas from "html2canvas";
import jsPDF from "jspdf";

export async function exportReport(element: HTMLElement, fileName = "logic-circuit-report.pdf") {
  const canvas = await html2canvas(element, {
    backgroundColor: "#f8fafc",
    scale: 2,
  });
  const image = canvas.toDataURL("image/png");
  const pdf = new jsPDF("p", "mm", "a4");
  const width = pdf.internal.pageSize.getWidth();
  const height = (canvas.height * width) / canvas.width;
  pdf.addImage(image, "PNG", 0, 0, width, Math.min(height, pdf.internal.pageSize.getHeight()));
  pdf.save(fileName);
}
