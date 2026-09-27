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

# Dynamic project lookup — seeded IDs are random UUIDs assigned at DB init
PROJ_IDS="$(curl -s -H "$AUTH" "${BASE_URL}/api/v1/projects" \
  | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'")

PROJ_ID_1="$(printf '%s\n' "$PROJ_IDS" | sed -n '1p')"
PROJ_ID_2="$(printf '%s\n' "$PROJ_IDS" | sed -n '2p')"
PROJ_ID_3="$(printf '%s\n' "$PROJ_IDS" | sed -n '3p')"
PROJ_ID_4="$(printf '%s\n' "$PROJ_IDS" | sed -n '4p')"
PROJ_ID_5="$(printf '%s\n' "$PROJ_IDS" | sed -n '5p')"

info "  IDs: ${PROJ_ID_1} / ${PROJ_ID_2} / ${PROJ_ID_3}"

# Phase 2: Submit scans using real project UUIDs
[ -n "$PROJ_ID_1" ] && scan "$PROJ_ID_1" '{"low":2}'
[ -n "$PROJ_ID_2" ] && scan "$PROJ_ID_2" '{"medium":3,"low":1}'
[ -n "$PROJ_ID_3" ] && scan "$PROJ_ID_3" '{"high":2,"medium":4}'
[ -n "$PROJ_ID_5" ] && scan "$PROJ_ID_5" '{"medium":2,"low":3}'

# Phase 3: Critical incident — 4th project or fallback to 1st
INCIDENT_PROJECT="${PROJ_ID_4:-${PROJ_ID_1}}"
[ -n "$INCIDENT_PROJECT" ] && scan "$INCIDENT_PROJECT" '{"critical":4,"high":7,"medium":12,"low":3}'
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
