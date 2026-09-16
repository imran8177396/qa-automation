# Jenkins Multibranch and dedicated jobs

This directory is the Jenkins CI path. It is **additional** to GitHub Actions (`.github/workflows/`). Do not delete those workflows.

Cursor is not a Jenkins plugin. Agents run `npm` / `npx` / existing `scripts/` only.

These files are checked in so a Jenkins agent can run them. `npm run qa:sync` regenerates the three Jenkinsfiles from `scripts/generators/jenkins-pipeline.ts` so they do not drift from `qa.config.json` `github.branches`. Helper scripts under `jenkins/scripts/` are hand-maintained.

**Jenkins itself is not installed or started by this repository.** Until an administrator creates the jobs below, this is pipeline source only — not a working controller.

## Jobs to create

| Job type | Script Path | When to use |
| --- | --- | --- |
| **Multibranch Pipeline** | `jenkins/Jenkinsfile` | Discover branches and GitHub PRs. PR / feature = lightweight QA. `main` / `master` / `develop` (plus any `qa.config.json` `github.branches`) = `npm run qa:all`. |
| **Pipeline** (standalone) | `jenkins/Jenkinsfile.regression` | Manual or scheduled full `npm run qa:all`. |
| **Pipeline** (standalone) | `jenkins/Jenkinsfile.performance` | Manual heavy JMeter (`load` / `stress` / `spike` / `soak`). `AUTHORIZE_HEAVY` defaults to **false**. |

### Multibranch (GitHub Branch Source)

1. Install plugins: **Pipeline**, **GitHub Branch Source**, **Credentials Binding**, **Pipeline: Groovy**. Optional: **HTML Publisher**, **Allure**, **Email Extension**.
2. New Item → **Multibranch Pipeline**.
3. Branch Sources → **GitHub** → owner/repository (the configured GitHub remote). Discover branches and pull requests.
4. Add a GitHub / checkout credential if the repo is private.
5. Build Configuration → Mode: **by Jenkinsfile** → Script Path: **`jenkins/Jenkinsfile`**.
6. Scan the organization/project so Jenkins lists branches and PRs. First scan does not prove tests passed — it only discovers Jenkinsfiles.

Lightweight profile (`CHANGE_ID` set, or branch not in the protected list): fixture at `http://127.0.0.1:4173`, discovery, Playwright e2e (selected regression), API, accessibility, `test:performance -- --profile=liveness`. Not `qa:all`. Heavy JMeter is not authorized.

Protected branches: `npm run qa:all` (visual, responsive, cross-browser, security, SEO/content, failure analysis, retest, coverage, Allure, final summary). Still liveness JMeter only. Optional parameter `DISCOVER_URL` passes `--url=`. Empty keeps the fixture origin.

### Dedicated regression job

New Item → Pipeline → Pipeline script from SCM → Script Path `jenkins/Jenkinsfile.regression`. Optional `DISCOVER_URL`. Same artifact set as Multibranch protected-branch runs.

### Dedicated performance job

New Item → Pipeline → Script Path `jenkins/Jenkinsfile.performance`.

Parameters:

- `PROFILE`: `load` / `stress` / `spike` / `soak`
- `AUTHORIZE_HEAVY`: default **false**. The job fails with `NOT_AUTHORIZED` unless you set it true.
- `API_URL_OVERRIDE`: empty by default. Do not point this at production.

Even when authorized, `scripts/run-performance.ts` still requires loopback or a host in `qa.config.json` `jmeter.allowHeavyAgainst` (currently `[]`). Public hosts are refused.

## Credentials (Secret text)

Create these IDs under Jenkins Credentials (folder or global). Leave the secret empty or omit the ID if unused — helpers treat missing IDs as empty and do not print values.

| Credential ID | Environment variable | Used for |
| --- | --- | --- |
| `qa-website-url` | `QA_WEBSITE_URL` | Recorded only on PR/regression (fixture origin stays in use) |
| `qa-api-url` | `QA_API_URL` | Postman / JMeter API base |
| `qa-username` | `QA_USERNAME` | Documented UI login |
| `qa-password` | `QA_PASSWORD` | Documented UI login |
| `qa-api-token` | `QA_API_TOKEN` | Documented API auth |
| `qa-api-username` | `QA_API_USERNAME` | Documented API auth |
| `qa-api-password` | `QA_API_PASSWORD` | Documented API auth |

Use **Secret text** (or equivalent) so Pipeline `string(credentialsId: '…')` can bind them. Never put values in Jenkinsfiles or this README.

## Agent image

The Jenkinsfile uses `agent any`. Point the job at an agent (or Docker image) that has:

- **Node.js 20** (18+ accepted by preflight) and npm
- **Playwright browsers** (`npx playwright install`; Linux agents use `--with-deps`)
- **Java 17+** for JMeter non-GUI and Allure CLI
- **Apache JMeter** on `PATH` or `JMETER_HOME` (the npm stage records a gap if missing — it does not download JMeter)
- Windows **or** Linux: helpers call `sh` or `bat` via `isUnix()`

`jenkins/scripts/start-fixture.sh` is for Unix agents. `jenkins/scripts/start-fixture.ps1` is for Windows agents.

## Archived artifacts

Every job archives (empty sets allowed):

- `reports/allure/` (HTML + raw results)
- `reports/playwright/` (HTML)
- `test-results/` (screenshots, videos, traces)
- `reports/postman/`
- `reports/jmeter/`
- logs (`*.log`, `jmeter.log`)
- `reports/summary/` (final QA report) plus coverage, orchestrator, performance, lighthouse when present

`.env` and `config/generated.env` are excluded. Optional HTML Publisher / Allure plugins publish the same folders when installed; they are not required.

## Notification

The Notification stage writes a console summary (job, build, result, branch — no secrets). If the Email Extension plugin is configured, it also sends a short mail. Missing email config is a console note, not a hidden skip of the QA results.
