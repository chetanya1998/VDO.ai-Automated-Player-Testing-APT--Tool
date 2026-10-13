import { readFile } from "node:fs/promises";
import { parseProfile } from "./contracts.js";

async function main(): Promise<void> {
  const [command, path] = process.argv.slice(2);
  if (command !== "validate-profile" || !path) {
    throw new Error("usage: validate-profile <profile.json>");
  }

  const profile = parseProfile(JSON.parse(await readFile(path, "utf8")));
  console.log(JSON.stringify({
    profileId: profile.profileId,
    profileStatus: profile.profileStatus,
    approvedUrls: profile.site.approvedUrls,
    devices: profile.devices.map((device) => device.id),
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
