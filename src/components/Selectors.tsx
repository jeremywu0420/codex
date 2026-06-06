import type { FlipFlopType, ModelType } from "../types";
import { useCircuitStore } from "../store/useCircuitStore";

const models: ModelType[] = ["mealy", "moore"];
const flipFlops: FlipFlopType[] = ["jk", "t", "sr", "d"];

export function Selectors() {
  const { modelType, flipFlopType, setModelType, setFlipFlopType } = useCircuitStore();

  return (
    <section className="control-block selector-panel">
      <div>
        <p className="control-title">1. Model Type</p>
        <div className="radio-list">
          {models.map((model) => (
            <label key={model}>
              <input
                checked={modelType === model}
                name="model-type"
                onChange={() => setModelType(model)}
                type="radio"
              />
              {model === "mealy" ? "Mealy Model" : "Moore Model"}
            </label>
          ))}
        </div>
      </div>

      <div>
        <p className="control-title">2. Flip-Flop Type</p>
        <div className="radio-list">
          {flipFlops.map((item) => (
            <label key={item}>
              <input
                checked={flipFlopType === item}
                name="flipflop-type"
                onChange={() => setFlipFlopType(item)}
                type="radio"
              />
              {item.toUpperCase()} Flip-Flop
            </label>
          ))}
        </div>
      </div>
    </section>
  );
}
