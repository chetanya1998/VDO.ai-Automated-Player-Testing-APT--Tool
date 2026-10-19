# Pilot release results

Status on 19 October 2026: **blocked; no release decision**.

The mandatory manifest is [`tests/pilot/manifest.json`](../tests/pilot/manifest.json). It includes TC-1 through TC-23 from `CASES.json` and requires healthy plus fault-or-boundary observations on desktop and mobile, with three transitions for every TC-23 observation as required by Task 21. AI is disabled, so Task 19 is excluded.

| Measure | Observed result |
|---|---:|
| Labeled corpus records | 0 |
| Declared concurrency | unavailable |
| Submission-to-report p50 / p95 | unavailable |
| Diagnosis completeness | unavailable |
| False-positive rate | unavailable |
| Precision / recall | unavailable |
| Ambiguous joins | unavailable |
| Evidence/access defects | unavailable |
| Measured cost | unavailable |

No QA-labeled corpus, approved production profiles/pages, confirmed rule decisions, real mobile evidence, cost source or completed Task 20 deployment acceptance was supplied. Existing synthetic unit and fixture checks verify code behavior but are not pilot observations and are not used to manufacture accuracy or time-saving claims.

Run `pnpm pilot:evaluate -- observations.json results.json` after collecting the agreed corpus. The input must include the evidence-backed readiness record described in the [support runbook](support-runbook.md); caller-supplied readiness booleans are not accepted. The command validates every record, calculates the published measures, emits owned follow-up cards for QA disagreements and returns exit code `2` while any release gate fails. It requires:

- no healthy scenario reported as `FAIL`;
- every seeded critical fault reported as `FAIL`;
- ambiguous scenarios retained as `UNKNOWN`;
- evidence references for failures, warnings and diagnoses;
- exact TC/device healthy and fault-or-boundary coverage;
- three article transitions for TC-23;
- complete expected QA diagnoses and cost records;
- confirmed rule decisions and passed access, redaction and deployed-egress checks;
- a current Task 20 acceptance matching the browser image, every pilot profile and origin;
- real mobile and iOS evidence plus corpus and cost-source evidence;
- submission-to-report p95 no greater than 300 seconds under the declared concurrency.

Disagreements cannot be reviewed or converted into follow-up cards until observed validator results and QA labels exist. Release remains blocked rather than narrowing scope without owner approval.
