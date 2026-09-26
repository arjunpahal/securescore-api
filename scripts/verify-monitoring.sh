#!/usr/bin/env bash
# =============================================================================
# SecureScore monitoring verification
#
# Asserts that the monitoring stack is genuinely working, rather than merely
# running. A container that starts but scrapes nothing is worse than no
# monitoring at all, because it looks like coverage that does not exist.
#
# This script proves four things:
#   1. Prometheus is healthy and has the API registered as an UP target
#   2. The alert rules are loaded and evaluating
#   3. Real application metrics — including business metrics — have values
#   4. Grafana is healthy with the SecureScore dashboard provisioned
#
# Usage:
#   ./verify-monitoring.sh http://host.docker.internal:9090 \
#                          http://host.docker.internal:3001
# =============================================================================

set -uo pipefail

PROM_URL="${1:-http://localhost:9090}"
GRAFANA_URL="${2:-http://localhost:3001}"
GRAFANA_USER="${GRAFANA_USER:-admin}"
GRAFANA_PASSWORD="${GRAFANA_PASSWORD:-admin}"

PASS=0
FAIL=0

green() { printf '\033[0;32m%s\033[0m\n' "$1"; }
red()   { printf '\033[0;31m%s\033[0m\n' "$1"; }
info()  { printf '\033[0;36m%s\033[0m\n' "$1"; }

ok()  { green "  PASS  $1"; PASS=$((PASS + 1)); }
bad() { red   "  FAIL  $1"; FAIL=$((FAIL + 1)); }

# Returns the scalar value of an instant query, or empty if there is no data.
promq() {
  curl -s --get "${PROM_URL}/api/v1/query" --data-urlencode "query=$1" \
    | jq -r '.data.result[0].value[1] // empty' 2>/dev/null
}

echo "==============================================================="
echo " SecureScore monitoring verification"
echo " Prometheus: ${PROM_URL}"
echo " Grafana:    ${GRAFANA_URL}"
echo "==============================================================="

# --- 1. Prometheus reachable -------------------------------------------------
info ""
info "1/4  Prometheus availability"

READY=0
for i in $(seq 1 30); do
  if curl -fsS "${PROM_URL}/-/healthy" >/dev/null 2>&1; then
    READY=1
    ok "Prometheus healthy (after ${i} attempt(s))"
    break
  fi
  sleep 2
done
[ "$READY" -eq 1 ] || { bad "Prometheus never became healthy"; echo "Passed: ${PASS}  Failed: ${FAIL}"; exit 1; }

# --- 2. Scrape target is UP --------------------------------------------------
info ""
info "2/4  Scrape targets"

TARGET_UP=0
for i in $(seq 1 20); do
  HEALTH="$(curl -s "${PROM_URL}/api/v1/targets" \
    | jq -r '.data.activeTargets[] | select(.labels.job=="securescore-api") | .health' 2>/dev/null | head -1)"
  if [ "$HEALTH" = "up" ]; then
    TARGET_UP=1
    ok "securescore-api target is UP"
    break
  fi
  sleep 3
done

if [ "$TARGET_UP" -ne 1 ]; then
  bad "securescore-api target is not UP (last health: '${HEALTH:-none}')"
  info "  Active targets seen by Prometheus:"
  curl -s "${PROM_URL}/api/v1/targets" \
    | jq -r '.data.activeTargets[] | "    \(.labels.job)  \(.scrapeUrl)  \(.health)  \(.lastError // "")"' 2>/dev/null \
    || echo "    (could not parse targets)"
fi

UP_VALUE="$(promq 'up{job="securescore-api"}')"
[ "$UP_VALUE" = "1" ] && ok "up{job=\"securescore-api\"} == 1" \
                      || bad "up{job=\"securescore-api\"} is '${UP_VALUE:-no data}'"

# --- 3. Alert rules loaded ---------------------------------------------------
info ""
info "3/4  Alert rules"

RULES_JSON="$(curl -s "${PROM_URL}/api/v1/rules")"

RULE_GROUPS="$(printf '%s' "$RULES_JSON" | jq -r '.data.groups | length' 2>/dev/null)"
if [ "${RULE_GROUPS:-0}" -ge 3 ]; then
  ok "${RULE_GROUPS} alert rule groups loaded"
else
  bad "expected at least 3 alert rule groups, found ${RULE_GROUPS:-0}"
fi

ALERT_COUNT="$(printf '%s' "$RULES_JSON" \
  | jq -r '[.data.groups[].rules[] | select(.type=="alerting")] | length' 2>/dev/null)"
if [ "${ALERT_COUNT:-0}" -ge 8 ]; then
  ok "${ALERT_COUNT} alerting rules registered"
else
  bad "expected at least 8 alerting rules, found ${ALERT_COUNT:-0}"
fi

for RULE in APIDown DatabaseUnreachable HighErrorRate ProjectScoreCritical AuthenticationFailureSpike; do
  if printf '%s' "$RULES_JSON" | jq -e --arg n "$RULE" \
      '.data.groups[].rules[] | select(.name==$n)' >/dev/null 2>&1; then
    ok "rule '${RULE}' is registered"
  else
    bad "rule '${RULE}' is missing"
  fi
done

# Every rule should be evaluating without error.
BAD_RULES="$(printf '%s' "$RULES_JSON" \
  | jq -r '[.data.groups[].rules[] | select(.health!="ok") | .name] | join(", ")' 2>/dev/null)"
if [ -z "$BAD_RULES" ] || [ "$BAD_RULES" = "null" ]; then
  ok "all rules evaluating without error"
else
  bad "rules reporting unhealthy evaluation: ${BAD_RULES}"
fi

# --- 4. Real metric data -----------------------------------------------------
info ""
info "4/4  Application metrics"

REQ_TOTAL="$(promq 'sum(securescore_http_requests_total)')"
if [ -n "$REQ_TOTAL" ] && [ "${REQ_TOTAL%%.*}" -gt 0 ] 2>/dev/null; then
  ok "HTTP request counter has data (${REQ_TOTAL} requests recorded)"
else
  bad "securescore_http_requests_total has no data"
fi

DB_UP="$(promq 'securescore_database_up')"
[ "$DB_UP" = "1" ] && ok "database connectivity gauge reports up" \
                   || bad "securescore_database_up is '${DB_UP:-no data}'"

SCORED="$(promq 'count(securescore_project_health_score)')"
if [ -n "$SCORED" ] && [ "${SCORED%%.*}" -gt 0 ] 2>/dev/null; then
  ok "business metric present — ${SCORED} project health score series"
else
  bad "securescore_project_health_score has no data"
fi

AVG_SCORE="$(promq 'avg(securescore_project_health_score)')"
[ -n "$AVG_SCORE" ] && ok "average project health score = ${AVG_SCORE}" \
                    || bad "could not compute average project health score"

AUTH_FAIL="$(promq 'sum(securescore_auth_attempts_total{outcome="failure"})')"
if [ -n "$AUTH_FAIL" ] && [ "${AUTH_FAIL%%.*}" -gt 0 ] 2>/dev/null; then
  ok "incident simulation visible — ${AUTH_FAIL} failed auth attempts recorded"
else
  bad "no failed authentication attempts recorded"
fi

SCANS="$(promq 'sum(securescore_scans_total)')"
[ -n "$SCANS" ] && ok "scan counter has data (${SCANS} scans)" \
                || bad "securescore_scans_total has no data"

LATENCY="$(promq 'histogram_quantile(0.95, sum(rate(securescore_http_request_duration_seconds_bucket[5m])) by (le))')"
[ -n "$LATENCY" ] && ok "p95 latency computable (${LATENCY}s)" \
                  || bad "latency histogram has insufficient data"

# --- Alerts currently firing -------------------------------------------------
info ""
info "Alert state"

FIRING="$(curl -s "${PROM_URL}/api/v1/alerts" \
  | jq -r '[.data.alerts[] | select(.state=="firing") | .labels.alertname] | unique | join(", ")' 2>/dev/null)"
PENDING="$(curl -s "${PROM_URL}/api/v1/alerts" \
  | jq -r '[.data.alerts[] | select(.state=="pending") | .labels.alertname] | unique | join(", ")' 2>/dev/null)"

echo "  Firing : ${FIRING:-none}"
echo "  Pending: ${PENDING:-none}"

if [ -n "$FIRING" ] && [ "$FIRING" != "null" ]; then
  ok "alerting pipeline is actively firing on the simulated incident"
elif [ -n "$PENDING" ] && [ "$PENDING" != "null" ]; then
  ok "alerting pipeline has alerts pending (rule 'for' duration not yet elapsed)"
else
  info "  No alerts firing yet — rules evaluate over a time window, so this"
  info "  is expected on a freshly deployed stack. Rule registration above"
  info "  is the assertion that matters for pipeline verification."
fi

# --- Grafana -----------------------------------------------------------------
info ""
info "Grafana"

G_READY=0
for i in $(seq 1 25); do
  if curl -fsS "${GRAFANA_URL}/api/health" >/dev/null 2>&1; then
    G_READY=1
    ok "Grafana healthy (after ${i} attempt(s))"
    break
  fi
  sleep 3
done

if [ "$G_READY" -eq 1 ]; then
  DS="$(curl -s -u "${GRAFANA_USER}:${GRAFANA_PASSWORD}" "${GRAFANA_URL}/api/datasources" \
        | jq -r '[.[] | select(.type=="prometheus")] | length' 2>/dev/null)"
  [ "${DS:-0}" -ge 1 ] && ok "Prometheus datasource provisioned" \
                       || bad "no Prometheus datasource found in Grafana"

  DASH="$(curl -s -u "${GRAFANA_USER}:${GRAFANA_PASSWORD}" \
          "${GRAFANA_URL}/api/search?query=SecureScore" | jq -r 'length' 2>/dev/null)"
  [ "${DASH:-0}" -ge 1 ] && ok "SecureScore dashboard provisioned" \
                         || bad "SecureScore dashboard not found"
else
  bad "Grafana never became healthy"
fi

# --- Summary -----------------------------------------------------------------
echo ""
echo "==============================================================="
echo " Passed: ${PASS}    Failed: ${FAIL}"
echo "==============================================================="

if [ "$FAIL" -gt 0 ]; then
  red "MONITORING VERIFICATION FAILED"
  exit 1
fi

green "MONITORING VERIFIED — metrics flowing, rules loaded, dashboard live."
exit 0
