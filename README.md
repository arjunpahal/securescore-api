# SecureScore API

**Automated Security Health Dashboard for Deakin Capstone Projects**

SecureScore connects to project repositories, scores their security posture
from 0–100 based on weighted vulnerability findings, raises alerts when a
project's health degrades, and exposes Prometheus metrics so the whole
system can be monitored in Grafana.

Built as the subject project for **SIT223/SIT753 Task 7.3HD — DevOps
Pipeline with Jenkins**.

| | |
|---|---|
| **Student** | Arjun Pahal |
| **Student ID** | s225634444 |
| **Unit** | SIT223 / SIT753 — Professional Practice in IT |
| **Capstone Company** | Hardhat Enterprises — AppAttack |

---

## Why this project

The pipeline task requires a project with genuine functional depth: testable
business logic, a real datastore, a deployable artefact, and metrics worth
monitoring. SecureScore provides all four:

- **Testable logic** — the scoring engine is a pure function with 40+ unit tests
- **Real datastore** — PostgreSQL with a five-table relational schema
- **Deployable artefact** — multi-stage Docker image, non-root, health-checked
- **Meaningful metrics** — business metrics (health scores, vulnerability
  counts) alongside standard RED metrics

---

## Architecture

```
┌──────────────┐     ┌─────────────────────────────────┐     ┌──────────────┐
│              │     │        SecureScore API          │     │              │
│  API Client  │────▶│                                 │────▶│  PostgreSQL  │
│              │     │  routes → controllers →         │     │              │
└──────────────┘     │  services → models              │     └──────────────┘
                     │                                 │
                     │  ┌───────────────────────────┐  │
                     │  │  Scoring Engine (pure)    │  │
                     │  │  findings → score 0–100   │  │
                     │  └───────────────────────────┘  │
                     └────────────┬────────────────────┘
                                  │ /metrics
                                  ▼
                        ┌──────────────────┐     ┌──────────┐
                        │   Prometheus     │────▶│ Grafana  │
                        │  + alert rules   │     │dashboard │
                        └──────────────────┘     └──────────┘
```

---

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 (Alpine) |
| Framework | Express 4 |
| Database | PostgreSQL 16 |
| Auth | JWT (jsonwebtoken) + bcrypt |
| Validation | express-validator |
| Testing | Jest + Supertest |
| Linting | ESLint |
| Code quality | SonarQube |
| Security scanning | npm audit + Trivy |
| Containers | Docker (multi-stage) + Docker Compose |
| Monitoring | Prometheus + Grafana |
| CI/CD | Jenkins declarative pipeline |

---

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Copy and edit environment config
cp .env.example .env

# 3. Start the full stack (API + database + monitoring)
docker compose up -d --build

# 4. Verify
curl http://localhost:3000/health
```

| Service | URL |
|---|---|
| API | http://localhost:3000 |
| Health | http://localhost:3000/health |
| Metrics | http://localhost:3000/metrics |
| Prometheus | http://localhost:9090 |
| Grafana | http://localhost:3001 (admin / admin) |

**Demo credentials:** `admin@deakin.edu.au` / `SecurePass2026`

---

## API reference

### Operational (no auth)

| Method | Path | Description |
|---|---|---|
| GET | `/` | Service descriptor |
| GET | `/health` | Liveness probe |
| GET | `/ready` | Readiness probe (checks database) |
| GET | `/metrics` | Prometheus scrape endpoint |

### Authentication

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/auth/register` | Create an account |
| POST | `/api/v1/auth/login` | Obtain a JWT |
| GET | `/api/v1/auth/me` | Current user identity |

### Projects

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/projects` | List projects (paginated) |
| GET | `/api/v1/projects/statistics` | Aggregate dashboard statistics |
| GET | `/api/v1/projects/:id` | Single project |
| GET | `/api/v1/projects/:id/score` | Current score + history |
| POST | `/api/v1/projects` | Create a project |
| PUT | `/api/v1/projects/:id` | Update a project |
| DELETE | `/api/v1/projects/:id` | Delete (admin/lead only) |

### Scans

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/scans` | Run a scan and persist the result |
| POST | `/api/v1/scans/preview` | Score findings without persisting |
| GET | `/api/v1/scans/:id` | Single scan with findings |
| GET | `/api/v1/scans/project/:projectId` | Scan history for a project |

### Alerts

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/alerts` | List alerts (filter by status) |
| POST | `/api/v1/alerts/:id/acknowledge` | Acknowledge an open alert |

---

## The scoring algorithm

A project starts at 100 and loses points for each finding, weighted by severity:

| Severity | Weight |
|---|---|
| Critical | 25 |
| High | 12 |
| Medium | 5 |
| Low | 1 |

An additional **staleness penalty** of 0.5 points per day since the last scan
(capped at 15) is applied, because an out-of-date scan gives false assurance.

```
score = clamp(0, 100, 100 − Σ(weight × count) − staleness_penalty)
```

| Score | Rating |
|---|---|
| 80–100 | HEALTHY |
| 60–79 | MODERATE |
| 40–59 | AT_RISK |
| 0–39 | CRITICAL |

An alert is raised when a project becomes CRITICAL, drops 20+ points in a
single scan, or stops being HEALTHY.

---

## Testing

```bash
npm test              # full suite with coverage
npm run test:unit     # unit tests only
npm run test:integration
npm run lint
```

**132 tests** across 7 suites; **81% statement coverage**. Jest is configured
with coverage thresholds that fail the build below 70% statements / 60%
branches, which acts as the first quality gate in the pipeline.

---

## Security controls

| Control | Implementation |
|---|---|
| Password storage | bcrypt, configurable cost factor |
| Session auth | JWT with issuer claim and expiry |
| SQL injection | Parameterised queries throughout, asserted in tests |
| Security headers | helmet (CSP, HSTS, nosniff, frame-deny) |
| Rate limiting | Global limit + stricter limit on auth endpoints |
| Payload limits | 256 kb body cap |
| Account enumeration | Identical error for unknown email and wrong password |
| Error leakage | Stack traces suppressed outside development |
| Container hardening | Non-root user, multi-stage build, minimal base image |
| Log redaction | Authorization headers and passwords redacted by pino |

---

## Repository layout

```
securescore-api/
├── src/
│   ├── config/          Configuration and database pool
│   ├── controllers/     HTTP request handlers
│   ├── middleware/      Auth, validation, metrics, error handling
│   ├── models/          Data access layer
│   ├── routes/          Route definitions and validators
│   ├── services/        Business logic (scoring, auth, scanning)
│   ├── utils/           Logger, errors, Prometheus metrics
│   ├── app.js           Express application factory
│   └── server.js        Process entry point
├── tests/
│   ├── unit/            Pure unit tests
│   └── integration/     HTTP-level tests
├── db/migrations/       Schema and seed SQL
├── monitoring/
│   ├── prometheus/      Scrape config and alert rules
│   └── grafana/         Datasource, provisioning, dashboard JSON
├── Dockerfile
├── docker-compose.yml       Staging environment
├── docker-compose.prod.yml  Production environment
├── Jenkinsfile              7-stage CI/CD pipeline
└── sonar-project.properties
```

---

## Licence

MIT — see LICENSE.
