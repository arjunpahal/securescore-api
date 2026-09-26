# =============================================================================
# Prometheus image with SecureScore scrape config and alert rules baked in.
#
# Same rationale as db/Dockerfile: bind mounts cannot be used when the
# deployment is driven from inside the Jenkins container, and immutable
# configuration images are the stronger pattern for a promoted artefact.
# =============================================================================

FROM prom/prometheus:v2.53.0

COPY prometheus.yml  /etc/prometheus/prometheus.yml
COPY alert-rules.yml /etc/prometheus/alert-rules.yml

LABEL org.opencontainers.image.title="SecureScore Prometheus" \
      org.opencontainers.image.description="Prometheus with SecureScore scrape targets and alert rules"
