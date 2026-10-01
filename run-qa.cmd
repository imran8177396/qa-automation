@echo off
setlocal EnableExtensions

rem One-command full QA pipeline for Windows Command Prompt (cmd.exe).
rem Usage:
rem   run-qa.cmd https://www.schiwopakistan.com/
rem   run-qa.cmd
rem Without a URL, reuses QA_WEBSITE_URL / QA_PLAYWRIGHT_BASE_URL / last-target / config.
rem Never invents a demo URL.

cd /d "%~dp0"
if errorlevel 1 (
  echo ERROR: Could not change to the script directory.
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js not found on PATH. Install Node.js 18+ and reopen Command Prompt.
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm not found on PATH. Install Node.js 18+ ^(includes npm^) and reopen Command Prompt.
  exit /b 1
)

rem Heap for long planning/report stages — do not override an existing NODE_OPTIONS heap.
echo %NODE_OPTIONS% | findstr /I /C:"max-old-space-size" >nul
if errorlevel 1 (
  if defined NODE_OPTIONS (
    set "NODE_OPTIONS=%NODE_OPTIONS% --max-old-space-size=4096"
  ) else (
    set "NODE_OPTIONS=--max-old-space-size=4096"
  )
)

rem Prefer the real user Playwright browser cache when PLAYWRIGHT_BROWSERS_PATH is
rem missing, points at a sandbox, or does not exist. Browsers live under %%LOCALAPPDATA%%\ms-playwright.
set "QA_DEFAULT_PW_BROWSERS=%USERPROFILE%\AppData\Local\ms-playwright"
if not defined PLAYWRIGHT_BROWSERS_PATH (
  if exist "%QA_DEFAULT_PW_BROWSERS%\" set "PLAYWRIGHT_BROWSERS_PATH=%QA_DEFAULT_PW_BROWSERS%"
) else (
  echo %PLAYWRIGHT_BROWSERS_PATH% | findstr /I /C:"sandbox" >nul
  if not errorlevel 1 (
    if exist "%QA_DEFAULT_PW_BROWSERS%\" set "PLAYWRIGHT_BROWSERS_PATH=%QA_DEFAULT_PW_BROWSERS%"
  ) else if not exist "%PLAYWRIGHT_BROWSERS_PATH%\" (
    if exist "%QA_DEFAULT_PW_BROWSERS%\" set "PLAYWRIGHT_BROWSERS_PATH=%QA_DEFAULT_PW_BROWSERS%"
  )
)

echo.
echo ============================================================
echo  QA Automation — full pipeline ^(run-qa.cmd^)
echo ============================================================
echo  Root: %CD%
echo.

call npx --yes tsx scripts/run-qa-full.ts %*
set "EXITCODE=%ERRORLEVEL%"
echo.
echo Wrapper finished with exit code %EXITCODE%
exit /b %EXITCODE%
