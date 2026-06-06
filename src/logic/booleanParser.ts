export type BooleanAst =
  | { type: "CONST"; value: "0" | "1" }
  | { type: "VAR"; name: string }
  | { type: "NOT"; value: BooleanAst }
  | { type: "AND"; terms: BooleanAst[] }
  | { type: "OR"; terms: BooleanAst[] };

type Token =
  | { type: "VAR"; value: string }
  | { type: "CONST"; value: "0" | "1" }
  | { type: "PLUS" | "APOSTROPHE" | "LPAREN" | "RPAREN" };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < input.length) {
    const char = input[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "+") {
      tokens.push({ type: "PLUS" });
      index += 1;
      continue;
    }
    if (char === "'") {
      tokens.push({ type: "APOSTROPHE" });
      index += 1;
      continue;
    }
    if (char === "(") {
      tokens.push({ type: "LPAREN" });
      index += 1;
      continue;
    }
    if (char === ")") {
      tokens.push({ type: "RPAREN" });
      index += 1;
      continue;
    }
    if (char === "0" || char === "1") {
      tokens.push({ type: "CONST", value: char });
      index += 1;
      continue;
    }
    if (/[A-Za-z]/.test(char)) {
      let name = char;
      index += 1;
      while (index < input.length && /[0-9]/.test(input[index])) {
        name += input[index];
        index += 1;
      }
      tokens.push({ type: "VAR", value: name });
      continue;
    }
    throw new Error(`Unsupported boolean token: ${char}`);
  }

  return tokens;
}

export function parseBooleanEquation(input: string): BooleanAst {
  const tokens = tokenize(input);
  let index = 0;

  function peek() {
    return tokens[index];
  }

  function consume(type: Token["type"]) {
    const token = tokens[index];
    if (!token || token.type !== type) throw new Error(`Expected ${type}`);
    index += 1;
    return token;
  }

  function startsFactor(token: Token | undefined) {
    return token?.type === "VAR" || token?.type === "CONST" || token?.type === "LPAREN";
  }

  function parsePrimary(): BooleanAst {
    const token = peek();
    if (!token) throw new Error("Unexpected end of equation");
    if (token.type === "VAR") {
      index += 1;
      return { type: "VAR", name: token.value };
    }
    if (token.type === "CONST") {
      index += 1;
      return { type: "CONST", value: token.value };
    }
    if (token.type === "LPAREN") {
      consume("LPAREN");
      const value = parseSum();
      consume("RPAREN");
      return value;
    }
    throw new Error(`Unexpected token ${token.type}`);
  }

  function parsePostfix(): BooleanAst {
    let node = parsePrimary();
    while (peek()?.type === "APOSTROPHE") {
      consume("APOSTROPHE");
      node = { type: "NOT", value: node };
    }
    return node;
  }

  function parseProduct(): BooleanAst {
    const terms: BooleanAst[] = [parsePostfix()];
    while (startsFactor(peek())) terms.push(parsePostfix());
    return terms.length === 1 ? terms[0] : { type: "AND", terms };
  }

  function parseSum(): BooleanAst {
    const terms: BooleanAst[] = [parseProduct()];
    while (peek()?.type === "PLUS") {
      consume("PLUS");
      terms.push(parseProduct());
    }
    return terms.length === 1 ? terms[0] : { type: "OR", terms };
  }

  if (!tokens.length) return { type: "CONST", value: "0" };
  const ast = parseSum();
  if (index !== tokens.length) throw new Error("Unexpected trailing tokens");
  return ast;
}
