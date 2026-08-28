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
├── pages/                            # Page Object Model
├── tests/
│   ├── e2e/                          # Playwright UI tests
│   ├── api/postman/                  # Postman collection + environment
│   └── performance/                  # JMeter load-test.jmx
├── test-data/                        # JSON test data
├── utils/                            # Shared helpers
├── scripts/                          # Sync, runners, enterprise report
├── npm-docs/                         # Text sanitization / legacy txt→docx
├── docs/
│   ├── templates/                    # Report format template
│   └── output/qa-test-results/       # Timestamped DOCX/HTML/PDF
├── reports/                          # Runtime tool reports (gitignored)
├── playwright.config.ts
├── package.json
└── .env.example
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | TypeScript check |
| `npm run qa:sync` | Regenerate configs from `qa.config.json` |
| `npm run test:e2e` | Playwright |
| `npm run test:api` | Postman CLI |
| `npm run test:performance` | JMeter |
| `npm run test:all` | Full suite + summary + enterprise report |
| `npm run docs:qa-report` | Regenerate enterprise DOCX/HTML/PDF |
| `npm run rules:sync` | Sync `.cursor/rules/*.json` → `.mdc` |

## Reports

Enterprise five-layer SQA report (Executive Summary, Test Evidence, QA Analysis, Risks & Limitations, Release Recommendation):

- Latest index: `docs/output/qa-test-results/latest.json`
- Formats: DOCX, HTML, PDF (timestamped folders)

## CI/CD flow

```
Push code → GitHub Actions → Install Node → TypeScript check
  → Sync → Playwright → Postman → JMeter → Upload reports
```

## Secrets

Copy `.env.example` to `.env` and fill in real values. Never commit `.env`.
