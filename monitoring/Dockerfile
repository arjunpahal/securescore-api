# =============================================================================
# Grafana image with the SecureScore datasource and dashboard provisioned.
#
# Provisioning files are baked in so the dashboard exists the moment the
# container starts, with no manual import step. This matters for the pipeline:
# the Monitoring stage can assert the dashboard is present rather than relying
# on someone having clicked through the Grafana UI beforehand.
# =============================================================================

FROM grafana/grafana:11.1.0

COPY provisioning/ /etc/grafana/provisioning/
COPY dashboards/   /var/lib/grafana/dashboards/

ENV GF_USERS_ALLOW_SIGN_UP=false \
    GF_AUTH_ANONYMOUS_ENABLED=true \
    GF_AUTH_ANONYMOUS_ORG_ROLE=Viewer

LABEL org.opencontainers.image.title="SecureScore Grafana" \
      org.opencontainers.image.description="Grafana with the SecureScore overview dashboard provisioned"
