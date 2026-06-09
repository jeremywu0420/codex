import { useCircuitStore } from "../store/useCircuitStore";

function valueOrDash(value: string | undefined) {
  return value && value.length ? value : "-";
}

export function VerificationPanel() {
  const verification = useCircuitStore((state) => state.verification);
  const status = !verification.passed ? "fail" : verification.warnings.length ? "warning" : "pass";
  const statusText = status === "fail" ? "FAIL" : status === "warning" ? "WARNING" : "PASS";

  return (
    <section className="panel verification-panel">
      <div className="verification-header">
        <h2>Verification Result</h2>
        <span className={`verification-badge ${status}`}>{statusText}</span>
      </div>

      <div className="verification-checks">
        {verification.checks.map((check) => (
          <div className={`verification-check ${check.skipped ? "skipped" : check.passed ? "pass" : "fail"}`} key={check.name}>
            <strong>{check.name}</strong>
            <span>{check.skipped ? "SKIPPED" : check.passed ? "PASS" : "FAIL"}</span>
            <p>{check.message}</p>
          </div>
        ))}
      </div>

      {verification.warnings.length ? (
        <div className="verification-section">
          <h3>Warnings</h3>
          <ul className="verification-list">
            {verification.warnings.map((warning, index) => (
              <li key={`${warning.type}-${index}`}>
                <strong>{warning.type}</strong>: {warning.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {verification.mismatches.length ? (
        <div className="verification-section">
          <h3>Mismatches</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Present State</th>
                  <th>Input</th>
                  <th>Expected Next</th>
                  <th>Actual Next</th>
                  <th>Expected Output</th>
                  <th>Actual Output</th>
                  <th>Suspected Equation</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {verification.mismatches.map((mismatch, index) => (
                  <tr key={`${mismatch.type}-${index}`}>
                    <td>{mismatch.type}</td>
                    <td>{valueOrDash(mismatch.presentState)}</td>
                    <td>{valueOrDash(mismatch.input)}</td>
                    <td>{valueOrDash(mismatch.expectedNextState)}</td>
                    <td>{valueOrDash(mismatch.actualNextState)}</td>
                    <td>{valueOrDash(mismatch.expectedOutput)}</td>
                    <td>{valueOrDash(mismatch.actualOutput)}</td>
                    <td>{valueOrDash(mismatch.suspectedEquation)}</td>
                    <td className="verification-message-cell">{mismatch.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
