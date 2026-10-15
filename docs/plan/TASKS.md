# Player validator execution order

29 focused tasks cover all 23 required cases plus the original RCA product scope. Tasks 01 through 08, tasks 11–13, tasks 22–24, and task 29 are complete; task 25 is next and the remaining tasks are unstarted. Stable IDs are deliberately ordered by dependencies below; do not run them numerically.

| Order | Task | Dependencies |
|---|---|---|
| 1 | [01 Define the first supported integration](tasks/01.md) | None |
| 2 | [02 Create the skeleton and shared contracts](tasks/02.md) | 01 |
| 3 | [03 Build controlled player fixtures](tasks/03.md) | 02 |
| 4 | [04 Implement bounded browser execution](tasks/04.md) | 02, 03 |
| 5 | [05 Capture browser evidence](tasks/05.md) | 04 |
| 6 | [22 Parse and validate browser logger payloads](tasks/22.md) | 02, 03, 05 |
| 7 | [23 Resolve expected tags and domain profiles](tasks/23.md) | 02, 03 |
| 8 | [06 Normalize evidence and test profiles](tasks/06.md) | 05, 22 |
| 9 | [07 Validate tags duplicates and DOM placement](tasks/07.md) | 06, 23 |
| 10 | [24 Measure script and logger timing](tasks/24.md) | 06 |
| 11 | [08 Produce the first deterministic report](tasks/08.md) | 07, 22, 24 |
| 12 | [11 Validate browser logger lifecycles and counts](tasks/11.md) | 08, 22 |
| 13 | [29 Classify blocked events and dependency failures](tasks/29.md) | 11 |
| 14 | [12 Validate ad request outcomes](tasks/12.md) | 06, 11 |
| 15 | [13 Validate auction precedence and fallback](tasks/13.md) | 11, 12 |
| 16 | [25 Validate visibility formation and viewability](tasks/25.md) | 07, 11 |
| 17 | [26 Validate article URLs and SPA lifecycle](tasks/26.md) | 07, 11, 23 |
| 18 | [27 Run desktop and mobile case suites](tasks/27.md) | 12, 25, 26, 29 |
| 19 | [14 Rank probable causes using evidence](tasks/14.md) | 08, 11, 12, 13, 24, 25, 26, 29 |
| 20 | [15 Persist runs and process jobs](tasks/15.md) | 14 |
| 21 | [16 Expose an authenticated run API](tasks/16.md) | 15 |
| 22 | [17 Build the dashboard and event timeline](tasks/17.md) | 16 |
| 23 | [18 Export a shareable technical report](tasks/18.md) | 17 |
| 24 | [28 Add bounded bulk URL validation](tasks/28.md) | 16, 18 |
| 25 | [20 Harden and deploy the internal pilot](tasks/20.md) | 16, 18 |
| 26 | [21 Measure the pilot and decide release](tasks/21.md) | 17, 18, 20, 27, 28 |
| 27 | [09 Add optional backend logger verification](tasks/09.md) | 06, 08 |
| 28 | [10 Correlate browser and logger events](tasks/10.md) | 09, 26 |
| 29 | [19 Add optional AI explanations](tasks/19.md) | 14, 18 |

Tasks 09/10 are backend-verification extensions; task 19 is optional AI. Neither gates the browser-only 23-case suite. Task 13 retains configured auction precedence from the original RCA brief. Read [CASE-COVERAGE.md](CASE-COVERAGE.md) for scenario-level acceptance and [DECISIONS.md](DECISIONS.md) for unresolved rules.
