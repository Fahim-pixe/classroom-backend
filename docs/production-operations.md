# Production Operations Guide

## Purpose and scope

This guide defines the operating model for the Classroom Management System backend. It applies to the Railway API service, Neon PostgreSQL database, Cloudinary document storage integration, and the Vercel frontend that proxies application requests through the protected `/api` namespace.

It complements application code. It does not replace access-control review, database backup controls, or platform-specific security settings.

## Security boundary

> All classroom application routers are protected by session authentication at the backend mount point. Better Auth remains responsible for authentication and session issuance; application routers enforce authorization and class-level access inside their own handlers.

The publicly reachable routes are intentionally limited to service liveness and Better Auth endpoints. Legacy root aliases, where retained for backward compatibility, receive the same authentication and rate-control middleware as their `/api` counterparts.

| Control | Implementation | Operational note |
|---|---|---|
| HTTP headers | Helmet middleware | Validate headers after every backend deployment. |
| CORS | Centralized allowed-origin policy | Keep production origins exact; do not use a wildcard with credentials. |
| Request size | Centralized JSON body limit | Document uploads use signed Cloudinary uploads rather than API payloads. |
| API rate control | In-memory bounded API limiter | Sufficient for a single instance; replace with a shared store before horizontal scaling. |
| Authentication rate control | Tighter path-specific limiter | Review limit events before changing thresholds. |
| Authorization | Protected router mounts plus role/class checks | Test each role after releases affecting routers or policies. |
| Database access | Parameterized Drizzle ORM queries | Use migrations for every schema and index change. |

## Release procedure

Deploy backend and frontend revisions as a coordinated release whenever API contracts, database migrations, request middleware, or frontend data-provider logic change.

1. Confirm the GitHub Actions quality workflows are green for both repositories.
2. Review the frontend build and performance-budget output.
3. In Railway, run pending migrations before serving code that depends on new tables, columns, or indexes.
4. Deploy the backend revision and verify the liveness endpoint, protected API response behavior, CORS response headers, and authentication session flow.
5. Deploy the Vercel frontend revision after the backend is healthy.
6. Run the production acceptance matrix below with administrator, teacher, and student accounts.
7. Record the deployment identifier, migration identifiers, elapsed deployment time, and any observed regressions in the release log.

### Required migration order

Apply migrations in numerical order. At the time of writing, production still requires the resource, assignment-attachment, and performance-index migrations where they have not already been applied.

| Migration | Purpose | Deployment impact |
|---|---|---|
| `0006_sad_sentry.sql` | Resource library, favorites, and view history | Required for the Resources feature. |
| `0007_cultured_bloodstorm.sql` | Assignment and submission attachment metadata | Required for uploaded assignment attachments. |
| `0008_vengeful_prowler.sql` | Composite indexes for paginated resources and attendance queries | Safe additive index migration; reduces high-volume query cost. |

Run the repository migration command through Railway using the deployed environment variables. Do not run destructive schema commands against production.

## Production acceptance matrix

| Area | Administrator | Teacher | Student |
|---|---|---|---|
| Authentication | Sign in, sign out, refresh session | Sign in, sign out, refresh session | Sign in, sign out, refresh session |
| Dashboard | Aggregated academic metrics and activity | Assigned classes, roster metrics, schedule | Today’s schedule and pending-work status |
| Academic records | Authorized record management | Authorized class grade access | Personal records only |
| Attendance | Authorized reporting | Authorized session creation and class progress | Personal history and progress only |
| Resources | Management and upload control | Class-scoped access | Enrolled-class access |
| Unauthorized request | No record disclosure | No record disclosure | No record disclosure |

## Observability and alerting plan

The current API exposes liveness behavior but does not yet include external metrics or distributed tracing. Configure platform monitoring immediately and introduce application-level observability in a separate change set.

| Signal | Initial target | Alert condition | Owner action |
|---|---|---|---|
| Availability | At least 99.9% monthly | Repeated failed health checks | Check Railway deploy and application logs. |
| Server error rate | Under 1% of API requests | Sustained 5xx increase | Inspect request IDs, deployment changes, and database status. |
| API latency | Establish route-specific p95 baseline | Route p95 exceeds baseline materially | Inspect query plan, payload size, and upstream latency. |
| Database latency | Establish Neon baseline | Sustained elevated query time | Inspect dashboard, connection use, and indexes. |
| Frontend Core Web Vitals | Monitor p75 LCP, INP, CLS | Regression after release | Compare Vercel analytics by deployment. |
| Rate-limit events | Near zero for normal users | Sudden increase or abuse pattern | Review IP and route distribution. |

Recommended next observability increment: structured request logging with a request ID propagated to responses, a production error tracker, and dashboard alerts for availability and 5xx rate. Do not log session tokens, passwords, file contents, or personally identifiable education records.

## Backup and recovery

1. Enable and verify Neon point-in-time recovery or the highest plan-appropriate backup retention.
2. Export and test a logical database restore on a non-production database at least quarterly.
3. Document Cloudinary retention and recovery policy separately from database recovery.
4. Keep a release manifest with Git commit IDs and migration IDs for every production deployment.
5. When data corruption is suspected, stop mutations first, preserve logs, determine the last known-good point, and restore only through an approved recovery exercise.

## Incident response

| Severity | Example | First response | Escalation |
|---|---|---|---|
| P0 | Confirmed unauthorized student-data disclosure | Restrict traffic or roll back, preserve evidence, rotate exposed credentials if applicable | Platform owner and security owner immediately |
| P1 | Sign-in unavailable, widespread API failure, migration failure | Roll back to last known-good revision, inspect service and database health | Engineering owner during incident |
| P2 | Single feature degraded, increased latency, non-critical upload issue | Mitigate or feature-limit, create tracked follow-up | Engineering owner in normal support window |

For a suspected disclosure, do not delete logs or run broad cleanup scripts. Capture the affected endpoint, timestamps, deployment ID, request correlation data, and scope of exposed records before remediation.

## Scaling and resilience roadmap

The deployed application is suitable for the current single-service model. Before increasing API replicas or introducing background tasks, complete the following in order:

1. Replace in-memory rate-limit state with a shared backing store.
2. Add structured logging, error tracking, and latency metrics.
3. Define idempotent job contracts and a durable queue before enabling background processing.
4. Add a shared cache only for measured, read-heavy access patterns with explicit invalidation rules.
5. Add load tests for class lists, resource search, attendance reports, and dashboard aggregations.
6. Establish database connection, query, and migration runbooks for higher traffic.

## Dependency management

Run production dependency audits in CI and review high-severity frontend findings separately when a safe direct remediation is unavailable. Do not apply a major-version security fix without build, test, and role-based acceptance validation.

A dependency is accepted for upgrade only when the lockfile diff is narrow, application checks pass, and the release owner confirms the change is compatible with the deployed runtime.
