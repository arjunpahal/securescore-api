#!/usr/bin/env bash
# =============================================================================
# SecureScore post-deployment smoke test
#
# Exercises the deployed stack end to end against a real database. This is the
# gate on the Deploy stage: if any assertion fails the deployment is rejected
# and the pipeline tears the environment down rather than promoting it.
#
# Unlike the Jest integration tests, which mock the database, this runs
# against the actual deployed containers — so it catches wiring problems that
# unit and integration tests cannot see: a bad connection string, a migration
# that did not apply, a container that starts but cannot reach postgres.
#
# Usage:  ./smoke-test.sh http://host.docker.internal:3100
# =============================================================================

set -uo pipefail

BASE_URL="${1:-http://localhost:3100}"
EMAIL="${SMOKE_EMAIL:-admin@deakin.edu.au}"
PASSWORD="${SMOKE_PASSWORD:-SecurePass2026}"

PASS=0
FAIL=0

green() { printf '\033[0;32m%s\033[0m\n' "$1"; }
red()   { printf '\033[0;31m%s\033[0m\n' "$1"; }
info()  { printf '\033[0;36m%s\033[0m\n' "$1"; }

check() {
  local name="$1" actual="$2" expected="$3"
  if [ "$actual" = "$expected" ]; then
    green "  PASS  ${name}"
    PASS=$((PASS + 1))
  else
    red   "  FAIL  ${name}  (expected '${expected}', got '${actual}')"
    FAIL=$((FAIL + 1))
  fi
}

contains() {
  local name="$1" haystack="$2" needle="$3"
  if printf '%s' "$haystack" | grep -q -- "$needle"; then
    green "  PASS  ${name}"
    PASS=$((PASS + 1))
  else
    red   "  FAIL  ${name}  (response did not contain '${needle}')"
    FAIL=$((FAIL + 1))
  fi
}

status_of() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

echo "==============================================================="
echo " SecureScore smoke test"
echo " Target: ${BASE_URL}"
echo "==============================================================="

# --- Wait for the service to come up ----------------------------------------
info "Waiting for ${BASE_URL}/health ..."
READY=0
for i in $(seq 1 40); do
  if [ "$(status_of "${BASE_URL}/health")" = "200" ]; then
    READY=1
    green "Service responded after ${i} attempt(s)."
    break
  fi
  sleep 3
done

if [ "$READY" -ne 1 ]; then
  red "Service never became healthy at ${BASE_URL} after 120 seconds."
  exit 1
fi

# --- Operational endpoints ---------------------------------------------------
info ""
info "Operational endpoints"

check "GET /health returns 200" "$(status_of "${BASE_URL}/health")" "200"
contains "GET /health reports ok" "$(curl -s "${BASE_URL}/health")" '"status":"ok"'

check "GET /ready returns 200" "$(status_of "${BASE_URL}/ready")" "200"
contains "GET /ready reports database up" "$(curl -s "${BASE_URL}/ready")" '"database":"up"'

contains "GET /metrics exposes custom metrics" \
         "$(curl -s "${BASE_URL}/metrics")" "securescore_http_requests_total"

contains "GET / returns the service descriptor" \
         "$(curl -s "${BASE_URL}/")" '"SecureScore API"'

# --- Security posture --------------------------------------------------------
info ""
info "Security posture"

HEADERS="$(curl -s -D - -o /dev/null "${BASE_URL}/health")"
contains "Sets X-Content-Type-Options" "$HEADERS" "nosniff"
contains "Sets Content-Security-Policy" "$HEADERS" "content-security-policy"

if printf '%s' "$HEADERS" | grep -qi "x-powered-by"; then
  red "  FAIL  X-Powered-By header is suppressed"
  FAIL=$((FAIL + 1))
else
  green "  PASS  X-Powered-By header is suppressed"
  PASS=$((PASS + 1))
fi

check "Protected route rejects anonymous access" \
      "$(status_of "${BASE_URL}/api/v1/projects")" "401"

check "Protected route rejects a forged token" \
      "$(status_of -H 'Authorization: Bearer forged.token.value' "${BASE_URL}/api/v1/projects")" "401"

# --- Authentication against the real database --------------------------------
info ""
info "Authentication (real database)"

LOGIN_RESPONSE="$(curl -s -X POST "${BASE_URL}/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}")"

TOKEN="$(printf '%s' "$LOGIN_RESPONSE" \
  | sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"

if [ -n "$TOKEN" ]; then
  green "  PASS  Seeded admin account authenticates"
  PASS=$((PASS + 1))
else
  red "  FAIL  Seeded admin account authenticates"
  red "        response: ${LOGIN_RESPONSE}"
  FAIL=$((FAIL + 1))
  echo ""
  red "Cannot continue without a token. Remaining checks skipped."
  echo "Passed: ${PASS}   Failed: ${FAIL}"
  exit 1
fi

check "Wrong password is rejected" \
      "$(status_of -X POST "${BASE_URL}/api/v1/auth/login" \
         -H 'Content-Type: application/json' \
         -d "{\"email\":\"${EMAIL}\",\"password\":\"WrongPassword123\"}")" "401"

AUTH="Authorization: Bearer ${TOKEN}"

contains "GET /auth/me returns the caller identity" \
         "$(curl -s -H "$AUTH" "${BASE_URL}/api/v1/auth/me")" "$EMAIL"

# --- Seeded data proves migrations applied -----------------------------------
info ""
info "Data layer (proves migrations and seed applied)"

PROJECTS="$(curl -s -H "$AUTH" "${BASE_URL}/api/v1/projects")"
contains "Project list contains seeded AppAttack"          "$PROJECTS" "AppAttack"
contains "Project list contains seeded Smishing Detection" "$PROJECTS" "Smishing Detection"

STATS="$(curl -s -H "$AUTH" "${BASE_URL}/api/v1/projects/statistics")"
contains "Statistics endpoint aggregates projects" "$STATS" "total_projects"

check "Unknown project id returns 404" \
      "$(status_of -H "$AUTH" "${BASE_URL}/api/v1/projects/aaaaaaaa-0000-0000-0000-00000000ffff")" "404"

check "Malformed project id returns 400" \
      "$(status_of -H "$AUTH" "${BASE_URL}/api/v1/projects/not-a-uuid")" "400"

# --- Core business logic through the deployed stack --------------------------
info ""
info "Scoring engine (through the deployed API)"

CLEAN="$(curl -s -X POST "${BASE_URL}/api/v1/scans/preview" \
  -H "$AUTH" -H 'Content-Type: application/json' -d '{"findings":{}}')"
contains "Clean project scores 100"   "$CLEAN" '"score":100'
contains "Clean project rates HEALTHY" "$CLEAN" '"rating":"HEALTHY"'

BAD="$(curl -s -X POST "${BASE_URL}/api/v1/scans/preview" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"findings":{"critical":3,"high":2}}')"
contains "Compromised project rates CRITICAL" "$BAD" '"rating":"CRITICAL"'
contains "Compromised project raises an alert" "$BAD" '"shouldAlert":true'

MIXED="$(curl -s -X POST "${BASE_URL}/api/v1/scans/preview" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"findings":{"critical":1,"high":1,"medium":1,"low":1}}')"
contains "Weighted deduction is arithmetically correct" "$MIXED" '"score":57'

check "Unknown severity is rejected" \
      "$(status_of -X POST "${BASE_URL}/api/v1/scans/preview" \
         -H "$AUTH" -H 'Content-Type: application/json' \
         -d '{"findings":{"catastrophic":1}}')" "400"

# --- Write path: persist a scan and confirm the project updates --------------
info ""
info "Write path (persists to the database)"

PROJECT_ID="aaaaaaaa-0000-0000-0000-000000000001"

SCAN="$(curl -s -X POST "${BASE_URL}/api/v1/scans" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"projectId\":\"${PROJECT_ID}\",\"findings\":{\"high\":2,\"medium\":1}}")"
contains "Scan persists and returns a result" "$SCAN" '"score"'

SCORE_AFTER="$(curl -s -H "$AUTH" "${BASE_URL}/api/v1/projects/${PROJECT_ID}/score")"
contains "Project score reflects the new scan" "$SCORE_AFTER" '"currentScore":71'
contains "Scan history is recorded"            "$SCORE_AFTER" '"history"'

check "Alerts endpoint is reachable" \
      "$(status_of -H "$AUTH" "${BASE_URL}/api/v1/alerts")" "200"

# --- Error handling ----------------------------------------------------------
info ""
info "Error handling"

check "Unknown route returns 404" "$(status_of "${BASE_URL}/api/v1/no-such-route")" "404"
contains "404 body is structured" "$(curl -s "${BASE_URL}/api/v1/no-such-route")" '"NOT_FOUND"'

# --- Summary -----------------------------------------------------------------
echo ""
echo "==============================================================="
echo " Passed: ${PASS}    Failed: ${FAIL}"
echo "==============================================================="

if [ "$FAIL" -gt 0 ]; then
  red "SMOKE TEST FAILED — deployment will not be promoted."
  exit 1
fi

green "SMOKE TEST PASSED — deployment verified."
exit 0
