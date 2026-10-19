import { readFile } from "node:fs/promises";
import { parseProductionContract } from "./contract.js";

const path = process.argv[2];
if (path === undefined) {
  console.error("usage: pnpm production:validate <production-contract.json>");
  process.exitCode = 1;
} else {
  void readFile(path, "utf8")
    .then((content) => parseProductionContract(JSON.parse(content)))
    .then((contract) => console.log(JSON.stringify({ contractId: contract.contractId, status: contract.status, approvedAt: contract.approvedAt, production: contract.environments.production }, null, 2)))
    .catch((cause: unknown) => {
      console.error(cause instanceof Error ? cause.message : "Production contract validation failed");
      process.exitCode = 1;
    });
}
