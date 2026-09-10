# Deployment Architecture

## Environments

- `local`: Docker/Node-compatible development; synthetic health data only.
- `preview`: per-branch Vercel web + isolated Neon branch + test R2 namespace + test Upstash namespace.
- `staging`: stable Cloudflare Worker/API, Neon project/branch, R2 bucket, queue set, Expo development build.
- `production`: separate accounts/projects/buckets/keys; paid/regulatory-capable equivalents can be substituted without domain changes.

Never use production patient data in preview or staging.

## Provider map

| Concern | Default | Why | Replacement interface |
|---|---|---|---|
| Web | Vercel | preview deployments/CDN/edge | WebHost |
| API/edge | Cloudflare Workers | cheap edge, global routing | HttpRuntime |
| Async | Cloudflare Queues + Workers | durable retries, low-cost | EventBus/JobRunner |
| Object data | Cloudflare R2 | low-cost object storage, free egress | ObjectStore |
| Relational | Neon PostgreSQL | PostgreSQL, branching, scale-to-zero | SqlStore |
| Cache/rate limits | Upstash Redis | serverless Redis, free tier | Cache/RateLimiter |
| Auth | in-house Better Auth-compatible module backed by Postgres | control/privacy, portability | AuthProvider |
| Mobile | Expo/EAS | cross-platform builds and delivery | MobileBuildProvider |
| Product analytics | PostHog | generous free event allowance | AnalyticsProvider |
| Error monitoring | Sentry | developer-friendly free tier | ErrorReporter |
| Browser E2E | Playwright | multi-browser interface testing | WebE2E |
| Mobile E2E | Maestro | cross-platform black-box mobile tests | MobileE2E |

Expo's current free tier includes 15 Android and 15 iOS builds, store submission, 1K MAU updates, and one build concurrency; upgrade only when release volume requires it. citeturn900160search3

PostHog currently advertises a 1M product-analytics event/month free tier and 5,000 session recordings/month; recording of health surfaces must be disabled or aggressively redacted. citeturn338507search2

GitHub Actions standard runners are free for public repositories, which makes the public ORBB repository a useful CI substrate while private deployments can use the account's included quota. citeturn338507search3

## Network topology

```text
Internet
  |
Cloudflare DNS / WAF / Turnstile
  |
  +--> Vercel Web
  |
  +--> Cloudflare Worker API
           |
           +--> Neon (SQL)
           +--> Upstash (ephemeral)
           +--> R2 (objects)
           +--> Queue
                   |
                Worker consumers
                   |
             external adapters
```

## Secrets

Use platform secret stores in every environment. `.env.example` contains names and non-sensitive defaults only. Secret values are never logged, serialized into traces, embedded in mobile bundles, or committed.

## Health-data controls

- Separate PHI-bearing database credentials from analytics keys.
- Separate object buckets for dev/staging/prod.
- Data retention classes are explicit.
- Backups are encrypted and access-controlled.
- Production deletion is a workflow, not a row delete from a random handler.
- Export jobs run asynchronously and issue expiring download tokens.
- Audit logs are append-only from application perspective.

## Deployment pipeline

PR:
`typecheck → lint → unit → contract → migration check → security scan → build → Playwright → dependency audit`.

Preview deploy:
`migration against isolated Neon branch → Worker preview → web preview → smoke suite`.

Main:
`all PR checks → merge → staging deploy → end-to-end dogfood → release approval`.

Production:
`approved release tag → database migration safety check → deploy web/API/workers → smoke tests → monitor → rollback/forward-fix decision`.

## Database migration safety

Use expand/contract migrations. No destructive migration in the same deployment as the code that depends on it. Every migration must be reversible or have a documented forward remediation.

## Scaling path

Stage 1: modular Worker + Neon + R2 + Queues.
Stage 2: split heavy processors (media, ML inference, FHIR imports, study exports) into dedicated workers/containers.
Stage 3: introduce region-specific data planes when residency/regulation requires it.
Stage 4: replace provider implementations with regulated/HIPAA-capable infrastructure where necessary.

Do not prematurely fragment the application into microservices.
