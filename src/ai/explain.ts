import type { TestCaseId, Verdict } from "../contracts.js";
import type { DeterministicReport } from "../report/build.js";
import { AI_PROMPT_VERSION, aiSystemInstruction, buildAiPromptData } from "./prompt.js";

const HARD_MAX_INPUT_TOKENS = 12_000;
const HARD_MAX_OUTPUT_TOKENS = 1_500;
const HARD_MAX_TIMEOUT_MS = 20_000;
const HARD_MAX_RESPONSE_BYTES = 256_000;

export interface AiExplanationPolicy {
  schemaVersion: 1;
  endpoint: string;
  model: string;
  approvedModels: string[];
  maxInputTokens: number;
  maxOutputTokens: number;
  timeoutMs: number;
  maxFindings: number;
  maxEvidence: number;
}

export interface ProbableCauseExplanation {
  label: "Probable cause";
  title: string;
  explanation: string;
  evidenceIds: string[];
}

export interface AiExplanationText {
  summary: string;
  probableCauses: ProbableCauseExplanation[];
}

export interface AiExplanationResult {
  schemaVersion: 1;
  status: "completed" | "fallback" | "skipped";
  reason: string;
  reportId: string;
  sourceOverallVerdict: Verdict;
  sourceCheckVerdicts: Array<{ testCaseId: TestCaseId; verdict: Verdict }>;
  explanation: AiExplanationText;
  provider: null | {
    model: string;
    promptVersion: string;
    usage: null | { inputTokens: number; outputTokens: number; totalTokens: number };
  };
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${path} must be a non-empty string`);
  return value;
}

function integer(value: unknown, path: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) throw new TypeError(`${path} must be an integer from ${minimum} to ${maximum}`);
  return Number(value);
}

function endpoint(value: unknown): string {
  const raw = text(value, "AI policy.endpoint");
  const parsed = new URL(raw);
  const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]" || parsed.hostname === "localhost";
  if ((parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) || parsed.username || parsed.password) {
    throw new TypeError("AI policy.endpoint must be HTTPS, except loopback HTTP used for local contract tests, and contain no credentials");
  }
  return parsed.href;
}

export function parseAiExplanationPolicy(value: unknown): AiExplanationPolicy {
  const input = object(value, "AI policy");
  if (input.schemaVersion !== 1) throw new TypeError("AI policy.schemaVersion must be 1");
  if (!Array.isArray(input.approvedModels) || input.approvedModels.length === 0) throw new TypeError("AI policy.approvedModels must not be empty");
  const approvedModels = input.approvedModels.map((item, index) => text(item, `AI policy.approvedModels[${index}]`));
  const model = text(input.model, "AI policy.model");
  if (!approvedModels.includes(model)) throw new TypeError("AI policy.model is not approved");
  return {
    schemaVersion: 1,
    endpoint: endpoint(input.endpoint),
    model,
    approvedModels,
    maxInputTokens: integer(input.maxInputTokens, "AI policy.maxInputTokens", 100, HARD_MAX_INPUT_TOKENS),
    maxOutputTokens: integer(input.maxOutputTokens, "AI policy.maxOutputTokens", 50, HARD_MAX_OUTPUT_TOKENS),
    timeoutMs: integer(input.timeoutMs, "AI policy.timeoutMs", 50, HARD_MAX_TIMEOUT_MS),
    maxFindings: integer(input.maxFindings, "AI policy.maxFindings", 1, 20),
    maxEvidence: integer(input.maxEvidence, "AI policy.maxEvidence", 1, 50),
  };
}

function source(report: DeterministicReport): Pick<AiExplanationResult, "reportId" | "sourceOverallVerdict" | "sourceCheckVerdicts"> {
  return {
    reportId: report.reportId,
    sourceOverallVerdict: report.overallVerdict,
    sourceCheckVerdicts: report.checks.map((check) => ({ testCaseId: check.testCaseId, verdict: check.verdict })),
  };
}

function deterministicText(report: DeterministicReport, reason: string): AiExplanationText {
  const failed = report.checks.filter((check) => check.verdict === "FAIL").length;
  const warnings = report.checks.filter((check) => check.verdict === "WARNING").length;
  const unknown = report.checks.filter((check) => check.verdict === "UNKNOWN").length;
  return {
    summary: `Deterministic validation retained: ${failed} failed, ${warnings} warning, ${unknown} unknown. AI explanation unavailable (${reason}).`,
    probableCauses: report.diagnoses.slice(0, 10).map((diagnosis) => ({
      label: "Probable cause",
      title: diagnosis.probableCause.summary,
      explanation: `Deterministic ${diagnosis.probableCause.basis}; confidence ${diagnosis.probableCause.confidence}.`,
      evidenceIds: [...diagnosis.probableCause.evidenceIds],
    })),
  };
}

async function boundedBody(response: Response): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let output = "";
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > HARD_MAX_RESPONSE_BYTES) throw new TypeError("AI provider response exceeds the fixed byte limit");
      output += decoder.decode(part.value, { stream: true });
    }
    return output + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function parseProviderResponse(value: unknown, allowedEvidence: ReadonlySet<string>, policy: AiExplanationPolicy): { explanation: AiExplanationText; model: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null } {
  const response = object(value, "AI provider response");
  if (response.schemaVersion !== 1) throw new TypeError("AI provider response.schemaVersion must be 1");
  const model = text(response.model, "AI provider response.model");
  if (!policy.approvedModels.includes(model)) throw new TypeError("AI provider returned an unapproved model");
  const output = object(response.output, "AI provider response.output");
  if (!Array.isArray(output.probableCauses)) throw new TypeError("AI provider response.output.probableCauses must be an array");
  if (output.probableCauses.length > policy.maxFindings) throw new TypeError("AI provider returned too many probable causes");
  const probableCauses = output.probableCauses.map((value, index): ProbableCauseExplanation => {
    const cause = object(value, `AI provider response.output.probableCauses[${index}]`);
    if (!Array.isArray(cause.evidenceIds)) throw new TypeError(`AI provider response.output.probableCauses[${index}].evidenceIds must be an array`);
    if (cause.evidenceIds.length > policy.maxEvidence) throw new TypeError(`AI provider response.output.probableCauses[${index}].evidenceIds exceeds the evidence limit`);
    const evidenceIds = cause.evidenceIds.map((item, evidenceIndex) => text(item, `AI provider response.output.probableCauses[${index}].evidenceIds[${evidenceIndex}]`));
    const missing = evidenceIds.filter((id) => !allowedEvidence.has(id));
    if (missing.length > 0) throw new TypeError(`AI provider referenced unavailable evidence: ${missing.join(", ")}`);
    return { label: "Probable cause", title: text(cause.title, `AI provider response.output.probableCauses[${index}].title`), explanation: text(cause.explanation, `AI provider response.output.probableCauses[${index}].explanation`), evidenceIds };
  });
  let usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null = null;
  if (response.usage !== undefined && response.usage !== null) {
    const raw = object(response.usage, "AI provider response.usage");
    usage = {
      inputTokens: integer(raw.inputTokens, "AI provider response.usage.inputTokens", 0, policy.maxInputTokens),
      outputTokens: integer(raw.outputTokens, "AI provider response.usage.outputTokens", 0, policy.maxOutputTokens),
      totalTokens: integer(raw.totalTokens, "AI provider response.usage.totalTokens", 0, policy.maxInputTokens + policy.maxOutputTokens),
    };
    if (usage.totalTokens !== usage.inputTokens + usage.outputTokens) throw new TypeError("AI provider usage totals are inconsistent");
  }
  return { explanation: { summary: text(output.summary, "AI provider response.output.summary"), probableCauses }, model, usage };
}

export async function explainReport(input: {
  requested: boolean;
  report: DeterministicReport;
  policy?: unknown;
  bearerToken?: string;
}): Promise<AiExplanationResult> {
  const base = source(input.report);
  if (!input.requested) return { schemaVersion: 1, status: "skipped", reason: "not_requested", ...base, explanation: deterministicText(input.report, "not requested"), provider: null };
  if (input.report.overallVerdict === "PASS") return { schemaVersion: 1, status: "skipped", reason: "healthy_report", ...base, explanation: { summary: "All deterministic checks passed; no AI explanation was needed.", probableCauses: [] }, provider: null };
  if (input.policy === undefined || input.bearerToken === undefined || input.bearerToken.trim() === "") {
    return { schemaVersion: 1, status: "fallback", reason: "provider_unavailable", ...base, explanation: deterministicText(input.report, "provider unavailable"), provider: null };
  }
  let policy: AiExplanationPolicy;
  try {
    policy = parseAiExplanationPolicy(input.policy);
  } catch {
    return { schemaVersion: 1, status: "fallback", reason: "invalid_policy", ...base, explanation: deterministicText(input.report, "invalid provider policy"), provider: null };
  }
  try {
    const promptData = buildAiPromptData(input.report, { maxFindings: policy.maxFindings, maxEvidence: policy.maxEvidence, maxInputCharacters: policy.maxInputTokens * 4 });
    const allowedEvidence = new Set(promptData.evidence.flatMap((value) => {
      if (value !== null && typeof value === "object" && !Array.isArray(value) && typeof value.evidenceId === "string") return [value.evidenceId];
      return [];
    }));
    const requestBody = JSON.stringify({
      schemaVersion: 1,
      model: policy.model,
      promptVersion: AI_PROMPT_VERSION,
      maxInputTokens: policy.maxInputTokens,
      maxOutputTokens: policy.maxOutputTokens,
      responseFormat: { type: "json_schema", schemaVersion: 1 },
      system: aiSystemInstruction(),
      input: { kind: "untrusted_validator_data", data: promptData },
    });
    if (requestBody.length > policy.maxInputTokens * 4) throw new TypeError("AI request exceeds the configured input token estimate");
    const response = await fetch(policy.endpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(policy.timeoutMs),
      headers: { authorization: `Bearer ${input.bearerToken}`, "content-type": "application/json" },
      body: requestBody,
    });
    if (!response.ok) throw new TypeError(`AI provider returned HTTP ${response.status}`);
    const parsed = parseProviderResponse(JSON.parse(await boundedBody(response)), allowedEvidence, policy);
    return { schemaVersion: 1, status: "completed", reason: "provider_completed", ...base, explanation: parsed.explanation, provider: { model: parsed.model, promptVersion: AI_PROMPT_VERSION, usage: parsed.usage } };
  } catch (error) {
    const reason = error instanceof DOMException && error.name === "TimeoutError" ? "provider_timeout" : "provider_error";
    return {
      schemaVersion: 1,
      status: "fallback",
      reason,
      ...base,
      explanation: deterministicText(input.report, reason),
      provider: { model: policy.model, promptVersion: AI_PROMPT_VERSION, usage: null },
    };
  }
}
