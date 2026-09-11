# QA Automation Framework

All-tools-together QA pipeline: **Playwright**, **Postman CLI**, **JMeter**, **Git**, and **GitHub Actions** — controlled from a single config file.

## Quick start

```bash
npm install
npm run qa:sync
npm run test:all
```

## Single instruction (Cursor Agent)

> **Perform complete QA automation for this application.**

The rule in `.cursor/rules/qa-automation.mdc` (sourced from `.cursor/rules/qa-automation.json`) handles analysis, test creation, execution, reports, and Git prep.

## Project structure

```
QA-AUTOMATION/
├── .cursor/rules/                    # Cursor rules (.json source → .mdc)
├── .github/workflows/qa-automation.yml
├── qa.config.json                    # ← edit this (single source of truth)
├── tests/
│   ├── e2e/                          # Playwright functional UI tests
│   ├── e2e/visual/                   # Visual screenshot suite (separate from functional)
│   ├── e2e/responsive/               # Viewport-emulation suite (not real-device testing)
│   ├── e2e/accessibility/            # Automated a11y (axe + keyboard) — not a full WCAG audit
│   ├── e2e/workflows/                # Combined UI+API E2E (not every UI test)
│   ├── api/postman/collections/      # Postman collections (CLI; GUI not required)
│   ├── api/postman/environments/     # Postman environments (secrets via env vars)
│   ├── performance/                  # JMeter profiles: smoke/ load/ stress/ spike/ soak/
│   ├── security/                     # QA-level security (not a pentest)
│   ├── seo/                          # Technical SEO (not a ranking audit)
│   └── content/                      # Content QA (structural; not fact-checking)
├── pages/                            # Page Object Model
├── components/                       # Shared UI fragments (when needed)
├── fixtures/                         # Playwright fixtures + local fixture site
├── utils/                            # Shared helpers
├── config/                           # Generated env (from qa.config.json)
├── scripts/                          # Sync, runners, enterprise report
├── npm-docs/                         # Text sanitization / legacy txt→docx
├── docs/
│   ├── templates/                    # Report format template
│   └── output/qa-test-results/       # Timestamped DOCX/HTML/PDF
├── discovery/                        # page-map / UI / workflow / API inventories
├── reports/                          # Runtime tool reports (gitignored)
├── visual-baselines/                 # Committed screenshot baselines (never auto-updated)
├── playwright.config.ts
├── playwright.visual.config.ts
├── playwright.responsive.config.ts
├── playwright.cross-browser.config.ts
├── playwright.accessibility.config.ts
├── playwright.workflows.config.ts
├── playwright.security.config.ts
├── playwright.seo.config.ts
├── playwright.content.config.ts
├── package.json
└── .env.example
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | TypeScript check |
| `npm run preflight` | Verify tools, browsers, config, and environment |
| `npm run discover` | Application discovery (page / UI / workflow / API inventories) |
| `npm run coverage` | Advanced coverage (13 dimensions) from discovered testable items — not pass rate |
| `npm run test:ui` | Generate + execute discovery UI checks, then update coverage |
| `npm run test:visual` | Visual screenshot comparison (does not update baselines) |
| `npm run test:visual:update` | Deliberately rewrite visual baselines after review |
| `npm run test:responsive` | Viewport matrix: desktop/laptop/tablet/mobile (emulation, not real devices) |
| `npm run test:accessibility` | Automated accessibility (axe-core + keyboard/structure). Not a complete WCAG audit. |
| `npm run qa:sync` | Regenerate configs from `qa.config.json` |
| `npm run test:e2e` | Playwright |
| `npm run test:e2e:cross-browser` | Representative e2e on Chromium, Firefox, WebKit (engines, not real devices) |
| `npm run test:e2e:headed` | Playwright headed |
| `npm run test:e2e:debug` | Playwright inspector |
| `npm run test:api` | Postman CLI (documented/discovered APIs only; no GUI) |
| `npm run test:workflows` | Combined UI+API workflows only (does not replace UI or API suites) |
| `npm run test:performance` | JMeter smoke (default). Heavy: `-- --profile=load --authorize-heavy` |
| `npm run test:security` | QA-level security (HTTPS, headers, cookies, exposure). Not a pentest. |
| `npm run test:seo` | Technical SEO (title/meta/canonical/OG/robots/sitemap/alt/URL/404/redirect). Not a ranking audit. |
| `npm run test:content` | Content QA (headings, empty sections, placeholders, broken assets). Not factual verification. |
| `npm run analyze:failures` | Classify failed executions (application vs automation vs environment, etc.). Does not change tests. |
| `npm run retest` | Controlled retest of classified failures. Preserves the original FAIL. Never weakens assertions. Target with `--id`, `--source`, `--class`, `--grep`, or `--automation-only`. |
| `npm run qa:clean` | Delete previous ephemeral run artifacts (`reports/`, discovery JSON, test-results). Does **not** delete historical professional packs under `docs/input|output/qa-test-results/`. Full runs do this automatically. |
| `npm run qa:all` | **Primary complete QA run** — cleans ephemeral artifacts, then 20-stage orchestrator (preflight → dependencies → discovery → suites → classify → retest → coverage → professional report). Continues after failed stages unless `--fail-fast`. Use `--keep-artifacts` to skip the clean. Previous dated Word/HTML/PDF folders are retained. |
| `npm run test:dependencies` | Dependency & secrets QA — `npm audit` advisories plus a pattern-based secret scan of tracked source files. Not a full SCA/license audit. |
| `npm run test:all` | Core tools only: Playwright → Postman → JMeter + enterprise report |
| `npm run docs:qa-report` | Regenerate enterprise DOCX/HTML/PDF on demand |
| `npm run report:final` | Unified markdown plus the five-layer Word/HTML/PDF SQA report (also the last `qa:all` stage) |
| `npm run rules:sync` | Sync `.cursor/rules/*.json` → `.mdc` |

## Reports

Enterprise five-layer SQA report (Executive Summary, Test Evidence, QA Analysis, Risks & Limitations, Release Recommendation):

- Latest index: `docs/output/qa-test-results/latest.json` (updated each run; older timestamp folders stay)
- Formats: DOCX, HTML, PDF — each run writes a new `YYYY-MM-DD_HH-MM-SS` folder under `docs/input|output/qa-test-results/`

Unified professional report (35 sections, written for both QA engineers and project managers):

- `reports/summary/final-qa-report.md`
- Machine model: `reports/summary/final-qa-report.json`
- Raw tool index (artifacts stay in `reports/<tool>/`): `reports/summary/raw-index.md`

Final verdict is one of **PASS**, **PASS WITH OBSERVATIONS**, **FAIL**, or **BLOCKED**. Severity is P0 Critical / P1 High / P2 Medium / P3 Low. PASS is never issued while a P0 (or P1 application) release blocker remains. Coverage is never claimed as 100% without evidence.

## CI/CD (GitHub Actions)

Workflows live in `.github/workflows/` and are regenerated by `npm run qa:sync` from `qa.config.json` → `github` section.

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| `qa-automation.yml` | push, pull_request, **workflow_dispatch** | Normal CI: typecheck, fixture discovery, Playwright, API, accessibility, JMeter **smoke**, final report |
| `qa-performance-heavy.yml` | **workflow_dispatch only** | Authorized load/stress/spike/soak (type `authorize-heavy` to confirm) |

### CI artifacts (14-day retention)

- Playwright HTML report
- Screenshots, traces, videos (`test-results/`)
- Postman API reports
- JMeter smoke reports
- Final QA summary (`reports/summary/`, failures, coverage, accessibility)

### GitHub Secrets

Configure under **Settings → Secrets and variables → Actions**. Never commit `.env`, passwords, tokens, API keys, cookies, or private keys.

| Secret | Purpose |
| --- | --- |
| `QA_WEBSITE_URL` | Optional override for target website |
| `QA_API_URL` | Optional override for API base URL |
| `QA_PLAYWRIGHT_BASE_URL` | Local/optional override (CI uses fixture `http://127.0.0.1:4173` by default) |
| `QA_USERNAME` / `QA_PASSWORD` | UI credentials when the target documents them |
| `QA_API_TOKEN` / `QA_API_USERNAME` / `QA_API_PASSWORD` | API auth when documented in `postman.auth` |

Normal CI does **not** set `QA_PERF_AUTHORIZE`. Heavy JMeter uses the separate manual workflow.

### Manual CI run

GitHub → Actions → **QA Automation** → Run workflow. Optionally set `discover_url` to crawl a live site; leave empty to discover the in-repo fixture at `http://127.0.0.1:4173/`.

```
Push / PR → typecheck → sync → fixture → discover → Playwright → Postman → a11y → JMeter smoke → report → upload artifacts
```

## Performance (JMeter)

`npm run test:performance` runs the **smoke** profile only. That is what CI uses.

Heavy profiles (`load`, `stress`, `spike`, `soak`) are generated as plans under `tests/performance/<profile>/` but are **not** executed unless you pass `--authorize-heavy` (or set `QA_PERF_AUTHORIZE`) **and** the API host is loopback or listed in `jmeter.allowHeavyAgainst`. Public/production hosts are refused even with the flag.

Thresholds are never invented. If `jmeter.thresholds` is omitted or null, the report records measurements and marks the threshold **undefined**.

## Security QA

`npm run test:security` is **QA-level** validation: HTTPS, security headers (CSP, HSTS, X-Content-Type-Options, clickjacking, Referrer-Policy, Permissions-Policy), cookie flags, sensitive-source indicators, well-known path GETs, CSRF/input-validation *indicators*, and rate-limit *headers*. It is **not** a penetration test. Forms are never submitted. Attack payloads, floods, and exploit PoCs are out of scope.

## Dependency & secrets QA

`npm run test:dependencies` runs two checks against the repo itself (not the live site): `npm audit --json` for known advisories in `package.json`/`package-lock.json`, and a pattern-based scan of tracked source files (`.ts`/`.js`/`.json`/`.yml`/`.env`) for AWS access keys, GitHub/Slack tokens, PEM private key blocks, and generic `SECRET`/`PASSWORD`/`API_KEY`-style assignments. AWS keys, tokens, and private-key blocks fail the stage; generic credential-assignment matches are recorded as NOTE (heuristic, not auto-blocking) so a false positive never blocks a run silently. The minimum npm-audit severity that fails the stage is `dependencies.failOnSeverity` in `qa.config.json` (default `high`) — lower severities are still recorded, never dropped. It is **not** a full software-composition-analysis or license audit, and does not scan git history — only the current working tree.

## Technical SEO

`npm run test:seo` checks title, meta description, canonical, Open Graph, image alt, robots.txt, sitemap.xml, URL consistency / duplicate-URL indicators, 404 behavior, and redirect behavior when observed or configured. It is **not** a ranking, crawl-budget, or content-strategy audit. A preferred trailing-slash / www / scheme policy is not invented.

## Content QA

`npm run test:content` looks for missing headings, missing/empty content, empty sections, obvious placeholder tokens, missing alt, broken same-origin images, and broken same-origin links. It does **not** determine whether business claims are factually true unless `content.expectedValues` provides an authoritative expected value.

## Failure analysis

`npm run analyze:failures` (also run before `npm run docs:qa-report`) classifies each failed execution from its error message, stack, screenshot/trace/video when present, network hints, and test context:

APPLICATION DEFECT, AUTOMATION DEFECT, ENVIRONMENT DEFECT, TEST DATA DEFECT, CONFIGURATION DEFECT, NETWORK ISSUE, BROWSER ISSUE, or UNKNOWN.

A wrong locator for a control that is on the page is an **automation** defect. A correct locator with wrong application behavior is an **application** defect. UNKNOWN is used when evidence is insufficient. The analyzer never changes a test to make it pass.

## Retest

`npm run retest` follows FAIL → ANALYZE → CLASSIFY → FIX AUTOMATION DEFECT IF REQUIRED → RE-RUN → VERIFY → RECORD.

It does **not** hide failures, remove tests, weaken assertions, auto-skip failures, or change expected results. Automation-defect fixes are not applied by the engine. A later PASS does not erase the original FAIL. Isolated output is written under `reports/retest/` so the original suite artifacts stay intact.

```bash
npm run retest
npm run retest -- --dry-run
npm run retest -- --id FAIL-0025
npm run retest -- --source seo
npm run retest -- --automation-only
```

## Coverage

`npm run coverage` measures **covered ÷ testable discovered items**, not the number of passing tests. Dimensions: page, route, UI element, field, button, link, form, workflow, API, browser, responsive, accessibility, visual.

Every item is listed with page, element, type, reason, recommended test, and status: TESTED, FAILED, BLOCKED, SKIPPED, NOT APPLICABLE, UNTESTABLE, or UNCOVERED. FAILED still counts as covered. Nothing is silently omitted.

## Complete run (`qa:all`)

`npm run qa:all` is the primary command. It spawns each stage as a Node.js child process (does not require Cursor) and records every exit code in `reports/orchestrator/summary.json` and `reports/orchestrator/stages.md`. Failed stages are logged and the run continues unless you pass `--fail-fast`. Optional: `npm run qa:all -- http://127.0.0.1:4173/` or `--url=` / `QA_DISCOVER_URL`. Retest is `--automation-only` so application defects are not silently re-run as a pass.

## Final unified report

`npm run report:final` (also run from `npm run docs:qa-report`) refreshes failure analysis and coverage, then writes `reports/summary/final-qa-report.md`. It does not copy or rewrite raw Playwright / Postman / JMeter / suite reports; those stay under `reports/<tool>/` and are listed in `reports/summary/raw-index.md`.
