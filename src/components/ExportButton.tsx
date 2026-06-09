import { FileDown } from "lucide-react";
import { useState } from "react";
import { exportReport } from "../export/report";

export function ExportButton() {
  const [includeCodeGenerator, setIncludeCodeGenerator] = useState(false);

  return (
    <div className="export-controls">
      <label className="export-option">
        <input
          checked={includeCodeGenerator}
          onChange={(event) => setIncludeCodeGenerator(event.target.checked)}
          type="checkbox"
        />
        Include Code Generator
      </label>
      <button
        className="export-button"
        type="button"
        onClick={() => {
          const element = document.getElementById("report-root");
          if (element) void exportReport(element, { includeCodeGenerator });
        }}
      >
        <FileDown size={17} />
        Export PDF
      </button>
    </div>
  );
}
