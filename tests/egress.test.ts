import assert from "node:assert/strict";
import test from "node:test";
import { browserProcessEnvironment } from "../src/browser/run.js";
import {
  NetworkUrlGuard,
  ResolvedAddressGuard,
  UrlPolicyError,
  createBrowserUrlPolicy,
  isPublicNetworkAddress,
} from "../src/browser/url-policy.js";

test("production address policy rejects private, link-local, metadata and reserved ranges", () => {
  for (const address of [
    "0.0.0.0", "10.4.3.2", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1",
    "192.168.1.1", "198.18.0.1", "224.0.0.1", "255.255.255.255", "::", "::1", "fc00::1",
    "fd12::1", "fe80::1", "ff02::1", "2001:db8::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254",
  ]) assert.equal(isPublicNetworkAddress(address), false, address);
  for (const address of ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111", "2001:4860:4860::8888"]) {
    assert.equal(isPublicNetworkAddress(address), true, address);
  }
});

test("remote guard admits an approved public host and its websocket only", async () => {
  const guard = new NetworkUrlGuard(createBrowserUrlPolicy(["https://1.1.1.1"], true));
  assert.equal((await guard.assertAllowed("https://1.1.1.1/article")).pathname, "/article");
  assert.equal((await guard.assertAllowed("wss://1.1.1.1/events")).protocol, "wss:");
  await assert.rejects(guard.assertAllowed("https://internal.example/"), UrlPolicyError);
});

test("remote guard rejects public-to-private resolution and DNS rebinding", async () => {
  const policy = createBrowserUrlPolicy(["https://1.1.1.1", "https://169.254.169.254"], true);
  const redirectGuard = new NetworkUrlGuard(policy);
  await redirectGuard.assertAllowed("https://1.1.1.1/start");
  await assert.rejects(redirectGuard.assertAllowed("https://169.254.169.254/metadata"), /non-public address/);

  const rebindingGuard = new ResolvedAddressGuard();
  rebindingGuard.assertPublic("publisher.example", ["1.1.1.1"]);
  assert.throws(() => rebindingGuard.assertPublic("publisher.example", ["8.8.8.8"]), /changed addresses/);
});

test("browser child environment excludes backend and collector credentials", () => {
  const child = browserProcessEnvironment({
    PATH: "C:\\safe-bin",
    TEMP: "C:\\temp",
    DATABASE_URL: "postgres://secret",
    VDO_VALIDATOR_API_IDENTITIES: "secret-token",
    LOGGER_CREDENTIALS: "collector-secret",
  });
  assert.deepEqual(child, { PATH: "C:\\safe-bin", TEMP: "C:\\temp" });
});
