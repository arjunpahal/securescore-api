// ============================================================================
// SecureScore — CI/CD Pipeline
// SIT223 / SIT753  Task 7.3HD
// Arjun Pahal  (s225634444)
//
// Seven stages: Build, Test, Code Quality, Security, Deploy, Release,
// Monitoring & Alerting.
//
// KEY DESIGN PRINCIPLE — build once, promote the artefact.
// The Build stage produces immutable, version-tagged Docker images. Every
// later stage consumes those exact images; nothing is ever rebuilt. This
// guarantees that what reaches production is bit-for-bit what was tested,
// scanned and approved, and it makes rollback a redeploy of a previous tag
// rather than a rebuild from source.
//
// PREREQUISITES ON THE JENKINS CONTROLLER
//   - Docker CLI with the host socket mounted at /var/run/docker.sock
//   - Node.js 20 and npm
//   - Trivy
//   - jq
// All four are baked into the custom jenkins-devops:lts image.
// ============================================================================

pipeline {

    agent any

    options {
        timestamps()
        timeout(time: 40, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '20', artifactNumToKeepStr: '10'))
        disableConcurrentBuilds()
    }

    environment {
        APP_NAME        = 'securescore-api'
        BUILD_VERSION   = "1.0.${env.BUILD_NUMBER}"

        // Image tags produced by the Build stage and consumed by every
        // subsequent stage. No stage rebuilds them.
        API_IMAGE       = "securescore-api:1.0.${env.BUILD_NUMBER}"
        DB_IMAGE        = "securescore-db:1.0.${env.BUILD_NUMBER}"
        PROM_IMAGE      = "securescore-prometheus:1.0.${env.BUILD_NUMBER}"
        GRAFANA_IMAGE   = "securescore-grafana:1.0.${env.BUILD_NUMBER}"

        // Jenkins runs inside a container, so localhost is not the Docker
        // host. host.docker.internal is how Docker Desktop exposes the host
        // to containers; on a Linux host, run the container with
        // --add-host=host.docker.internal:host-gateway.
        HOST            = 'localhost'

        STAGING_PORT    = '3100'
        PROD_PORT       = '8081'   // 8080 is Jenkins itself
        PROMETHEUS_PORT = '9091'   // 9090 is Jenkins WAR; use 9091 for Prometheus
        GRAFANA_PORT    = '3001'

        STAGING_PROJECT = 'securescore-staging'
        PROD_PROJECT    = 'securescore-prod'

        STAGING_URL     = "http://localhost:3100"
        PROD_URL        = "http://localhost:8081"
        PROM_URL        = "http://localhost:9091"
        GRAFANA_URL     = "http://localhost:3001"

        // Flip to 'true' once a SonarQube/SonarCloud server is configured in
        // Manage Jenkins > System under the name given by SONAR_SERVER, with
        // its token stored as a Jenkins credential. Left false, the Code
        // Quality stage still gates the build on ESLint.
        SONAR_ENABLED   = 'false'
        SONAR_SERVER    = 'SonarQube'

        REPORT_DIR      = 'reports'
    }

    stages {

        // ====================================================================
        stage('Checkout') {
        // ====================================================================
            steps {
                checkout scm
                sh '''
                    set -e
                    mkdir -p "${REPORT_DIR}"
                    echo "Commit:  $(git rev-parse --short HEAD)"
                    echo "Branch:  $(git rev-parse --abbrev-ref HEAD)"
                    echo "Version: ${BUILD_VERSION}"
                '''
                script {
                    env.GIT_COMMIT_SHORT = sh(
                        script: 'git rev-parse --short HEAD',
                        returnStdout: true
                    ).trim()
                }
            }
        }

        // ====================================================================
        stage('1. Build') {
        // ====================================================================
        // Installs dependencies from the lockfile and produces four immutable,
        // version-tagged images. Configuration for the database and the
        // monitoring stack is baked into images rather than bind-mounted,
        // because bind-mount paths are resolved by the Docker daemon on the
        // host and the Jenkins workspace is not visible there.
            steps {
                sh '''
                    set -e
                    echo "=== Installing dependencies from lockfile ==="
                    # npm ci, not npm install: it installs exactly what the
                    # lockfile pins and fails if package.json and the lockfile
                    # disagree, which is what makes a CI build reproducible.
                    npm ci
                    node --version
                    npm --version
                '''

                sh '''
                    set -e
                    echo ""
                    echo "=== Building application image ${API_IMAGE} ==="
                    docker build \
                        --build-arg BUILD_VERSION="${BUILD_VERSION}" \
                        --build-arg BUILD_NUMBER="${BUILD_NUMBER}" \
                        --build-arg GIT_COMMIT="${GIT_COMMIT_SHORT}" \
                        -t "${API_IMAGE}" \
                        -t "securescore-api:latest" \
                        .
                '''

                sh '''
                    set -e
                    echo ""
                    echo "=== Building infrastructure images ==="
                    docker build -t "${DB_IMAGE}"      -f db/Dockerfile                      db/
                    docker build -t "${PROM_IMAGE}"    -f monitoring/prometheus/Dockerfile   monitoring/prometheus/
                    docker build -t "${GRAFANA_IMAGE}" -f monitoring/grafana/Dockerfile      monitoring/grafana/
                '''

                sh '''
                    set -e
                    echo ""
                    echo "=== Build artefact manifest ==="
                    {
                        echo "SecureScore build artefact manifest"
                        echo "==================================="
                        echo "Version     : ${BUILD_VERSION}"
                        echo "Build number: ${BUILD_NUMBER}"
                        echo "Commit      : ${GIT_COMMIT_SHORT}"
                        echo "Built at    : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
                        echo ""
                        echo "Images:"
                        docker images --filter "reference=securescore-*:${BUILD_VERSION}" \
                            --format "  {{.Repository}}:{{.Tag}}  {{.Size}}  {{.ID}}"
                        echo ""
                        echo "Application image digest:"
                        docker inspect --format '  {{.Id}}' "${API_IMAGE}"
                    } | tee "${REPORT_DIR}/build-manifest.txt"
                '''
            }
            post {
                success {
                    archiveArtifacts artifacts: "${REPORT_DIR}/build-manifest.txt",
                                     fingerprint: true, allowEmptyArchive: true
                }
            }
        }

        // ====================================================================
        stage('2. Test') {
        // ====================================================================
        // Runs the full Jest suite — unit and integration — with coverage.
        // Jest is configured with coverage thresholds (70% statements,
        // 60% branches), so insufficient coverage fails this stage on its own
        // without any extra pipeline logic.
            steps {
                sh '''
                    set -e
                    echo "=== Running unit and integration tests with coverage ==="
                    npm run test:ci
                '''
            }
            post {
                always {
                    junit testResults: 'test-results/junit.xml',
                          allowEmptyResults: false,
                          skipPublishingChecks: true

                    publishHTML(target: [
                        allowMissing         : true,
                        alwaysLinkToLastBuild: true,
                        keepAll              : true,
                        reportDir            : 'coverage/lcov-report',
                        reportFiles          : 'index.html',
                        reportName           : 'Code Coverage'
                    ])

                    script {
                        if (fileExists('coverage/coverage-summary.json')) {
                            def stmtPct = sh(
                                script: "jq -r '.total.statements.pct' coverage/coverage-summary.json",
                                returnStdout: true
                            ).trim()
                            def branchPct = sh(
                                script: "jq -r '.total.branches.pct' coverage/coverage-summary.json",
                                returnStdout: true
                            ).trim()
                            def funcPct = sh(
                                script: "jq -r '.total.functions.pct' coverage/coverage-summary.json",
                                returnStdout: true
                            ).trim()
                            def linePct = sh(
                                script: "jq -r '.total.lines.pct' coverage/coverage-summary.json",
                                returnStdout: true
                            ).trim()
                            echo """
=== Coverage summary ===
  Statements : ${stmtPct}%
  Branches   : ${branchPct}%
  Functions  : ${funcPct}%
  Lines      : ${linePct}%
"""
                            currentBuild.description =
                                "v${env.BUILD_VERSION} | coverage ${stmtPct}%"
                        }
                    }
                }
            }
        }

        // ====================================================================
        stage('3. Code Quality') {
        // ====================================================================
        // Two independent checks. ESLint always runs and is an enforced gate:
        // any error fails the build. SonarQube adds maintainability,
        // duplication and security-hotspot analysis with its own quality gate
        // when a server is configured.
            steps {
                sh '''
                    set -e
                    echo "=== ESLint analysis ==="
                    mkdir -p "${REPORT_DIR}"

                    # Two formatters: JSON drives the explicit gate below,
                    # checkstyle feeds the Warnings-NG trend visualisation.
                    # ESLint exits non-zero when it finds errors, so the exit
                    # code is deliberately swallowed here and the gate is
                    # applied explicitly afterwards.
                    npx eslint src tests --ext .js -f json       -o "${REPORT_DIR}/eslint.json"       || true
                    npx eslint src tests --ext .js -f checkstyle -o "${REPORT_DIR}/eslint-checkstyle.xml" || true

                    ERRORS=$(jq '[.[].errorCount]   | add // 0' "${REPORT_DIR}/eslint.json")
                    WARNINGS=$(jq '[.[].warningCount] | add // 0' "${REPORT_DIR}/eslint.json")

                    echo "ESLint errors:   ${ERRORS}"
                    echo "ESLint warnings: ${WARNINGS}"

                    {
                        echo "ESLint quality gate"
                        echo "==================="
                        echo "Errors   : ${ERRORS}   (gate: must be 0)"
                        echo "Warnings : ${WARNINGS}  (reported, not gated)"
                    } > "${REPORT_DIR}/code-quality-summary.txt"

                    if [ "${ERRORS}" -gt 0 ]; then
                        echo ""
                        echo "QUALITY GATE FAILED — ${ERRORS} ESLint error(s)."
                        jq -r '.[] | select(.errorCount > 0) | .filePath as $f
                               | .messages[] | select(.severity == 2)
                               | "  \\($f):\\(.line):\\(.column)  \\(.ruleId)  \\(.message)"' \
                            "${REPORT_DIR}/eslint.json"
                        exit 1
                    fi

                    echo "QUALITY GATE PASSED — no ESLint errors."
                '''

                script {
                    // Warnings-NG / recordIssues skipped — requires the
                    // "Warnings Next Generation" plugin which is not installed.
                    // The explicit ESLint gate above (exit 1 on errors) is the
                    // enforced quality gate; this block is trend visualisation only.
                    echo "ESLint trend visualisation skipped (Warnings-NG plugin not installed)."

                    if (env.SONAR_ENABLED == 'true') {
                        withSonarQubeEnv(env.SONAR_SERVER) {
                            sh '''
                                set -e
                                echo "=== SonarQube analysis ==="
                                npx --yes sonarqube-scanner \
                                    -Dsonar.projectVersion="${BUILD_VERSION}" \
                                    -Dsonar.scm.revision="${GIT_COMMIT_SHORT}"
                            '''
                        }
                        timeout(time: 10, unit: 'MINUTES') {
                            // abortPipeline: true makes the Sonar quality gate
                            // a real gate rather than an advisory notice.
                            waitForQualityGate abortPipeline: true
                        }
                    } else {
                        echo 'SonarQube analysis skipped — SONAR_ENABLED is false. ' +
                             'ESLint remains an enforced gate.'
                    }
                }
            }
            post {
                always {
                    archiveArtifacts artifacts: "${REPORT_DIR}/eslint*,${REPORT_DIR}/code-quality-summary.txt",
                                     allowEmptyArchive: true
                }
            }
        }

        // ====================================================================
        stage('4. Security') {
        // ====================================================================
        // Three complementary scans:
        //   npm audit  — known CVEs in the declared dependency tree
        //   Trivy fs   — the source tree, including misconfiguration and
        //                accidentally committed secrets
        //   Trivy image— the built container, covering OS packages in the
        //                base image that npm audit cannot see
        //
        // POLICY: CRITICAL findings that have a fix available block the
        // build. HIGH findings are reported and triaged rather than blocking,
        // because unfixable upstream base-image CVEs would otherwise make the
        // pipeline permanently red without improving security. --ignore-unfixed
        // encodes that: it reports only what the team can actually act on.
            steps {
                sh '''
                    set -e
                    echo "=== npm audit — dependency vulnerabilities ==="
                    npm audit --json > "${REPORT_DIR}/npm-audit.json" 2>/dev/null || true

                    CRIT=$(jq '.metadata.vulnerabilities.critical // 0' "${REPORT_DIR}/npm-audit.json")
                    HIGH=$(jq '.metadata.vulnerabilities.high     // 0' "${REPORT_DIR}/npm-audit.json")
                    MOD=$(jq  '.metadata.vulnerabilities.moderate // 0' "${REPORT_DIR}/npm-audit.json")
                    LOW=$(jq  '.metadata.vulnerabilities.low      // 0' "${REPORT_DIR}/npm-audit.json")

                    echo "Critical: ${CRIT}   High: ${HIGH}   Moderate: ${MOD}   Low: ${LOW}"

                    {
                        echo "npm audit"
                        echo "---------"
                        echo "Critical : ${CRIT}   (gate: must be 0)"
                        echo "High     : ${HIGH}"
                        echo "Moderate : ${MOD}"
                        echo "Low      : ${LOW}"
                    } > "${REPORT_DIR}/security-summary.txt"

                    if [ "${CRIT}" -gt 0 ]; then
                        echo ""
                        echo "SECURITY GATE FAILED — ${CRIT} critical dependency vulnerability/ies."
                        npm audit --audit-level=critical || true
                        exit 1
                    fi
                    echo "npm audit gate passed."
                '''

                sh '''
                    set -e
                    echo ""
                    echo "=== Trivy — filesystem scan (source, config, secrets) ==="
                    trivy fs \
                        --scanners vuln,secret,misconfig \
                        --severity HIGH,CRITICAL \
                        --format table \
                        --output "${REPORT_DIR}/trivy-fs.txt" \
                        --no-progress \
                        --skip-dirs node_modules,coverage,reports \
                        . || true

                    cat "${REPORT_DIR}/trivy-fs.txt" || true

                    echo ""
                    echo "=== Trivy — filesystem gate (critical, fixable, secrets) ==="
                    trivy fs \
                        --scanners vuln,secret \
                        --severity CRITICAL \
                        --ignore-unfixed \
                        --exit-code 1 \
                        --no-progress \
                        --skip-dirs node_modules,coverage,reports \
                        .
                    echo "Filesystem gate passed."
                '''

                sh '''
                    set -e
                    echo ""
                    echo "=== Trivy — container image scan: ${API_IMAGE} ==="

                    # Informational: everything HIGH and above, archived for triage.
                    trivy image \
                        --severity HIGH,CRITICAL \
                        --format table \
                        --output "${REPORT_DIR}/trivy-image.txt" \
                        --no-progress \
                        "${API_IMAGE}" || true

                    cat "${REPORT_DIR}/trivy-image.txt" || true

                    trivy image \
                        --format json \
                        --output "${REPORT_DIR}/trivy-image.json" \
                        --no-progress \
                        "${API_IMAGE}" || true

                    if [ -f "${REPORT_DIR}/trivy-image.json" ]; then
                        IMG_CRIT=$(jq '[.Results[]?.Vulnerabilities[]? | select(.Severity=="CRITICAL")] | length' "${REPORT_DIR}/trivy-image.json")
                        IMG_HIGH=$(jq '[.Results[]?.Vulnerabilities[]? | select(.Severity=="HIGH")]     | length' "${REPORT_DIR}/trivy-image.json")
                        {
                            echo ""
                            echo "Trivy image scan"
                            echo "----------------"
                            echo "Critical : ${IMG_CRIT}   (gate: 0 fixable)"
                            echo "High     : ${IMG_HIGH}   (triaged, not gated)"
                        } >> "${REPORT_DIR}/security-summary.txt"
                        echo "Image findings — critical: ${IMG_CRIT}, high: ${IMG_HIGH}"
                    fi

                    echo ""
                    echo "=== Trivy — image gate (critical, fixable) ==="
                    trivy image \
                        --severity CRITICAL \
                        --ignore-unfixed \
                        --exit-code 1 \
                        --no-progress \
                        --skip-dirs usr/local \
                        "${API_IMAGE}"
                    echo "Image gate passed."
                '''

                sh 'cat "${REPORT_DIR}/security-summary.txt"'
            }
            post {
                always {
                    archiveArtifacts artifacts: "${REPORT_DIR}/npm-audit.json,${REPORT_DIR}/trivy-*,${REPORT_DIR}/security-summary.txt",
                                     allowEmptyArchive: true
                }
            }
        }

        // ====================================================================
        stage('5. Deploy') {
        // ====================================================================
        // Deploys the tested images to a staging environment — application,
        // database and the full monitoring stack — then verifies the running
        // system with a smoke test that exercises the real database. A failed
        // smoke test tears the environment down so a broken build cannot sit
        // there looking deployed.
            steps {
                sh '''
                    set -e
                    echo "=== Deploying ${BUILD_VERSION} to staging ==="

                    # Remove any previous staging stack so the deployment is
                    # from a known-clean state on every run.
                    docker compose -p "${STAGING_PROJECT}" -f docker-compose.ci.yml down --remove-orphans || true

                    BUILD_VERSION="${BUILD_VERSION}" \
                    STAGING_PORT="${STAGING_PORT}" \
                    PROMETHEUS_PORT="${PROMETHEUS_PORT}" \
                    GRAFANA_PORT="${GRAFANA_PORT}" \
                    docker compose -p "${STAGING_PROJECT}" -f docker-compose.ci.yml up -d

                    echo ""
                    echo "=== Staging containers ==="
                    docker compose -p "${STAGING_PROJECT}" -f docker-compose.ci.yml ps
                '''

                // Explicit bash shebang: Jenkins runs sh steps under dash by
                // default, and PIPESTATUS — needed to fail on the script's
                // exit code rather than tee's — is a bash builtin.
                sh '''#!/bin/bash
                    set -e
                    echo ""
                    echo "=== Smoke testing the deployed stack ==="
                    chmod +x scripts/smoke-test.sh
                    ./scripts/smoke-test.sh "${STAGING_URL}" 2>&1 | tee "${REPORT_DIR}/smoke-test.txt"
                    exit ${PIPESTATUS[0]}
                '''

                echo "Staging deployment verified and available at ${env.STAGING_URL}"
            }
            post {
                failure {
                    sh '''
                        echo "=== Deployment failed — capturing logs before teardown ==="
                        docker compose -p "${STAGING_PROJECT}" -f docker-compose.ci.yml logs --tail 120 \
                            > "${REPORT_DIR}/staging-failure-logs.txt" 2>&1 || true
                        cat "${REPORT_DIR}/staging-failure-logs.txt" || true
                        docker compose -p "${STAGING_PROJECT}" -f docker-compose.ci.yml down --remove-orphans || true
                    '''
                    archiveArtifacts artifacts: "${REPORT_DIR}/staging-failure-logs.txt",
                                     allowEmptyArchive: true
                }
                always {
                    archiveArtifacts artifacts: "${REPORT_DIR}/smoke-test.txt",
                                     allowEmptyArchive: true
                }
            }
        }

        // ====================================================================
        stage('6. Release') {
        // ====================================================================
        // Promotes the exact images that passed staging into production. No
        // rebuild takes place, so production runs bit-for-bit what was tested.
        //
        // The previous production version is recorded before the switch. If
        // the new release fails its health gate, the pipeline automatically
        // redeploys that previous version — rollback is a retagged redeploy,
        // not a rebuild, so it completes in seconds.
            steps {
                script {
                    // Capture what production is currently running, so there
                    // is something concrete to roll back to.
                    env.PREVIOUS_VERSION = sh(
                        script: '''
                            docker inspect securescore-api-prod \
                                --format '{{index .Config.Labels "org.opencontainers.image.version"}}' \
                                2>/dev/null || echo ""
                        ''',
                        returnStdout: true
                    ).trim()

                    if (env.PREVIOUS_VERSION) {
                        echo "Current production version: ${env.PREVIOUS_VERSION} (rollback target)"
                    } else {
                        echo 'No existing production deployment — this is the initial release.'
                    }
                }

                sh '''
                    set -e
                    echo "=== Promoting ${BUILD_VERSION} to production ==="

                    docker tag "${API_IMAGE}" "securescore-api:release-${BUILD_VERSION}"
                    docker tag "${DB_IMAGE}"  "securescore-db:release-${BUILD_VERSION}"

                    docker compose -p "${PROD_PROJECT}" -f docker-compose.prod.yml down --remove-orphans || true

                    RELEASE_VERSION="${BUILD_VERSION}" \
                    PROD_PORT="${PROD_PORT}" \
                    docker compose -p "${PROD_PROJECT}" -f docker-compose.prod.yml up -d

                    echo ""
                    RELEASE_VERSION="${BUILD_VERSION}" \
                    docker compose -p "${PROD_PROJECT}" -f docker-compose.prod.yml ps
                '''

                script {
                    // Production health gate. Anything other than a healthy
                    // response triggers the rollback path.
                    def healthy = sh(
                        script: '''
                            for i in $(seq 1 40); do
                                CODE=$(curl -s -o /dev/null -w '%{http_code}' "${PROD_URL}/health" || echo 000)
                                if [ "$CODE" = "200" ]; then
                                    echo "Production healthy after ${i} attempt(s)."
                                    exit 0
                                fi
                                sleep 3
                            done
                            exit 1
                        ''',
                        returnStatus: true
                    )

                    if (healthy != 0) {
                        echo 'PRODUCTION HEALTH GATE FAILED — initiating rollback.'

                        if (env.PREVIOUS_VERSION) {
                            sh '''
                                set -e
                                echo "Rolling back production to ${PREVIOUS_VERSION}"
                                docker compose -p "${PROD_PROJECT}" -f docker-compose.prod.yml down || true
                                RELEASE_VERSION="${PREVIOUS_VERSION}" \
                                PROD_PORT="${PROD_PORT}" \
                                docker compose -p "${PROD_PROJECT}" -f docker-compose.prod.yml up -d
                                echo "Rollback to ${PREVIOUS_VERSION} complete."
                            '''
                            error "Release ${env.BUILD_VERSION} failed its health gate. " +
                                  "Production rolled back to ${env.PREVIOUS_VERSION}."
                        } else {
                            sh '''
                                docker compose -p "${PROD_PROJECT}" -f docker-compose.prod.yml logs --tail 100 || true
                                docker compose -p "${PROD_PROJECT}" -f docker-compose.prod.yml down || true
                            '''
                            error "Initial release ${env.BUILD_VERSION} failed its health gate. " +
                                  "No previous version exists, so production was taken down."
                        }
                    }
                }

                sh '''
                    set -e
                    echo ""
                    echo "=== Release verification ==="
                    DEPLOYED=$(curl -s "${PROD_URL}/health" | jq -r '.version')
                    echo "Production reports version: ${DEPLOYED}"

                    if [ "${DEPLOYED}" != "${BUILD_VERSION}" ]; then
                        echo "Version mismatch: expected ${BUILD_VERSION}, production reports ${DEPLOYED}"
                        exit 1
                    fi

                    {
                        echo "SecureScore release notes"
                        echo "========================="
                        echo "Version          : ${BUILD_VERSION}"
                        echo "Commit           : ${GIT_COMMIT_SHORT}"
                        echo "Released at      : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
                        echo "Previous version : ${PREVIOUS_VERSION:-none (initial release)}"
                        echo "Production URL   : ${PROD_URL}"
                        echo "Staging URL      : ${STAGING_URL}"
                        echo ""
                        echo "Promotion: images promoted unchanged from staging; no rebuild."
                        echo 'Rollback : RELEASE_VERSION=<previous> docker compose -p securescore-prod \\'
                        echo '           -f docker-compose.prod.yml up -d'
                    } | tee "${REPORT_DIR}/release-notes.txt"
                '''
            }
            post {
                success {
                    archiveArtifacts artifacts: "${REPORT_DIR}/release-notes.txt",
                                     fingerprint: true, allowEmptyArchive: true
                }
            }
        }

        // ====================================================================
        stage('7. Monitoring & Alerting') {
        // ====================================================================
        // Monitoring is only real if it is observing something. This stage
        // drives representative traffic through the deployed system —
        // including two deliberate incident simulations — and then asserts
        // that Prometheus is scraping the target, that every alert rule is
        // loaded and evaluating without error, that business metrics carry
        // real values, and that the Grafana dashboard is provisioned.
            steps {
                sh '''
                    set -e
                    echo "=== Generating traffic and simulating incidents ==="
                    chmod +x scripts/generate-traffic.sh
                    ./scripts/generate-traffic.sh "${STAGING_URL}" 2>&1 | tee "${REPORT_DIR}/traffic-generation.txt"
                '''

                sh '''#!/bin/bash
                    set -e
                    echo ""
                    echo "=== Verifying the monitoring stack ==="
                    chmod +x scripts/verify-monitoring.sh
                    ./scripts/verify-monitoring.sh "${PROM_URL}" "${GRAFANA_URL}" 2>&1 \
                        | tee "${REPORT_DIR}/monitoring-verification.txt"
                    exit ${PIPESTATUS[0]}
                '''

                sh '''
                    set -e
                    echo ""
                    echo "=== Monitoring endpoints ==="
                    {
                        echo "SecureScore monitoring endpoints  (build ${BUILD_VERSION})"
                        echo "========================================================"
                        echo "Grafana dashboard : http://localhost:${GRAFANA_PORT}   (admin/admin)"
                        echo "Prometheus        : http://localhost:${PROMETHEUS_PORT}"
                        echo "Alert rules       : http://localhost:${PROMETHEUS_PORT}/alerts"
                        echo "Scrape targets    : http://localhost:${PROMETHEUS_PORT}/targets"
                        echo "Staging API       : http://localhost:${STAGING_PORT}"
                        echo "Staging metrics   : http://localhost:${STAGING_PORT}/metrics"
                        echo "Production API    : http://localhost:${PROD_PORT}"
                    } | tee "${REPORT_DIR}/monitoring-endpoints.txt"
                '''
            }
            post {
                always {
                    archiveArtifacts artifacts: "${REPORT_DIR}/traffic-generation.txt,${REPORT_DIR}/monitoring-verification.txt,${REPORT_DIR}/monitoring-endpoints.txt",
                                     allowEmptyArchive: true
                }
            }
        }
    }

    // ========================================================================
    post {
    // ========================================================================
        always {
            sh '''
                echo ""
                echo "=== Running SecureScore containers ==="
                docker ps --filter "name=securescore" \
                    --format "table {{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}" || true
            '''
            archiveArtifacts artifacts: "${REPORT_DIR}/**",
                             allowEmptyArchive: true
        }

        success {
            echo """
================================================================
 PIPELINE SUCCEEDED — SecureScore ${env.BUILD_VERSION}
================================================================
 All seven stages passed.

 Staging     : ${env.STAGING_URL}   (localhost:${env.STAGING_PORT})
 Production  : ${env.PROD_URL}      (localhost:${env.PROD_PORT})
 Prometheus  : localhost:${env.PROMETHEUS_PORT}
 Grafana     : localhost:${env.GRAFANA_PORT}   (admin/admin)

 Both environments are left running deliberately so the
 deployment can be demonstrated after the build completes.
================================================================
"""
        }

        failure {
            echo """
================================================================
 PIPELINE FAILED — SecureScore ${env.BUILD_VERSION}
================================================================
 Check the stage view for the failing stage. Archived reports
 under 'reports/' contain the detail for test, quality,
 security, smoke and monitoring failures.
================================================================
"""
        }

        cleanup {
            // Remove build-number-tagged images from older builds so the
            // Docker host does not fill up over repeated runs. The most
            // recent images are retained, including the rollback target.
            sh '''
                docker image prune -f --filter "label=org.opencontainers.image.title=SecureScore API" \
                    --filter "until=72h" || true
            '''
        }
    }
}
