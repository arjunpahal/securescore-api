#!/usr/bin/env bash
# =============================================================================
# SecureScore traffic generator
#
# Drives representative load through the deployed API so that Prometheus has
# real time-series data to scrape. Without this the Monitoring stage would be
# asserting against empty metrics, which proves nothing.
#
# The final phase deliberately generates authentication failures. That feeds
# securescore_auth_attempts_total{outcome="failure"}, which is the signal
# behind the AuthenticationFailureSpike alert rule — this is the incident
# simulation the Monitoring stage verifies.
#
# Usage:  ./generate-traffic.sh http://host.docker.internal:3100
# =============================================================================

set -uo pipefail

BASE_URL="${1:-http://localhost:3100}"
EMAIL="${SMOKE_EMAIL:-admin@deakin.edu.au}"
PASSWORD="${SMOKE_PASSWORD:-SecurePass2026}"

info() { printf '\033[0;36m%s\033[0m\n' "$1"; }

echo "==============================================================="
echo " Generating traffic against ${BASE_URL}"
echo "==============================================================="

TOKEN="$(curl -s -X POST "${BASE_URL}/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}" \
  | sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"

if [ -z "$TOKEN" ]; then
  printf '\033[0;31m%s\033[0m\n' "Could not authenticate — cannot generate authenticated traffic."
  exit 1
fi

AUTH="Authorization: Bearer ${TOKEN}"

# --- Phase 1: successful reads ----------------------------------------------
info ""
info "Phase 1/4 — successful read traffic (populates request and latency metrics)"
for _ in $(seq 1 25); do
  curl -s -o /dev/null -H "$AUTH" "${BASE_URL}/api/v1/projects"            || true
  curl -s -o /dev/null -H "$AUTH" "${BASE_URL}/api/v1/projects/statistics" || true
  curl -s -o /dev/null            "${BASE_URL}/health"                     || true
done
echo "  75 read requests issued."

# --- Phase 2: scans across every seeded project ------------------------------
# This populates securescore_scans_total and, critically, sets the
# securescore_project_health_score gauge for each project so the Grafana
# bar gauge and the ProjectScoreCritical alert have data to act on.
info ""
info "Phase 2/4 — scans across all seeded projects (populates score gauges)"

scan() {
  curl -s -o /dev/null -X POST "${BASE_URL}/api/v1/scans" \
    -H "$AUTH" -H 'Content-Type: application/json' \
    -d "{\"projectId\":\"$1\",\"findings\":$2}" || true
}

scan "aaaaaaaa-0000-0000-0000-000000000001" '{"low":2}'
scan "aaaaaaaa-0000-0000-0000-000000000002" '{"medium":3,"low":1}'
scan "aaaaaaaa-0000-0000-0000-000000000003" '{"high":2,"medium":4}'
scan "aaaaaaaa-0000-0000-0000-000000000005" '{"medium":2,"low":3}'
echo "  4 healthy-to-moderate scans recorded."

# --- Phase 3: a deliberate critical finding ----------------------------------
# Drives one project into the CRITICAL band, which raises an alert through the
# application's own alerting path and satisfies the ProjectScoreCritical
# Prometheus rule.
info ""
info "Phase 3/4 — incident simulation: driving a project into CRITICAL"
scan "aaaaaaaa-0000-0000-0000-000000000004" '{"critical":4,"high":7,"medium":12,"low":3}'
echo "  Smishing Detection driven to a CRITICAL score."

# --- Phase 4: authentication failure spike -----------------------------------
info ""
info "Phase 4/4 — incident simulation: authentication failure spike"
for _ in $(seq 1 15); do
  curl -s -o /dev/null -X POST "${BASE_URL}/api/v1/auth/login" \
    -H 'Content-Type: application/json' \
    -d '{"email":"attacker@example.com","password":"WrongPassword123"}' || true
done
echo "  15 failed authentication attempts issued."

# Give Prometheus at least one full scrape interval to collect the new series.
info ""
info "Allowing 20s for Prometheus to scrape the generated metrics ..."
sleep 20

echo ""
echo "Traffic generation complete."
