# Universal Web QA Framework — Upgrade Roadmap

This tracks the framework's migration toward the client-supplied "Universal Web QA Automation
Framework" specification: a generic, discovery-driven, single-command (`qa test <url>`) pipeline
that works against any site without hand-written per-site test specs.

The full specification is ~30 subsystems across 10 phases — realistically weeks of work. Rather
than build shallow stubs across all of it at once (which risks exactly what the spec explicitly
forbids — fake passes, half-finished implementations), this repo implements **one real, complete,
backward-compatible slice at a time**. This document tracks what's done and what's next.

## What shipped in this phase

- **Discovery engine** (`scripts/discovery/`, `scripts/core/scope.ts`, `scripts/core/robots.ts`,
  `scripts/core/sitemap.ts`): crawls a given URL within scope (same-origin by default, optional
  additional hosts), aware of `robots.txt` and `sitemap.xml`, with hard page/depth limits so a
  crawl can never be unbounded. Captures per-page status, title, headings, console errors, and
  failed network requests. Output: `reports/discovery/discovery.json`.
- **Element inventory engine** (`scripts/inventory/`): walks the rendered DOM of every discovered
  page (works on client-rendered SPAs, not just static HTML) and records every button, link, and
  form input with locator candidates, visibility/enabled/required state, and a risk label. Output:
  `reports/discovery/inventory.json`.
- **Safety policy** (`scripts/core/safety-policy.ts`): a **default-deny** gate — no automatically
  generated check ever submits a form or clicks anything correlated with a state-changing request
  (POST/PUT/PATCH/DELETE), full stop, not configurable per run. This is hardcoded, not driven by
  the keyword-based risk classifier (which exists only to label risk in the report for a human to
  see, never to authorize execution). Regression-proven against a committed local fixture site
  (`fixtures/site/`, `scripts/testing/`) that models a live "Delete account" button and newsletter
  form, asserting zero non-GET requests ever reach it during a real crawl.
- **Automatic test planning** (`scripts/planning/`): turns discovery + inventory into a check plan
  — broken-link detection, page-load/heading sanity, and non-destructive form field
  presence/boundary validation (fill, blur, assert visible/enabled — never submit). Anything unsafe
  or unresolvable is reported as `BLOCKED` / `NOT_TESTED` / `REQUIRES_CONFIGURATION` with a reason,
  never silently skipped.
- **Single command**: `npm run qa:test -- <url>` runs discovery → inventory → planning → execution
  → the existing enterprise report, unchanged for anyone not using it (`npm run qa`, `test:all`,
  and every hand-written spec still work exactly as before).
- **Report extensions** (`scripts/lib/qa-report/`): new Discovery Summary, Element Inventory, and
  Coverage Breakdown sections across HTML/DOCX/text/JSON; the dormant `CONDITIONAL PASS` status is
  now live (used when something was `BLOCKED`/`REQUIRES_CONFIGURATION` but nothing failed outright);
  a pre-existing bug where Playwright retries could flip the report to a false FAIL was fixed
  (`enterprise-model.ts` was reading the first retry attempt instead of the final one).
- **Unit test layer** (`npm run test:unit`, Node's built-in `node:test`): this repo previously had
  no tests for its own logic. The safety policy, URL-scoping, and check-planning logic now have
  direct unit coverage, plus the fixture-site integration test above.
- **SEO analysis** (`scripts/seo/analyze-seo.ts`): a pure static-analysis pass over discovered pages
  — missing/duplicate `<title>`, missing/duplicate meta description, missing/multiple `<h1>`,
  missing canonical URL, `robots` noindex, images without `alt`, missing Open Graph tags, and
  non-HTTPS pages — reported as severity-classified findings (Layer 2.11 of the enterprise report),
  not fake pass/fail test cases. `discovery.json`'s per-page record was extended to capture this
  metadata during the same crawl (no extra navigation pass). Output: `reports/discovery/seo.json`.

## Follow-up work in this same phase (not a new phase — extends the slice above)

SEO analysis (above) was the first deferred-phase item to land, chosen because it needed zero new
dependencies and builds directly on `discovery.json`. Live verification against a real production
site surfaced and fixed four real bugs beyond the SEO work itself, all now
unit-tested:

1. Client-rendered SPA content wasn't ready when read immediately after Playwright's `load` event
   (React hadn't hydrated yet) — both the crawler's link extraction and the element inventory now
   wait for a heading/link/interactive element to actually attach before reading the DOM.
2. Elements with duplicate visible text (repeated carousel controls, a nav item present in both a
   desktop and mobile menu) produced duplicate generated Playwright test titles, which crashes test
   collection outright — fixed by including the check's unique id in the generated test title.
3. An element correctly inventoried as `visible: false` (e.g. a mobile-only hamburger menu, hidden
   at a desktop viewport via something like Tailwind's `lg:hidden`) was still asserted
   `visible: true` unconditionally — a guaranteed false failure, not a real defect. `generateChecks()`
   now respects the inventoried visibility and reports `NOT_TESTED` instead.
4. A text-only locator (the fallback when no id/name/aria-label/testid/placeholder exists) is not
   guaranteed unique — two unrelated elements sharing the same visible text (e.g. a "Book a Call"
   button and an unrelated "Book a Call" link) can make Playwright's `.first()` resolve to the wrong
   one entirely. Detected via per-page locator-frequency counting and downgraded to
   `REQUIRES_CONFIGURATION` rather than asserting against an ambiguous target.

Full end-to-end proof: a real crawl of a production site now runs clean — 0 failures, correctly
gated skips, report correctly shows `CONDITIONAL PASS`.

## Deferred phases (tracked against the source spec's own numbering)

| Phase | Scope | Depends on |
|---|---|---|
| 4 — Browser/UI Quality | ~~Responsive/device viewport matrix~~ **shipped as viewport emulation** (`npm run test:responsive`); ~~visual regression~~ **shipped** (`npm run test:visual`); ~~cross-browser engines~~ **shipped** (`npm run test:e2e:cross-browser` — Chromium/Firefox/WebKit, not iOS Safari / Android Chrome); ~~axe-based accessibility scanning~~ **shipped** (`npm run test:accessibility` — automated checks only, not a complete WCAG audit); remaining: real-device/cloud adapters (BrowserStack/Sauce) via `playwright.crossBrowser.targets` | Real-device / cloud adapters |
| 5 — Web Quality | ~~SEO checks~~ **shipped** (discovery `analyzeSeo` plus `npm run test:seo`: title/meta/canonical/OG/robots/sitemap/alt/URL/404/redirect — not a ranking audit). ~~Content QA~~ **shipped** (`npm run test:content` — structural only; business claims are not fact-checked). Remaining: storage/cookie audit (`context().cookies()`, `page.evaluate(() => localStorage)` — both already available in the installed Playwright version); iframe/third-party widget adapters | None (storage); per-integration adapters for iframes |
| 6 — API expansion | ~~Postman CLI collection with status/schema/time/error cases~~ **shipped** (`npm run test:api`, `tests/api/postman/collections/`); ~~discovery-origin merge~~ **shipped** (observed xhr/fetch on `urls.api` only). Remaining: richer OpenAPI-driven negatives (401/403/422 when the target documents them); token flows when `postman.auth` is configured | Documented auth contract + `QA_API_TOKEN` |
| 7 — Non-functional | ~~Configurable load/stress/spike/soak profiles~~ **shipped** (`npm run test:performance` is smoke; heavy profiles require `--authorize-heavy` and a loopback or allowlisted host). Remaining: web vitals (LCP/CLS/INP/FCP/TTFB) | Web-vitals collection via Playwright performance APIs |
| 8 — Security & optional DB | ~~Safe security-header/HTTPS/mixed-content baseline checks~~ **shipped** (`npm run test:security` — QA-level observational checks, not a pentest). Remaining: optional MySQL/PostgreSQL/SQL Server/MongoDB adapters for UI/API → DB verification | `mysql2`/`pg`/`mssql`/`mongodb` (none installed; DB access must be explicitly configured per the source spec, never assumed) |
| 9 — CI/CD & quality gates | Wire `qa:test` into `.github/workflows/qa-automation.yml`; multi-CI-provider generation (Jenkins/GitLab/Azure DevOps) | None — existing CI workflow is untouched by this phase deliberately |
| 10 — Hardening | ~~UI+API correlation for documented pairs~~ **shipped** (`npm run test:workflows` — not every UI test is API-coupled); ~~failure classification~~ **shipped** (`npm run analyze:failures` — evidence-based class, never changes a test to pass); ~~controlled retest~~ **shipped** (`npm run retest` — original FAIL preserved, targeted re-run, no assertion weakening). Remaining: self-healing locator suggestions (must never convert a genuine failure into an unexplained pass); flaky-test detection; broader CRUD workflows with cleanup | Builds on documented Postman paths + hand-written workflow specs |

## Definition of Done — status against the source spec's checklist

- [x] Running the single-command workflow against a new, ordinary website performs discovery
      without requiring hand-written test specs for every page.
- [x] The framework produces a page inventory and interactive-element inventory.
- [x] Every discovered testable element is assigned an appropriate test strategy or an explicit
      NOT TESTED / BLOCKED / REQUIRES CONFIGURATION reason.
- [x] Forms receive positive/boundary validation where rules can be inferred safely (negative /
      full boundary-matrix testing is deferred to Phase 6).
- [x] Links and navigation are validated (broken-link detection).
- [x] Responsive viewports can be executed (Chromium emulation, not real devices / not Mobile Safari).
- [x] Visual regression can be enabled (`npm run test:visual`; baselines never auto-update).
- [x] Accessibility scanning can be enabled (`npm run test:accessibility` — automated axe/keyboard checks, not a complete manual WCAG audit).
- [x] SEO checks can be enabled (title/description/canonical/H1/alt-text/Open Graph/HTTPS/robots
      /sitemap/URL/404/redirect — Layer 2.11; `npm run test:seo` plus discovery analysis).
- [x] Content QA can be enabled (headings/empty sections/placeholders/broken assets — Layer 2.15;
      `npm run test:content`; not factual verification of business claims).
- [x] Console and network errors are captured (per-page, during discovery).
- [x] API testing runs deeper validation when a spec/collection is configured
      (`npm run test:api` — status, schema/required fields, errors, response time;
      auth/authorization stay REQUIRES_CONFIGURATION until the target documents them).
- [ ] Authentication can be configured securely for crawling authenticated areas. — Phase 6/8
- [x] Performance testing supports load/stress/spike/soak profiles
      (`tests/performance/{smoke,load,stress,spike,soak}/`; CI and
      `npm run test:performance` run smoke only; heavy profiles need
      `--authorize-heavy` plus a loopback or `allowHeavyAgainst` host.
      Thresholds stay undefined unless `jmeter.thresholds` is provided).
- [x] Reports contain evidence and distinguish tested scope from untested scope.
- [x] Advanced coverage is covered ÷ testable discovered items across page, route, UI
      element, field, button, link, form, workflow, API, browser, responsive,
      accessibility, and visual dimensions (`npm run coverage`, report 3.1).
      Every item has page/element/type/reason/recommended test/status; nothing is omitted.
- [x] Destructive actions are protected by a default-deny safety policy, regression-tested against
      a fixture site.
- [x] The same framework works against multiple websites without changing its core source code
      (no site is hardcoded into `scripts/core/`, `scripts/discovery/`, `scripts/inventory/`, or
      `scripts/planning/` — only `qa.config.json` and hand-written specs are site-specific, by
      design).
- [x] CI/CD executes the discovery-driven fixture pipeline on push, pull_request, and workflow_dispatch
      (`.github/workflows/qa-automation.yml`). Heavy JMeter is manual-only (`qa-performance-heavy.yml`).
      Secrets use GitHub Secrets; `QA_PERF_AUTHORIZE` is never set in normal CI.
- [x] Failures return appropriate process exit codes.
- [x] Failed executions are classified from artifacts (`npm run analyze:failures`, report 2.16)
      without modifying a test merely to make it pass.
- [x] Controlled retest records original FAIL and final result (`npm run retest`, report 2.17)
      without hiding failures, removing tests, or weakening assertions.
- [x] Secrets are not exposed in source code or reports (unchanged from the existing pipeline).
- [x] Unified professional report (`npm run report:final`, `reports/summary/final-qa-report.md`)
      with 35 sections, P0–P3 severity, and verdict PASS / PASS WITH OBSERVATIONS / FAIL / BLOCKED.
      PASS is never issued while a critical release blocker remains. 100% coverage is never claimed
      without evidence. Raw tool reports stay in `reports/<tool>/`.
- [x] Unified orchestrator (`npm run qa:all`, `scripts/run-all.ts`) runs 18 stages as child
      processes, records every exit code, continues after failures, and writes
      `reports/orchestrator/summary.json`. The process exit code reflects failed stages.
