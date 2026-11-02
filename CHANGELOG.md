# Changelog

All notable changes to this repository, newest first. The repository holds two applications: the **APT Validator** (repository root) and **Placement Automation** (`custom_placement_automation/`). Entries name the application they change and link the commits on GitHub.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Releases are dated by the day they reached `main`, because the project has no version tags yet.

## [Unreleased] Implementation validator (branch `implementation-validator`)

These changes are on the `implementation-validator` branch and are not in `main` yet. Try them with:

```bash
npm run app -- --branch implementation-validator
```

### Added

- **Placement Automation: implementation validator (TC-01 to TC-13)** as a fourth check type ([1d3503a](https://github.com/chetanya1998/VDO.ai-Automated-Player-Testing-APT--Tool/commit/1d3503a)). It implements *VDO.AI Implementation Validator: Test Cases*: thirteen test cases in three steps (Network, Logger, Elements) for video, banner and offerwall tags.
  - **Inputs:** one or more tags per check (comma separated); the unit comes from the tag prefix (`v-`, `b-`, `o-`). A 30, 45 or 60 s watch catches slot refresh (TC-03). No code is applied: the live tag is checked.
  - **Network:** `vdo.ai.js` requests with the cache disabled, like DevTools, with status and initiator, and `logger.php?msg=` error reports. Duplicate embeds that Chrome serves with a single request are caught by also counting the `<script>` elements that load.
  - **Logger:** payloads posted to `analytics.vdo.ai/logger`, filtered by `tagName` and grouped by `page_url`. The event names `vdo.ai.js` really sends (`player_blocked`, `blocked_ima`, `blocked_agent`) are matched, and the error codes `Q2Fubm90IH` / `bnVsbCBpcy` are read from `eventData`.
  - **Elements:** the script is present once; the in-content `<tag>-0` wrapper or a floating player is present once; the banner div is present.
  - **Reporting:** PASS, WARNING or FAIL per test case with its evidence, and a summary line per tag, on the dashboard, in History (with its own filter) and in the PDF. Tests include the reference examples from the test case document and a real-browser test on local video, banner and offerwall pages.
- **Not eligible** ([22674af](https://github.com/chetanya1998/VDO.ai-Automated-Player-Testing-APT--Tool/commit/22674af)). Each tag lists all 13 test cases, and those its unit doesn't run are marked Not eligible with the reason. With several tags, each tag on the page is tested as its own instance. A tag that isn't on a page is *Not eligible on this page* instead of failing, but a page with none of the tags still fails TC-01.
- **Team installation and update guide**, [INSTALL-AND-UPDATE.md](INSTALL-AND-UPDATE.md). It covers installation on Windows, macOS and Linux, the first start, how updates are applied, test branches, rolling back, shipping an update, troubleshooting and uninstalling.
- **[LLM-INSTALL-INSTRUCTIONS.md](LLM-INSTALL-INSTRUCTIONS.md)**: instructions and copy-paste prompts for an AI coding assistant to install, update, verify, troubleshoot or uninstall the tool. It covers the requirements, safety rules, a non-interactive settings file, and readiness and smoke-test checks.
- This changelog ([370d32d](https://github.com/chetanya1998/VDO.ai-Automated-Player-Testing-APT--Tool/commit/370d32d)).

### Changed

- **README rewrites** ([653bb54](https://github.com/chetanya1998/VDO.ai-Automated-Player-Testing-APT--Tool/commit/653bb54)):
  - The Placement Automation README describes the four check types, and **how the tool tests every test case**: TC-01 to TC-13 one by one, ST-01 to ST-25 in a table, and the placement/CSS steps.
  - It also covers settings, the API fields per check type, and tests.
  - The root README and SETUP.md are brought up to date.
- **The Windows guide clones `main`** instead of the merged `sticky-violation-detection` branch, and links the team guide.

### Fixed

- Form fields in one row no longer stretch when one has a hint.
- Re-running a check that applies no code no longer asks for a missing code file.
- Run headers no longer show scroll settings for the implementation validator.

## [2026-10-31] Sticky violation checker, one-command start, staging URLs

Merged from `sticky-violation-detection` into `main` ([9e6c388](https://github.com/chetanya1998/VDO.ai-Automated-Player-Testing-APT--Tool/commit/9e6c388)).

### Added

- **Placement Automation: sticky violation checker (ST-01 to ST-25)** as a third check type ([9b6ed19](https://github.com/chetanya1998/VDO.ai-Automated-Player-Testing-APT--Tool/commit/9b6ed19)).
  - Each URL is walked through like a reader: initial load, scroll until the player floats, ad wait, small up/down scrolls, bottom of the page, other window sizes and zoom levels, and a click on the close button.
  - An in-page probe records the player position, floating state, spacing and publisher CSS, and hit-tests what the player covers.
  - Skip Ad buttons are found inside ad iframes and are never clicked.
  - Results appear on the dashboard, in History and in the PDF, with a local good/bad fixture site and rule tests.
- **Sticky status criteria** ([7a68ab8](https://github.com/chetanya1998/VDO.ai-Automated-Player-Testing-APT--Tool/commit/7a68ab8)):
  - only PASS, FAIL and WARNING (WARNING = could not be judged);
  - ST-01 to ST-13 always run, and ST-14 to ST-25 are opt-in;
  - a screenshot at every step, each check pointing to its evidence;
  - the overall per URL is Pass at 80% or more, Pass · Review required at 50–80%, and Fail below 50%.
- **One command to run the tool:** `npm run app`, or double-click `Start VDO Tool.cmd` on Windows ([3b20f1c](https://github.com/chetanya1998/VDO.ai-Automated-Player-Testing-APT--Tool/commit/3b20f1c)).
  - It updates the branch from GitHub (fast-forward only).
  - On first run it asks for the PostgreSQL settings and creates the database.
  - It installs and builds only what changed, then starts on http://127.0.0.1:3000.
  - The dashboard footer shows the running branch, commit and date.
- **Staging and preview URLs on another domain**, opt-in with "Allow URLs on other domains (staging / preview)" ([e4e4ebb](https://github.com/chetanya1998/VDO.ai-Automated-Player-Testing-APT--Tool/commit/e4e4ebb)). The publisher domain stays in use for the tag checks, and these URLs are marked in results, History and the PDF.
- **Safe frame check** (with every deep test) and an optional **ad slot refresh check** at 30, 45 or 60 s ([774041c](https://github.com/chetanya1998/VDO.ai-Automated-Player-Testing-APT--Tool/commit/774041c)).
- **Deep test additions** ([29f4187](https://github.com/chetanya1998/VDO.ai-Automated-Player-Testing-APT--Tool/commit/29f4187)):
  - screenshots taken with your code applied;
  - per-file timing for TC-2;
  - Google Chrome used automatically when it is installed, because it plays MP4/H.264 video ads.

### Changed

- **The 23-case rules follow the Tech Doc.** This fixes false results on real publisher pages ([4edd52a](https://github.com/chetanya1998/VDO.ai-Automated-Player-Testing-APT--Tool/commit/4edd52a)).
- **Deep test results are explained in plain language**, with totals shown separately ([56b9d7f](https://github.com/chetanya1998/VDO.ai-Automated-Player-Testing-APT--Tool/commit/56b9d7f)). Placement check counts and deep test counts are never added together ([cf3916d](https://github.com/chetanya1998/VDO.ai-Automated-Player-Testing-APT--Tool/commit/cf3916d)).
- **The deep test no longer requires iPhone/Safari evidence;** mobile is an emulated Android phone ([d1540e8](https://github.com/chetanya1998/VDO.ai-Automated-Player-Testing-APT--Tool/commit/d1540e8)).

### Fixed

- The dashboard no longer drops the refresh interval, the sticky code choice or the additional-checks option when a check starts or is re-run ([cd2b1c4](https://github.com/chetanya1998/VDO.ai-Automated-Player-Testing-APT--Tool/commit/cd2b1c4)).

## [2026-10-23] Placement Automation and the 23-case deep test

Merged in [pull request #1](https://github.com/chetanya1998/VDO.ai-Automated-Player-Testing-APT--Tool/pull/1) ([7ea9ba3](https://github.com/chetanya1998/VDO.ai-Automated-Player-Testing-APT--Tool/commit/7ea9ba3)).

### Added

- **Placement Automation application** (`custom_placement_automation/`) ([f0bff0f](https://github.com/chetanya1998/VDO.ai-Automated-Player-Testing-APT--Tool/commit/f0bff0f)).
  - Test a custom `vdo.ai.js` or a `style.css` on real publisher pages in Chromium, with screenshots, diagnostics and PDF reports.
  - It is a React + Vite dashboard over an Express API.
- **Durable local backend** ([a8b4ba0](https://github.com/chetanya1998/VDO.ai-Automated-Player-Testing-APT--Tool/commit/a8b4ba0)):
  - PostgreSQL job queue and run storage, with restart recovery;
  - a map of the 23 validation cases ([LOCAL-VALIDATION-PLAN.md](custom_placement_automation/LOCAL-VALIDATION-PLAN.md)).
- **Dashboard readiness from a real Chromium launch**, not just an installed file ([bb4a7f4](https://github.com/chetanya1998/VDO.ai-Automated-Player-Testing-APT--Tool/commit/bb4a7f4)).
- **Deep 23-case validation engine** ([f5c89ee](https://github.com/chetanya1998/VDO.ai-Automated-Player-Testing-APT--Tool/commit/f5c89ee)), run from placement checks when requested ([4bb4b57](https://github.com/chetanya1998/VDO.ai-Automated-Player-Testing-APT--Tool/commit/4bb4b57)).
- **Placement dashboard redesigned into blocks**, with deep test results per URL ([fc3f29a](https://github.com/chetanya1998/VDO.ai-Automated-Player-Testing-APT--Tool/commit/fc3f29a)).
- **Step-by-step Windows installation guide** ([2fa4bef](https://github.com/chetanya1998/VDO.ai-Automated-Player-Testing-APT--Tool/commit/2fa4bef)).

### Changed

- **README rewritten for the two-application architecture,** with diagrams ([fa17ec0](https://github.com/chetanya1998/VDO.ai-Automated-Player-Testing-APT--Tool/commit/fa17ec0), [97cdead](https://github.com/chetanya1998/VDO.ai-Automated-Player-Testing-APT--Tool/commit/97cdead)).

## [2026-10-13 to 2026-10-20] APT Validator

The validator was built up over this period, from the first commit ([0ec0c6e](https://github.com/chetanya1998/VDO.ai-Automated-Player-Testing-APT--Tool/commit/0ec0c6e)) to the production decision review ([7456dcc](https://github.com/chetanya1998/VDO.ai-Automated-Player-Testing-APT--Tool/commit/7456dcc)).

### Added

- **Foundation (2026-10-13):**
  - implementation plan, task breakdown and integration contract;
  - fixture execution profile;
  - shared contracts and CLI;
  - bounded browser runner;
  - controlled player fixtures and validator tests.
- **Evidence and rules (2026-10-13 to 2026-10-15):**
  - structured browser evidence capture;
  - logger payload normalisation;
  - approved tag identities;
  - player integration structure;
  - script and logger timing;
  - deterministic reports;
  - browser logger lifecycles;
  - blocked events and dependencies;
  - ad request outcomes;
  - auction order and fallback;
  - visibility and viewability;
  - SPA article lifecycles.
- **Application (2026-10-16 to 2026-10-19):**
  - desktop and mobile validation matrix;
  - probable-cause ranking;
  - PostgreSQL job persistence;
  - authenticated local run API;
  - run dashboard and evidence timeline;
  - authenticated technical report exports;
  - bounded URL validation batches.
- **Optional intelligence (2026-10-19):**
  - bounded backend logger collection;
  - correlation of backend records by verified IDs;
  - bounded optional AI explanations.
- **Pilot and production gates (2026-10-19 to 2026-10-20):**
  - hardened pilot execution boundaries;
  - pilot release measurement gates;
  - production runs gated on deployment acceptance;
  - evidence-backed pilot readiness;
  - an evidence-backed production contract;
  - the production deployment backlog, grouped into parallel packages;
  - a review of the supplied sources against the production decisions.
- **Documentation:**
  - non-technical product guide and product documentation;
  - Coolify self-hosting plan;
  - README revisions.
