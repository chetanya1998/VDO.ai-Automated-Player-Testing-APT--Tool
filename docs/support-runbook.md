# Pilot support runbook

## Late logger evidence

Keep the run deadline and observation window recorded with the report. If expected logger traffic starts after capture closes, retain the report as incomplete or `UNKNOWN`; do not convert absence into a product failure. Preserve the late request as separate evidence when available and start a new run if the approved window must be repeated. Do not edit a finalized report or merge evidence across runs.

## Unsupported profiles

Reject profiles that lack confirmed aliases, rules, expected tags, resource origins, device policy or site actions. Use `NOT_APPLICABLE` only when a confirmed profile says the case does not apply. Use `UNKNOWN` when evidence or policy is missing. Never substitute a nearby product, tag or hostname mapping.

## Incomplete captures

Keep the execution state, collection gaps and partial evidence. Check browser cleanup, queue deadline, response-body limits, service-worker visibility and artifact availability. Retry with a new run ID only after fixing the capture cause; browser ad activity is not replayed automatically. A partial capture cannot produce a healthy release observation.

## Disagreements

Compare the validator check, cited evidence and probable cause with the QA label. Classify the disagreement as rule decision, collection defect, identity/join ambiguity, unsupported profile, expected-label error or validator defect. Record the owning team from the existing decision/RCA policy. After the owner confirms the expected behavior, create one narrow follow-up card containing the scenario, expected and actual result, evidence IDs, affected TC/device/profile, and a deterministic regression case. Do not weaken a gate by averaging the disagreement away.

## Evaluation procedure

Collect one observation record per TC, scenario and device. Record submission/report timestamps from the real API, the expected and actual verdict, QA diagnosis code, all evidence IDs, ambiguous join count, article transitions and measured cost. Run the evaluator under the declared concurrency and archive both input and output with the deployment version. Exit code `0` means every encoded gate passed; exit code `2` means the result is measured but not releasable; exit code `1` means the input itself is invalid.
