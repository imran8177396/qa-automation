# QA Automation Framework

All-tools-together QA pipeline: **Playwright**, **Postman CLI**, **JMeter**, **Git**, **GitHub Actions**, and **Jenkins**, driven from `qa.config.json`. Cursor rules under `.cursor/rules/` guide agents; they are not runtime dependencies. Every npm command below runs in a terminal, CI, or any IDE.

This repository does **not** claim 100% coverage or that a product passed. Verdicts and coverage come only from artifacts under `reports/` after a real run.

## Purpose

Provide a single, config-driven framework that can:

1. Discover a target site and inventory testable items.
2. Run UI, API, performance (liveness), accessibility, visual, responsive, security, SEO, and content checks.
3. Classify failures, retest automation defects without erasing the original FAIL, measure coverage from inventory (not pass rate), and write Allure / Playwright HTML / five-layer Word-HTML-PDF reports.

The checked-in example target is **[Sauce Demo](https://www.saucedemo.com/)** for UI (`qa.config.json` → `urls.website` / `playwright.baseURL`). The documented API is **[JSONPlaceholder](https://jsonplaceholder.typicode.com)** (`urls.api`, Postman requests, JMeter `path` `/posts`). Sauce Demo login-page REST is never invented — discovery found no XHR/fetch API there.

## Architecture

```
QA-AUTOMATION/
├── qa.config.json                    # URLs, Postman requests, JMeter, pipeline, report
├── .env.example                      # Env template (copy to .env — never commit .env)
├── .cursor/rules/                    # Cursor guidance (.json source → .mdc)
├── .github/workflows/
│   ├── qa-automation.yml             # Lightweight PR CI
│   ├── qa-regression.yml             # Full qa:all (main / schedule / manual)
│   └── qa-performance-heavy.yml      # Authorized heavy JMeter only
├── jenkins/
│   ├── Jenkinsfile                   # Multibranch: PR/feature lightweight; main/master/develop qa:all
│   ├── Jenkinsfile.regression        # Dedicated full qa:all
│   ├── Jenkinsfile.performance       # Dedicated heavy JMeter (AUTHORIZE_HEAVY default false)
│   ├── README.md                     # Job setup, credential IDs, agent requirements
│   └── scripts/                      # Groovy helpers + Unix/Windows fixture helpers
├── tests/
│   ├── e2e/                          # Playwright functional UI
│   ├── e2e/visual/                   # Screenshot comparison (not inside test:e2e)
│   ├── e2e/responsive/               # Viewport emulation (not real devices)
│   ├── e2e/accessibility/            # axe + keyboard/structure (not a full WCAG audit)
│   ├── e2e/workflows/                # Combined UI+API pairs only
│   ├── e2e/performance/              # Playwright UI timing (RECORDED, no invented SLA)
│   ├── api/postman/                  # Generated collection + environment
│   └── performance/                  # JMeter plans (liveness/smoke + heavy files)
├── pages/                            # Page Object Model
├── components/                       # Shared UI fragments
├── fixtures/                         # Playwright fixtures + local fixture site
├── utils/                            # Env and shared helpers
├── config/                           # generated.env (gitignored)
├── scripts/                          # Sync, runners, orchestrator, reports
├── docs/
│   ├── templates/                    # Report format template
│   └── input|output/qa-test-results/ # Dated Word/HTML/PDF packs (gitignored; qa:clean does not wipe)
├── discovery/                        # Generated inventories (*.json gitignored)
├── reports/                          # Ephemeral tool output (gitignored)
├── visual-baselines/                 # Committed screenshot goldens (actual/diff ignored)
├── playwright*.config.ts
├── package.json
└── package-lock.json
```

**Control flow:** edit `qa.config.json` → `npm run qa:sync` regenerates Postman, JMeter plans, GitHub workflows, Jenkinsfiles, and `config/generated.env`. `npm run qa:all` cleans ephemeral artifacts, syncs, then spawns child-process stages and records every exit code. `QA Automation Structure/` is a local snapshot if present — it is not the source of truth and is gitignored.

Jenkins is an **additional** CI path (`jenkins/`). GitHub Actions workflows stay in `.github/workflows/`. Cursor is not a Jenkins plugin — Jenkinsfiles only call `npm` / `npx` / existing scripts. A checked-in Jenkinsfile is not the same as a working Jenkins controller; see `jenkins/README.md` for remaining admin setup.

## Prerequisites

| Requirement | Why |
| --- | --- |
| **Node.js 18+** (x64 or arm64) | `preflight` requires major ≥ 18 |
| **npm** (lockfile install) | `package-lock.json` is committed; CI uses `npm ci` |
| **Git** | Local history and optional later publish |
| **Playwright browsers** | `npx playwright install` (CI installs Chromium) |
| **Java 17+ JRE/JDK** | JMeter non-GUI and Allure CLI |
| **Apache JMeter** on `PATH` or `JMETER_HOME` | `npm run test:performance` (CI installs 5.6.3) |
| Optional **Lighthouse CLI** | `npm run test:lighthouse`; missing CLI is recorded, not faked |

Supported platforms in preflight: Windows, macOS, Linux.

## Installation

```bash
git clone <your-fork-or-existing-remote>
cd QA-AUTOMATION
npm install
npx playwright install
npm run qa:sync
npm run preflight
```

Use `npm ci` in CI or when you want a lockfile-exact install. Do not delete `package-lock.json`.

## Environment setup

1. Copy the template (never commit the filled file):

   ```bash
   copy .env.example .env
   ```

   On Unix: `cp .env.example .env`.

2. Fill **documented** values only. Sauce Demo prints accepted usernames and the shared password on the login page — copy those into `QA_USERNAME` / `QA_PASSWORD` locally if you need inventory browse. Leave them empty to keep login-page-only checks (`REQUIRES_CONFIGURATION` for gated inventory). JSONPlaceholder in this config uses `postman.auth.type: none` — leave API tokens empty unless you change the contract.

| Variable | Role |
| --- | --- |
| `QA_WEBSITE_URL` | Site origin (example: `https://www.saucedemo.com/`). Also used by `qa:all` when no `--url=` / positional URL is passed. |
| `QA_API_URL` | Documented API base (example: `https://jsonplaceholder.typicode.com`) |
| `QA_PLAYWRIGHT_BASE_URL` | Playwright origin (example: `https://www.saucedemo.com`) |
| `QA_PLAYWRIGHT_HEADLESS` | `true` / `false` |
| `QA_PLAYWRIGHT_BROWSERS` | Optional engine list override (otherwise `qa.config.json` `playwright.browsers`) |
| `QA_LOGIN_URL` | Optional login URL if you set `urls.login` in config |
| `QA_USERNAME` / `QA_PASSWORD` | UI credentials when the target documents them |
| `QA_API_TOKEN` / `QA_API_USERNAME` / `QA_API_PASSWORD` | API auth only when `postman.auth` documents a contract |
| `QA_JMETER_PROFILE` | Optional default profile (`liveness` if unset; `smoke` is an alias) |
| `QA_PERF_AUTHORIZE` | Set `true` or `1` only to authorize heavy JMeter (never in normal CI) |

`npm run qa:sync` writes `config/generated.env` from `qa.config.json`. Local `.env` overrides generated values for credentials. Never commit `.env`, tokens, cookies, or private keys.

## Playwright commands

| Command | What it runs |
| --- | --- |
| `npm run test:e2e` | Functional UI (`tests/e2e`, excludes visual/responsive/a11y/workflows/performance) |
| `npm run test:e2e:headed` | Same suite, headed browser |
| `npm run test:e2e:debug` | Playwright inspector |
| `npm run test:e2e:report` | Open the last e2e HTML report |
| `npm run test:e2e:cross-browser` | Representative `@cross-browser` specs on Chromium, Firefox, WebKit engines (not real devices) |
| `npm run test:ui` | Generate + execute discovery UI checks, then coverage |
| `npm run test:visual` | Screenshot comparison; **does not** rewrite goldens |
| `npm run test:visual:update` | Rewrite baselines only after review (`--approve-baseline-update`) |
| `npm run test:responsive` | Desktop/laptop/tablet/mobile **emulation** |
| `npm run test:accessibility` | axe-core + keyboard/structure |
| `npm run test:workflows` | Documented UI+API pairs only |
| `npm run qa:test -- <url>` | Discovery-driven live crawl + non-destructive checks |

Failure artifacts (screenshot / video / trace) go under `test-results/` (gitignored). HTML/JSON live under `reports/playwright/<suite>/`. Goldens stay in `visual-baselines/`.

## API commands

Requests and assertions are defined in `qa.config.json` → `postman.requests` (JSONPlaceholder `/posts` and related documented cases). Sync, then run:

```bash
npm run qa:sync
npm run test:api
```

| Command | Purpose |
| --- | --- |
| `npm run test:api` | Postman CLI against the generated collection (no Postman GUI required) |
| `npm run qa:api` | Pipeline step `api` only (`scripts/run-qa.ts --step=api`) |

Reports: `reports/postman/`. Undocumented / `UNVERIFIED` requests are excluded from the pass count. Auth stays `NOT_EXECUTED` / `REQUIRES_CONFIGURATION` unless `postman.auth` and runtime secrets exist.

## JMeter commands

Default profile is **`liveness`** (`qa.config.json` `jmeter.defaultProfile`). `smoke` is an alias of liveness. The stage records measurements as **RECORDED** when thresholds are `null` — this config does not invent a P95 or error-rate SLA. Target path is documented API `GET /posts`, not Sauce Demo REST.

```bash
npm run test:performance
npm run test:performance -- --profile=liveness
npm run test:performance -- --profile=load --authorize-heavy
```

| Command | Purpose |
| --- | --- |
| `npm run test:performance` | JMeter liveness/smoke + Playwright UI timing + Lighthouse (if CLI present). **No** `--authorize-heavy`. |
| `npm run qa:load` | Pipeline step `load` only |
| `npm run test:lighthouse` | Lighthouse only; missing CLI → `NOT_EXECUTED` |

Heavy profiles (`load`, `stress`, `spike`, `soak`) exist as plans under `tests/performance/jmeter/<profile>/` after sync. They do **not** run unless you pass `--authorize-heavy` or set `QA_PERF_AUTHORIZE`, **and** the API host is loopback or listed in `jmeter.allowHeavyAgainst` (currently empty — public hosts are refused). `qa:all` strips `--authorize-heavy` from the performance child so the orchestrator never launches heavy load.

Reports: `reports/jmeter/`, `reports/performance/`, `reports/lighthouse/`.

## Allure reporting

Playwright writes raw Allure results to `reports/allure/results` (`allure-playwright`). Generating HTML needs `allure-commandline` (already a devDependency) and a Java JRE.

```bash
npm run report:allure
npm run report:playwright
npm run report:playwright -- --open
npm run report:final
npm run report:all
```

| Command | Purpose |
| --- | --- |
| `npm run report:allure` | `allure generate` → `reports/allure/report` (previous HTML archived under `reports/allure/history/`) |
| `npm run report:playwright` | Index Playwright HTML paths |
| `npm run report:final` | Unified markdown/JSON + five-layer Word/HTML/PDF |
| `npm run report:all` | Allure + Playwright index + existing Postman/JMeter + `report:final` + `reports/summary/report-index.json` |

If the Allure CLI cannot run, the stage is **BLOCKED** — do not claim Allure succeeded. Open `reports/allure/report/index.html` after a successful generate. `qa:all` includes Allure, Playwright report indexing, and the final summary as later stages.

## Complete pipeline (`qa:all`)

```bash
npm run qa:clean
npm run typecheck && npm run qa:all
npm run qa:all -- --url=https://www.saucedemo.com/
npm run qa:all -- http://127.0.0.1:4173/
npm run qa:all -- --fail-fast
npm run qa:all -- --keep-artifacts
```

`qa:all` is the primary complete run. It:

1. Cleans **ephemeral** artifacts (`reports/`, `test-results/`, discovery JSON, and related scratch). It does **not** delete dated packs under `docs/input|output/qa-test-results/`.
2. Runs `qa:sync`.
3. Spawns **23 child stages** (20 named contract steps; performance is one process covering UI timing + JMeter liveness). Extra stages include dependencies, content, workflows, and collect.
4. Records every exit code in `reports/orchestrator/summary.json` and `reports/orchestrator/stages.md`.
5. Continues after failed stages unless `--fail-fast`.
6. Runs retest with `--automation-only` so application defects are not silently re-run as a pass.

URL resolution: `--url=` or a positional URL, else `QA_WEBSITE_URL`, else a previous discovery seed, else loopback Playwright base, else `qa.config.json` `urls.website`. Loopback URLs start the in-repo fixture site.

Related: `npm run test:all` is **core tools only** (Playwright → Postman → JMeter + enterprise report), not the full orchestrator.

## Git workflow

Inspect first. Do not rewrite history. Do not force-push.

```bash
git status
git branch -vv
git remote -v
git log -5 --oneline
```

Typical local work:

```bash
git switch -c feature/your-change
# edit source, tests, qa.config.json, rules — not .env or reports/
git status
git add package.json package-lock.json qa.config.json README.md .gitignore
git commit -m "Explain why the change exists."
```

**Do commit:** `package.json`, `package-lock.json`, source, tests, `qa.config.json`, `.env.example`, `.cursor/rules/`, `.github/workflows/`, `jenkins/` (Jenkinsfiles and helper scripts), `README.md`, visual goldens you intentionally approve.

**Do not commit:** `node_modules/`, `.env`, `reports/`, `test-results/`, `playwright-report/`, screenshots/traces scratch, `*.log`, OS junk, or secrets.

This project already has a Git remote if one was configured on your machine (`git remote -v`). Do not invent a new remote or GitHub repository from this README. When you later choose to publish, use a normal `git push` of your branch — **never** `git push --force` (or `--force-with-lease` as a habit) on shared branches. History must stay intact (`git reset --hard`, filter-branch, and interactive rebase are out of scope for routine QA work).

## CI/CD

Two CI paths exist. Neither replaces the other.

### GitHub Actions

Workflows live in `.github/workflows/` and are regenerated by `npm run qa:sync` from `qa.config.json` → `github` (`branches`: `main`, `master`; PRs enabled).

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| `qa-automation.yml` (**QA CI**) | **pull_request** to `main` or `master`, and **workflow_dispatch** | Lightweight: typecheck, sync, Chromium, fixture at `http://127.0.0.1:4173`, discovery, Playwright e2e, Postman, accessibility, JMeter **liveness**, `report:all`, artifacts. Not `qa:all`. Never `--authorize-heavy`. |
| `qa-regression.yml` | **push** to `main`/`master`, weekly **schedule**, **workflow_dispatch** | Full `npm run qa:all` (visual, cross-browser, remaining stages). Still liveness JMeter only. Optional `discover_url` input for `--url=`. |
| `qa-performance-heavy.yml` | **workflow_dispatch** (type `authorize-heavy`) and optional weekly **schedule** | Heavy JMeter (`load` / `stress` / `spike` / `soak`). Schedule also needs Actions variable `QA_PERF_AUTHORIZE_SCHEDULE=true`. Never `pull_request`. |

PR CI sets fixture `QA_PLAYWRIGHT_BASE_URL` / `QA_WEBSITE_URL` to the local site. It does **not** set `QA_PERF_AUTHORIZE`. Manual lightweight run: GitHub → Actions → **QA CI (Pull Request)** → Run workflow. Full suite: **QA Regression**. Heavy load: **QA Performance Heavy**.

Optional repository secrets (Settings → Secrets and variables → Actions) — do not invent extra GitHub settings:

`QA_WEBSITE_URL`, `QA_API_URL`, `QA_USERNAME`, `QA_PASSWORD`, `QA_API_TOKEN`, `QA_API_USERNAME`, `QA_API_PASSWORD`.

### Jenkins (Multibranch + dedicated jobs)

Checked-in sources: `jenkins/Jenkinsfile`, `jenkins/Jenkinsfile.regression`, `jenkins/Jenkinsfile.performance`, and `jenkins/scripts/`. Keep them tracked; they are not gitignored. `npm run qa:sync` regenerates the three Jenkinsfiles.

| Jenkinsfile | Job type | Purpose |
| --- | --- | --- |
| `jenkins/Jenkinsfile` | **Multibranch Pipeline** (Script Path `jenkins/Jenkinsfile`) | GitHub Branch Source discovers branches/PRs. PR/feature = lightweight (fixture, discovery, e2e, API, a11y, JMeter liveness). `main` / `master` / `develop` = `npm run qa:all`. Never authorizes heavy JMeter. |
| `jenkins/Jenkinsfile.regression` | Dedicated Pipeline | Always `npm run qa:all`. Optional `DISCOVER_URL`. Liveness JMeter only. |
| `jenkins/Jenkinsfile.performance` | Dedicated Pipeline | Heavy profiles only. Parameter `AUTHORIZE_HEAVY` defaults to **false**. Does not default to a production host. |

Jenkins Credentials (Secret text IDs): `qa-username`, `qa-password`, `qa-api-token`, `qa-api-url`, `qa-api-username`, `qa-api-password`, `qa-website-url`. Missing IDs bind empty. Values are never echoed.

A checked-in Jenkinsfile does **not** mean Jenkins is running. Remaining controller setup (plugins, GitHub Branch Source, agent with Node 20 + Playwright + Java/JMeter) is in `jenkins/README.md`.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `preflight` fails on Node | Install Node 18+ (`node -v`). |
| Playwright browsers missing | `npx playwright install` (CI: `npx playwright install --with-deps chromium`). |
| JMeter / Java not found | Install a JRE 17+ and JMeter; set `JAVA_HOME` / `JMETER_HOME` or put `jmeter` on `PATH`. Preflight and the performance stage record the gap — do not fake JTL results. |
| Allure HTML missing | Need Java + `npm run report:allure` after a Playwright run that wrote `reports/allure/results`. Failure is BLOCKED, not a silent skip. |
| Login / inventory gated | Set documented `QA_USERNAME` / `QA_PASSWORD` in `.env`. Empty credentials → `REQUIRES_CONFIGURATION`, not a hidden skip. |
| Tests hit the fixture instead of Sauce Demo | Set `QA_PLAYWRIGHT_BASE_URL` / `QA_WEBSITE_URL` or pass `--url=`. Product suites fail if the origin does not match the configured live target. |
| Heavy JMeter refused | Expected without `--authorize-heavy` / `QA_PERF_AUTHORIZE`, or when the API host is not loopback and not in `allowHeavyAgainst`. |
| `qa:clean` removed `reports/` but dated Word packs remain | Intended. Historical packs under `docs/input\|output/qa-test-results/` are retained on disk and stay gitignored. |
| Coverage looks like “100%” | It is not claimed here. Read `reports/coverage/coverage.json` and `docs/uncovered-test-items.md`. Coverage is covered ÷ testable discovered items. |
| A test failed | Run `npm run analyze:failures`, then `npm run retest`. Do not weaken assertions to go green. |
| Accidental secret in a file | Remove it from the working tree; do not `git add .env`. Rotating leaked credentials is a human step — this README does not rewrite Git history. |

## Other commands

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run preflight` | Tools, browsers, config, environment |
| `npm run discover -- <url>` | Page / UI / workflow / API inventories |
| `npm run coverage` | 13-dimension coverage from discovered items |
| `npm run qa:sync` | Regenerate configs from `qa.config.json` |
| `npm run qa:clean` | Delete ephemeral run artifacts only |
| `npm run test:security` | QA-level HTTPS/headers/cookies/exposure — not a pentest |
| `npm run test:seo` | Technical SEO — not a ranking audit |
| `npm run test:content` | Structural content QA — not fact-checking |
| `npm run test:dependencies` | `npm audit` + secret-pattern scan of the working tree |
| `npm run analyze:failures` | Classify FAIL (application vs automation vs environment, …) |
| `npm run retest` | Controlled retest; original FAIL is preserved |
| `npm run test:unit` | Framework unit tests |
| `npm run docs:qa-report` | Enterprise DOCX/HTML/PDF on demand |
| `npm run rules:sync` | `.cursor/rules/*.json` → `.mdc` |

## Reports and verdicts

Enterprise five-layer SQA report (Executive Summary, Test Evidence, QA Analysis, Risks & Limitations, Release Recommendation):

- Dated folders: `docs/input|output/qa-test-results/YYYY-MM-DD_HH-MM-SS/`
- Latest pointer: `docs/output/qa-test-results/latest.json` (older timestamp folders stay)

Unified professional report:

- `reports/summary/final-qa-report.md` and `.json`
- `reports/summary/report-index.json`, `reports/summary/raw-index.md`
- Allure: `reports/allure/report/index.html`
- Playwright HTML: `reports/playwright/<suite>/html/`

Final verdict is one of **PASS**, **PASS WITH OBSERVATIONS**, **FAIL**, or **BLOCKED**. Severity is P0–P3. PASS is never issued while a P0 or P1 application blocker remains. Coverage is never claimed as 100% without `reports/coverage/` evidence.

## Single instruction (Cursor Agent)

> **Perform complete QA automation for this application.**

The rule in `.cursor/rules/qa-automation.mdc` runs analysis through report. The runtime equivalent is `npm run qa:all` (or `npm run qa:all -- --url=<url>`).
