#!/bin/sh
# Print configured / not configured for known env names. Never print values.
record() {
  if [ -z "$2" ]; then
    echo "$1: not configured (auth-dependent checks may be REQUIRES_CONFIGURATION / NOT_TESTED)"
  else
    echo "$1: configured (value not printed)"
  fi
}

record QA_WEBSITE_URL "${QA_WEBSITE_URL:-}"
record QA_API_URL "${QA_API_URL:-}"
record QA_USERNAME "${QA_USERNAME:-}"
record QA_PASSWORD "${QA_PASSWORD:-}"
record QA_API_TOKEN "${QA_API_TOKEN:-}"
record QA_API_USERNAME "${QA_API_USERNAME:-}"
record QA_API_PASSWORD "${QA_API_PASSWORD:-}"
