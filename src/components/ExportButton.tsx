import { FileDown } from "lucide-react";
import { exportReport } from "../export/report";

export function ExportButton() {
  return (
    <button
      className="export-button"
      type="button"
      onClick={() => {
        const element = document.getElementById("report-root");
        if (element) void exportReport(element);
      }}
    >
      <FileDown size={17} />
      Export PDF
    </button>
  );
}
