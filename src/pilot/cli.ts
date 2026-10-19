import { readFile, writeFile } from "node:fs/promises";
import { evaluatePilot } from "./evaluate.js";

async function main(): Promise<void> {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (inputPath === undefined) throw new Error("usage: pilot:evaluate <observations.json> [results.json]");
  const result = evaluatePilot(JSON.parse(await readFile(inputPath, "utf8")) as unknown);
  const rendered = `${JSON.stringify(result, null, 2)}\n`;
  if (outputPath === undefined) process.stdout.write(rendered);
  else await writeFile(outputPath, rendered, { encoding: "utf8", flag: "wx" });
  if (!result.releaseReady) process.exitCode = 2;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
