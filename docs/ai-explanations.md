# Optional AI explanations

Task 19 adds an opt-in explanation layer around the deterministic report. AI output is separate from the report and cannot alter checks, verdicts, diagnoses or evidence. A healthy `PASS` report does not call a provider even when explanation was requested.

## Provider policy

The caller must supply a versioned policy, a bearer token and an explicit `requested: true` flag. The selected model must appear in `approvedModels`. Production endpoints must use HTTPS; loopback HTTP is accepted only for local contract testing.

```json
{
  "schemaVersion": 1,
  "endpoint": "https://approved-provider.example/v1/explain",
  "model": "approved-model-version",
  "approvedModels": ["approved-model-version"],
  "maxInputTokens": 2000,
  "maxOutputTokens": 300,
  "timeoutMs": 5000,
  "maxFindings": 5,
  "maxEvidence": 10
}
```

The implementation also applies fixed ceilings of 12,000 estimated input tokens, 1,500 output tokens, 20 seconds and 256 KB of response data. Redirects are rejected so the bearer token cannot move to another endpoint.

## Request contract

Only bounded diagnoses and evidence cited by those diagnoses are selected. Values pass through the report redactor, long strings and collections are truncated, and the payload marks the entire selection as `untrusted_validator_data`. The system instruction tells the model to ignore instructions inside supplied data, preserve deterministic verdicts, label causes as probable and cite only supplied evidence IDs.

The POST body includes the model, prompt version, token budgets, structured-output request, trusted system instruction and bounded untrusted report data.

## Response contract

```json
{
  "schemaVersion": 1,
  "model": "approved-model-version",
  "output": {
    "summary": "Explanation of the deterministic findings.",
    "probableCauses": [
      {
        "title": "Layout obstruction",
        "explanation": "Measured coverage probably prevented visibility.",
        "evidenceIds": ["ev-layout"]
      }
    ]
  },
  "usage": {
    "inputTokens": 420,
    "outputTokens": 60,
    "totalTokens": 480
  }
}
```

The response model must remain approved. Probable causes and evidence references are bounded, every evidence ID must have been supplied, and reported usage cannot exceed the configured budgets. Usage may be omitted when the provider does not expose it.

Timeouts, HTTP failures, oversized responses, malformed output, budget violations, unapproved models and invented evidence IDs return deterministic fallback text. The result retains the source report ID, overall verdict and all per-case verdicts. Provider credentials are never returned.

No production model policy or credential is committed. Local acceptance uses a real loopback HTTP contract service with sanitized input; an external provider smoke test remains unavailable until an approved model and credential are supplied.
