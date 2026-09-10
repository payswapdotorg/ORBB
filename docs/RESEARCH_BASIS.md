# Research Basis

This design intentionally builds on established interoperability, health-data, mobile-health, and secure-software principles rather than treating ORBB as a blank-slate tracker.

## Primary standards and platform references

- HL7 FHIR Observation: normalized clinical observations and their context.
- HL7 FHIR Provenance: authenticity, integrity, and traceability of resources.
- SMART App Launch: OAuth-based authorization and application access around FHIR systems.
- Apple HealthKit: permissioned central health repository; permissions can be changed outside the app and the app must tolerate limited/denied access.
- Android Health Connect: permissioned health-data interoperability layer on Android.
- Open mHealth: semantic interoperability for mobile health data.
- W3C Verifiable Credentials: selective disclosure/credential-based privacy patterns.

Apple's current HealthKit documentation emphasizes that users control read/write access by data type and that apps should request permissions in context rather than at launch. citeturn647822search1turn647822search2turn647822search4

## Research themes reflected in architecture

1. Digital biomarkers require careful validation, methodology, and reproducibility. Therefore every derived or device-generated measure carries method/version/validation metadata instead of being treated as ground truth.
2. Patient-generated health data creates workflow and interoperability problems when introduced without a clinician-oriented system. Therefore the clinic surface and FHIR boundary are first-class architectural concerns.
3. Remote monitoring and decentralized trials shift physical measurement into homes and community settings. Therefore CHWs, equipment access, scheduling, and quality control are part of the measurement plane rather than add-ons.
4. Digital adherence interventions can improve adherence but do not automatically improve outcomes. Therefore adherence mechanisms are explicit, consented, reversible, safety-gated policies rather than hidden coercion.
5. Privacy-preserving data access is valuable when a recipient needs an answer rather than the underlying record. Therefore ORBB supports predicate/filtered/derived access as distinct from raw disclosure.

## Infrastructure research

Current September 2026 provider references used for the free-tier architecture:

- Vercel Hobby: $0/month with automatic CI/CD, CDN, WAF/DDoS protections and usage limits. https://vercel.com/pricing
- Cloudflare R2: 10 GB-month, 1M Class A, 10M Class B requests, free egress on the current free tier. https://developers.cloudflare.com/r2/pricing/
- Cloudflare Workers: Free plan request/CPU allowances; Cloudflare Queues is available on the Workers Free plan with 10,000 operations/day and 24-hour retention. https://developers.cloudflare.com/workers/platform/pricing/ and https://developers.cloudflare.com/queues/platform/pricing/
- Neon Free: 100 projects, 100 CU-hours/project/month, 0.5 GB/project, scale-to-zero. https://neon.com/pricing
- Upstash Redis Free: $0/month, 256 MB, 10 GB bandwidth. https://upstash.com/pricing/redis
- Expo EAS Free: 15 Android and 15 iOS builds, one concurrency, store submission, 1K MAU updates. https://expo.dev/pricing
- PostHog: 1M Product Analytics events/month and 5K Session Replay recordings/month free tier. https://posthog.com/pricing
- GitHub Actions: standard runners free for public repositories. https://docs.github.com/en/billing/concepts/product-billing/github-actions
- Playwright: Chromium, WebKit, Firefox and emulated devices. https://playwright.dev/docs/browsers
- Maestro: React Native and Expo/EAS-compatible black-box mobile UI testing. https://docs.maestro.dev/platform-support/react-native
- OWASP ASVS 5.0.0: current application-security verification baseline. https://github.com/OWASP/ASVS/releases

## Important caveat

Free-tier suitability is a development/economics decision, not a regulatory certification. Before production use of protected health information, verify the applicable jurisdiction, contractual terms, data residency, breach obligations, business-associate/processor requirements, and whether each infrastructure vendor's selected plan provides the required compliance commitments. The architecture therefore keeps the provider layer replaceable and does not claim that the free-tier stack is itself a healthcare-regulated deployment.
