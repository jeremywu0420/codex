import type { Equation } from "../types";

interface Implicant {
  bits: string;
  terms: number[];
  used: boolean;
}

function countOnes(bits: string) {
  return bits.split("").filter((bit) => bit === "1").length;
}

function toBits(value: number, width: number) {
  return value.toString(2).padStart(width, "0");
}

function combineBits(a: string, b: string) {
  let diff = 0;
  let result = "";
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] === b[index]) result += a[index];
    else {
      diff += 1;
      result += "-";
    }
  }
  return diff === 1 ? result : null;
}

function covers(bits: string, minterm: number, width: number) {
  const target = toBits(minterm, width);
  return bits.split("").every((bit, index) => bit === "-" || bit === target[index]);
}

function uniqueImplicants(implicants: Implicant[]) {
  const map = new Map<string, Implicant>();
  for (const implicant of implicants) {
    const existing = map.get(implicant.bits);
    const terms = [...new Set([...(existing?.terms ?? []), ...implicant.terms])].sort((a, b) => a - b);
    map.set(implicant.bits, { bits: implicant.bits, terms, used: false });
  }
  return [...map.values()];
}

function bitsToTerm(bits: string, variables: string[]) {
  const parts = bits
    .split("")
    .map((bit, index) => {
      if (bit === "-") return "";
      return bit === "1" ? variables[index] : `${variables[index]}'`;
    })
    .filter(Boolean);
  return parts.length ? parts.join("") : "1";
}

export function minimizeBoolean(label: string, variableNames: string[], minterms: number[], dontCares: number[]): Equation {
  const width = variableNames.length;
  if (minterms.length === 0) {
    return { id: label, label, variableNames, minterms, dontCares, expression: "0" };
  }

  let current = uniqueImplicants(
    [...minterms, ...dontCares].map((term) => ({
      bits: toBits(term, width),
      terms: [term],
      used: false,
    })),
  );
  const primes: Implicant[] = [];

  while (current.length) {
    const next: Implicant[] = [];
    const groups = new Map<number, Implicant[]>();
    current.forEach((implicant) => {
      const group = countOnes(implicant.bits.replace(/-/g, ""));
      groups.set(group, [...(groups.get(group) ?? []), implicant]);
    });

    for (const [group, items] of groups) {
      for (const a of items) {
        for (const b of groups.get(group + 1) ?? []) {
          const combined = combineBits(a.bits, b.bits);
          if (!combined) continue;
          a.used = true;
          b.used = true;
          next.push({ bits: combined, terms: [...new Set([...a.terms, ...b.terms])], used: false });
        }
      }
    }

    primes.push(...current.filter((implicant) => !implicant.used));
    current = uniqueImplicants(next);
  }

  const realPrimes = uniqueImplicants(primes).filter((implicant) =>
    implicant.terms.some((term) => minterms.includes(term)),
  );
  const selected = new Set<string>();
  const uncovered = new Set(minterms);

  for (const minterm of minterms) {
    const covering = realPrimes.filter((prime) => covers(prime.bits, minterm, width));
    if (covering.length === 1) selected.add(covering[0].bits);
  }

  for (const bits of selected) {
    for (const minterm of [...uncovered]) {
      if (covers(bits, minterm, width)) uncovered.delete(minterm);
    }
  }

  while (uncovered.size) {
    const best = realPrimes
      .filter((prime) => !selected.has(prime.bits))
      .sort(
        (a, b) =>
          [...uncovered].filter((term) => covers(b.bits, term, width)).length -
          [...uncovered].filter((term) => covers(a.bits, term, width)).length,
      )[0];
    if (!best) break;
    selected.add(best.bits);
    for (const minterm of [...uncovered]) {
      if (covers(best.bits, minterm, width)) uncovered.delete(minterm);
    }
  }

  return {
    id: label,
    label,
    variableNames,
    minterms,
    dontCares,
    expression: [...selected].map((bits) => bitsToTerm(bits, variableNames)).join(" + "),
  };
}
