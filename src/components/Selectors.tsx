import type { FlipFlopType, ModelType } from "../types";
import { useCircuitStore } from "../store/useCircuitStore";

const models: { id: ModelType; label: string }[] = [
  { id: "mealy", label: "Mealy" },
  { id: "moore", label: "Moore" },
];
const flipFlops: FlipFlopType[] = ["d", "t", "jk", "sr"];

export function Selectors() {
  const { modelType, flipFlopType, setModelType, setFlipFlopType } = useCircuitStore();

  return (
    <section className="control-block selector-panel">
      <div>
        <p className="control-title">1. Model Type</p>
        <div className="segmented" role="radiogroup" aria-label="Model Type">
          {models.map((model) => (
            <button
              aria-pressed={modelType === model.id}
              className={modelType === model.id ? "active" : ""}
              key={model.id}
              onClick={() => setModelType(model.id)}
              type="button"
            >
              {model.label}
            </button>
          ))}
        </div>
        <p className="model-note">
          {modelType === "moore"
            ? "Moore: output depends only on the present state."
            : "Mealy: output depends on the present state and the input."}
        </p>
      </div>

      <div>
        <p className="control-title">2. Flip-Flop Type</p>
        <div className="segmented" role="radiogroup" aria-label="Flip-Flop Type">
          {flipFlops.map((item) => (
            <button
              aria-pressed={flipFlopType === item}
              className={flipFlopType === item ? "active" : ""}
              key={item}
              onClick={() => setFlipFlopType(item)}
              type="button"
            >
              {item.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
