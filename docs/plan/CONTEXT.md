# Player validator shared context

Goal: cover required TC-1 through TC-23 and retain the original RCA capabilities. Target a useful report within 300 seconds per admitted URL/device/scenario run; matrix and batch duration are separate.

Stack: TypeScript, Node.js, Playwright, React, PostgreSQL. CLI first; then one API/worker and job table. Browser-observed logger validation works without backend API access.

Logger body fields: event, tagName, domainName, page_url, dep only. Keep browser request metadata separately. Raw names need confirmed aliases. The five fields do not prove unique backend session/auction identity.

Check verdicts: PASS, FAIL, WARNING, UNKNOWN, NOT_APPLICABLE. Keep execution state and coverage separate. Categories include Implementation, Runtime/Browser and INVESTIGATE Demand. Every finding cites evidence. Preserve the earliest supported failure; later success cannot erase it. Expected blocks warn; no fill is not automatically a defect.

Scope counts by run/article/tag, and snapshot URL at request start. Track physical page load separately from article epoch. The SPA scenario visits at least three distinct articles, requiring at least two article transitions. Draft contract: one loaded and pageview per article/tag. Floating units need no anchor.

Desktop and mobile coverage are required. Emulation cannot prove real iOS behavior. Tablets/CTV remain deferred. Tag/product mappings, aliases, blocking, timing, URL and SPA rules are versioned profile inputs; unresolved rules appear in DECISIONS.md.

Use only controlled fixtures before deployment controls. Apply egress isolation, secret redaction and authenticated evidence access. AI explains deterministic results without changing verdicts.

Read one card and only its mapped CASE-COVERAGE.md and DECISIONS.md rows. Keep changes focused, run acceptance checks, update STATUS.md, then stop. Task IDs are stable; follow TASKS.md order, not numeric order.
