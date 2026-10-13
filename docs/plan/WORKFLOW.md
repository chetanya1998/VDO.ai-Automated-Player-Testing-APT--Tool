# Implementing one task with compact context

Use this prompt with the shared context and one task card:

```text
Implement task <ID> from the supplied card.
Read CONTEXT.md, STATUS.md, the card, its mapped case rows and applicable
DECISIONS.md rows first, then inspect only relevant
code and its callers. Follow repository instructions. Confirm dependencies
are complete. Make the smallest complete change and run the card's checks.
Do not invent VDO.ai schemas or add future features. If an input is missing,
state the blocker; use an explicitly synthetic fixture only where allowed.
Update STATUS.md. Finish with changes, checks, limitations and next task.
Stop after this task. Use Ponytail's minimal-change approach if available.
```

1. Start at task 01 and follow TASKS.md execution order; later IDs may be prerequisites. Keep the full plan for milestone decisions, not as repeated implementation context.
2. Aim for a context packet under about 1,000 words before necessary code and test evidence. This is a working limit, not a guarantee of total token usage.
3. Read dependencies' resulting interfaces and short handoffs; do not replay their whole conversations.
4. Use targeted file searches and small excerpts. For logs, start with the failure summary and expand only the relevant evidence.
5. Run focused tests during the task and the milestone regression at its gate. Keep security and correctness checks even when they cost tokens.
6. When acceptance criteria pass, stop. Avoid opportunistic refactors and repeated unchanged test runs.
7. Start a fresh implementation chat when the context becomes noisy, carrying CONTEXT.md, the next card and the latest handoff. Do not start simultaneous dependent tasks.
8. Record actual input/output tokens when tooling exposes them, otherwise mark them unavailable. Compare accepted tasks of similar scope; shorter replies alone do not prove savings.

Keep each handoff to roughly 150 words: task and status; changed files; checks and results; decisions or contract changes; blockers; next eligible task. Preserve earlier evidence links while keeping the current summary short.

Review at milestone boundaries. Use ponytail-review for a focused diff review if needed; reserve whole-repository audits for a release or a concrete concern.

The full case matrix is a reference, not repeated prompt context. A case is complete only when its scenarios pass for the supported profile. Record rule uncertainty, missing device evidence and fixture-only results explicitly.
