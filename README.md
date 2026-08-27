# QA Automation Framework

All-tools-together QA pipeline: **Playwright**, **Postman CLI**, **JMeter**, **Git**, and **GitHub Actions** — controlled from a single config file.

## Quick start

```bash
npm install
npm run qa:sync
npm run test:all
```

## Single instruction (Cursor Agent)

Tell Cursor:

> **Perform complete QA automation for this application.**

The rule in `.cursor/rules/qa-automation.mdc` handles analysis, test creation, execution, reports, and Git prep automatically.

## Project structure

```
QA-AUTOMATION/
├── .cursor/rules/qa-automation.mdc   # Cursor QA engineer rule
├── .github/workflows/qa-automation.yml
├── qa.config.json                    # ← edit this (single source of truth)
├── pages/                            # Page Object Model
├── tests/
│   ├── e2e/                          # Playwright UI tests
│   ├── api/postman/                  # Postman collection + environment
│   └── performance/                  # JMeter load-test.jmx
├── fixtures/                         # Playwright fixtures
├── test-data/                        # JSON test data
├── utils/                            # Shared helpers
├── scripts/run-all.ts                # Smart all-tools runner
├── reports/                          # Generated reports (gitignored)
├── playwright.config.ts
├── package.json
└── .env.example
```

## Commands

| Command | Tool |
|---------|------|
| `npm run typecheck` | TypeScript |
| `npm run test:e2e` | Playwright |
| `npm run test:api` | Postman CLI |
| `npm run test:performance` | JMeter |
| `npm run test:all` | All tools + summary |
| `npm run qa:sync` | Regenerate configs from `qa.config.json` |

## CI/CD flow

```
Push code → GitHub Actions → Install Node → TypeScript check
  → Playwright → Postman → JMeter → Upload reports
```

## Secrets

Copy `.env.example` to `.env` and fill in real values. Never commit `.env`.
