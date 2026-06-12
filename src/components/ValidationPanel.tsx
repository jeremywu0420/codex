import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { useCircuitStore } from "../store/useCircuitStore";
import { VerificationPanel } from "./VerificationPanel";
import type { LintSeverity } from "../lib/designLint";

const severityOrder: LintSeverity[] = ["error", "warning", "info"];

function SeverityIcon({ severity }: { severity: LintSeverity }) {
  if (severity === "error") return <XCircle size={15} />;
  if (severity === "warning") return <AlertTriangle size={15} />;
  return <Info size={15} />;
}

export function ValidationPanel() {
  const lint = useCircuitStore((state) => state.lint);
  const sortedIssues = [...lint.issues].sort(
    (first, second) => severityOrder.indexOf(first.severity) - severityOrder.indexOf(second.severity),
  );

  return (
    <div className="validation-stack">
      <section className="panel output-panel lint-panel">
        <h2>
          Design Check
          <span className="panel-hint">static checks on the state table input</span>
        </h2>
        {sortedIssues.length === 0 ? (
          <div className="lint-clear">
            <CheckCircle2 size={17} />
            No issues found. The state table is complete and every state is reachable.
          </div>
        ) : (
          <ul className="lint-list">
            {sortedIssues.map((issue, index) => (
              <li className={`lint-item ${issue.severity}`} key={`${issue.code}-${index}`}>
                <SeverityIcon severity={issue.severity} />
                <div>
                  <span className="lint-code">{issue.severity.toUpperCase()} · {issue.code}</span>
                  <p>{issue.message}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <VerificationPanel />
    </div>
  );
}
