import { readFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { resolve } from "node:path";

const tagName = "v-example-site";
const dependencies = [
  "analytics.js",
  "allowed_url",
  "min.js",
  "ima3.js",
  "vdo.player.js",
  "prebid.js",
  "rtb.js",
] as const;

type TagMode = "single" | "missing" | "duplicate";
type PlayerState = "visible" | "hidden";
type LoaderMode = "ok" | "error" | "stall" | "slow";
type DemandMode = "matched" | "no_fill";
type LoggerMode = "healthy" | "malformed" | "blocked_ima" | "dependency_failure";

export interface FixtureScenario {
  id: string;
  title: string;
  sourceCaseIds: string[];
  tagMode: TagMode;
  playerState: PlayerState;
  loaderMode: LoaderMode;
  demandMode: DemandMode;
  loggerMode: LoggerMode;
  missingDependency: string | null;
  delayMs: number;
  articles: string[];
  expectedFailure: string | null;
}

export interface FixtureManifest {
  schemaVersion: number;
  synthetic: true;
  externalDemandAllowed: false;
  fixedTimestamp: string;
  scenarios: FixtureScenario[];
}

export interface FixtureRequest {
  method: string;
  path: string;
  scenarioId: string | null;
}

export interface FixtureServer {
  origin: string;
  requests: FixtureRequest[];
  scenarioUrl(id: string): string;
  stop(): Promise<void>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a string`);
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], name: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new TypeError(`${name} must be one of ${allowed.join(", ")}`);
  }
  return value as T;
}

export async function loadFixtureManifest(): Promise<FixtureManifest> {
  const raw: unknown = JSON.parse(await readFile(resolve("tests/fixtures/scenarios.json"), "utf8"));
  if (!isObject(raw) || raw.schemaVersion !== 1 || raw.synthetic !== true || raw.externalDemandAllowed !== false) {
    throw new TypeError("fixture manifest must be schema version 1, synthetic, and local-demand only");
  }
  requiredString(raw.fixedTimestamp, "fixedTimestamp");
  if (!Array.isArray(raw.scenarios) || raw.scenarios.length === 0) {
    throw new TypeError("fixture manifest must contain scenarios");
  }

  const ids = new Set<string>();
  for (const [index, value] of raw.scenarios.entries()) {
    if (!isObject(value)) throw new TypeError(`scenarios[${index}] must be an object`);
    const id = requiredString(value.id, `scenarios[${index}].id`);
    if (ids.has(id)) throw new TypeError(`duplicate scenario id: ${id}`);
    ids.add(id);
    requiredString(value.title, `scenarios[${index}].title`);
    oneOf(value.tagMode, ["single", "missing", "duplicate"], `scenarios[${index}].tagMode`);
    oneOf(value.playerState, ["visible", "hidden"], `scenarios[${index}].playerState`);
    oneOf(value.loaderMode, ["ok", "error", "stall", "slow"], `scenarios[${index}].loaderMode`);
    oneOf(value.demandMode, ["matched", "no_fill"], `scenarios[${index}].demandMode`);
    oneOf(value.loggerMode, ["healthy", "malformed", "blocked_ima", "dependency_failure"], `scenarios[${index}].loggerMode`);
    if (!Array.isArray(value.sourceCaseIds) || !value.sourceCaseIds.every((item) => /^TC-(?:[1-9]|1\d|2[0-3])$/.test(String(item)))) {
      throw new TypeError(`scenarios[${index}].sourceCaseIds must contain TC-1 through TC-23`);
    }
    if (!Number.isInteger(value.delayMs) || Number(value.delayMs) < 0) {
      throw new TypeError(`scenarios[${index}].delayMs must be a non-negative integer`);
    }
    if (!Array.isArray(value.articles) || value.articles.length === 0 || !value.articles.every((item) => typeof item === "string" && item.startsWith("/"))) {
      throw new TypeError(`scenarios[${index}].articles must contain local paths`);
    }
    if (value.missingDependency !== null && !dependencies.includes(value.missingDependency as typeof dependencies[number])) {
      throw new TypeError(`scenarios[${index}].missingDependency is unsupported`);
    }
    if (value.expectedFailure !== null) requiredString(value.expectedFailure, `scenarios[${index}].expectedFailure`);
  }
  return raw as unknown as FixtureManifest;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function response(res: ServerResponse, status: number, contentType: string, body = ""): void {
  res.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-vdo-fixture": "synthetic",
  });
  res.end(body);
}

function eventsFor(scenario: FixtureScenario): string[] {
  if (scenario.loggerMode === "blocked_ima") return ["loaded", "initVdo", "Blocked IMA", "Pageview"];
  if (scenario.loggerMode === "dependency_failure") return ["loaded"];
  const common = [
    "loaded", "initVdo", "Forceplay", "Auto_Plays", "Pageview", "Website Pageview",
    "Began ATF", "Came In View", "Ad Request",
  ];
  return scenario.demandMode === "no_fill"
    ? [...common, "Video Start"]
    : [...common, "Ad Match", "Video Loaded", "Video Start", "Website Pageview Match", "Pageview Match", "Viewable Impression"];
}

function loaderScript(scenario: FixtureScenario, fixedTimestamp: string): string {
  const config = JSON.stringify({ ...scenario, fixedTimestamp, tagName, dependencies });
  return `void (async()=>{const fixture=${config};
window.__VDO_SYNTHETIC_FIXTURE__=fixture;
localStorage.setItem('fixture-run',fixture.id);
document.cookie='fixture-run='+encodeURIComponent(fixture.id)+'; SameSite=Strict';
const post=async(event)=>fetch('/logger.php?scenario='+encodeURIComponent(fixture.id),{method:'POST',headers:{'content-type':'application/json','x-fixture-timestamp':fixture.fixedTimestamp},body:fixture.loggerMode==='malformed'?'{not-json':JSON.stringify({event,tagName:fixture.tagName,domainName:'publisher.example',page_url:location.href,dep:'dependencies_fixture_1'})});
if(fixture.articles.length>1){history.replaceState({},'',fixture.articles[0]);}
for(const name of fixture.dependencies){await fetch('/dependencies/'+encodeURIComponent(name)+'?scenario='+encodeURIComponent(fixture.id));}
for(const anchor of document.querySelectorAll('#'+CSS.escape(fixture.tagName))){anchor.dataset.syntheticPlayer='ready';anchor.textContent='Synthetic player ready';}
for(const event of ${JSON.stringify(eventsFor(scenario))}){await post(event);}
await fetch('/mock-demand?scenario='+encodeURIComponent(fixture.id));
for(const button of document.querySelectorAll('[data-article-url]')){button.addEventListener('click',async()=>{history.pushState({},'',button.dataset.articleUrl);await post('loaded');await post('Pageview');await post('Website Pageview');});}
document.querySelector('#fixture-status').value='complete';})().catch((error)=>{console.error(error);document.querySelector('#fixture-status').value='error';});`;
}

function renderPage(template: string, scenario: FixtureScenario): string {
  const count = scenario.tagMode === "duplicate" ? 2 : scenario.tagMode === "single" ? 1 : 0;
  const hidden = scenario.playerState === "hidden" ? "display:none" : "width:640px;height:360px";
  const anchors = Array.from({ length: count }, (_, index) =>
    `<div id="${tagName}" data-fixture-anchor="${index + 1}" style="${hidden}">Synthetic player pending</div>`,
  ).join("\n");
  const scripts = Array.from({ length: count }, () =>
    `<script data-synthetic-loader="true" src="/core/${tagName}/vdo.ai.js?scenario=${encodeURIComponent(scenario.id)}"></script>`,
  ).join("\n");
  const controls = scenario.articles.length > 1
    ? `<nav aria-label="Synthetic articles">${scenario.articles.map((article, index) => `<button type="button" data-article-url="${escapeHtml(article)}">Article ${index + 1}</button>`).join("")}</nav>`
    : "";
  const scenarioJson = JSON.stringify(scenario).replaceAll("<", "\\u003c");
  return template
    .replaceAll("{{SCENARIO_TITLE}}", escapeHtml(scenario.title))
    .replaceAll("{{SCENARIO_ID}}", escapeHtml(scenario.id))
    .replaceAll("{{ANCHORS}}", anchors)
    .replaceAll("{{ARTICLE_CONTROLS}}", controls)
    .replaceAll("{{EXPECTED_FAILURE}}", escapeHtml(scenario.expectedFailure ?? "none"))
    .replaceAll("{{SCENARIO_JSON}}", scenarioJson)
    .replaceAll("{{LOADER_SCRIPTS}}", scripts);
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const manifest = await loadFixtureManifest();
  const template = await readFile(resolve("tests/fixtures/player.html"), "utf8");
  const scenarios = new Map(manifest.scenarios.map((scenario) => [scenario.id, scenario]));
  const requests: FixtureRequest[] = [];
  const stalled = new Set<ServerResponse>();
  const timers = new Set<NodeJS.Timeout>();

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const scenarioId = url.searchParams.get("scenario") ?? (/^\/scenario\/([^/]+)$/.exec(url.pathname)?.[1] ?? null);
    requests.push({ method: req.method ?? "GET", path: url.pathname, scenarioId });

    if (url.pathname === "/health") return response(res, 200, "application/json", JSON.stringify({ synthetic: true }));
    if (url.pathname.startsWith("/scenario/") && scenarioId) {
      const scenario = scenarios.get(scenarioId);
      if (!scenario) return response(res, 404, "text/plain", "unknown scenario");
      res.setHeader("content-security-policy", "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'unsafe-inline'");
      return response(res, 200, "text/html; charset=utf-8", renderPage(template, scenario));
    }

    const loaderMatch = /^\/core\/([^/]+)\/vdo\.ai\.js$/.exec(url.pathname);
    if (loaderMatch && scenarioId) {
      const scenario = scenarios.get(scenarioId);
      if (!scenario || loaderMatch[1] !== tagName) return response(res, 404, "text/plain", "unknown loader");
      if (scenario.loaderMode === "error") return response(res, 503, "application/javascript", "throw new Error('synthetic loader failure');");
      if (scenario.loaderMode === "stall") {
        stalled.add(res);
        res.once("close", () => stalled.delete(res));
        return;
      }
      const send = () => response(res, 200, "application/javascript", loaderScript(scenario, manifest.fixedTimestamp));
      if (scenario.loaderMode === "slow") {
        const timer = setTimeout(() => { timers.delete(timer); send(); }, scenario.delayMs);
        timers.add(timer);
        return;
      }
      return send();
    }

    const dependencyMatch = /^\/dependencies\/([^/]+)$/.exec(url.pathname);
    if (dependencyMatch && scenarioId) {
      const scenario = scenarios.get(scenarioId);
      const name = dependencyMatch[1];
      if (!scenario || !name || !dependencies.includes(name as typeof dependencies[number])) return response(res, 404, "text/plain", "unknown dependency");
      if (scenario.missingDependency === name) {
        return response(res, name === "ima3.js" ? 403 : 404, "text/plain", "synthetic dependency failure");
      }
      return response(res, 200, "application/javascript", `window.__fixtureDependencies=(window.__fixtureDependencies||[]).concat(${JSON.stringify(name)});`);
    }

    if (url.pathname === "/logger.php" && req.method === "POST" && scenarioId && scenarios.has(scenarioId)) {
      req.resume();
      return response(res, 200, "application/json", JSON.stringify({ accepted: true, synthetic: true }));
    }
    if (url.pathname === "/mock-demand" && scenarioId) {
      const scenario = scenarios.get(scenarioId);
      if (!scenario) return response(res, 404, "text/plain", "unknown scenario");
      return scenario.demandMode === "no_fill"
        ? response(res, 204, "application/json")
        : response(res, 200, "application/json", JSON.stringify({ synthetic: true, matched: true }));
    }
    return response(res, 404, "text/plain", "not found");
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture server did not bind to a TCP port");
  const origin = `http://127.0.0.1:${address.port}`;

  return {
    origin,
    requests,
    scenarioUrl: (id) => `${origin}/scenario/${encodeURIComponent(id)}`,
    stop: async () => {
      for (const timer of timers) clearTimeout(timer);
      for (const response of stalled) response.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
    },
  };
}
