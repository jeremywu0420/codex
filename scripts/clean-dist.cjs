const { rmSync } = require("node:fs");
const { resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

const root = resolve(__dirname, "..");
const target = resolve(root, "dist");

if (!target.startsWith(root)) {
  throw new Error(`Refusing to clean outside project root: ${target}`);
}

if (process.platform === "win32") {
  const command = [
    "$ErrorActionPreference = 'Stop'",
    `$target = ${JSON.stringify(target)}`,
    "if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }",
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
} else {
  rmSync(target, { recursive: true, force: true });
}
