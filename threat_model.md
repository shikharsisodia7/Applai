# Threat Model

## Project Overview

Applai is a public React + Express application that lets a student upload a resume PDF, choose a major and university, and receive AI-generated alumni leads, outreach drafts, and mock interview feedback. The production stack is a Vite/React frontend in `artifacts/applai`, an Express 5 API in `artifacts/api-server`, and OpenAI-backed analysis helpers in `lib/integrations-openai-ai-server`; the checked-in database package is not currently part of the production request path.

Production assumption updates for future scans:
- Only production-reachable code should be scanned for findings.
- `artifacts/mockup-sandbox` is dev-only and should be ignored unless production reachability is demonstrated.
- Replit-managed TLS is assumed in production.

## Assets

- **Student resume contents** — uploaded PDFs can contain names, contact details, education history, work history, and other personal data. Exposure affects user privacy directly.
- **Derived analysis results** — extracted keywords, ranked alumni leads, generated outreach drafts, and interview transcripts/grades are sensitive user-specific outputs derived from the resume.
- **Provider-backed compute and search budget** — public requests trigger OpenAI chat, transcription, and grounded web-search calls. Abuse can convert directly into cost and service degradation.
- **Service availability** — the API keeps analyses and interview sessions in server memory. Resource exhaustion can affect all users.
- **Integration secrets** — OpenAI integration keys and base URLs held in environment variables must remain server-side only.

## Trust Boundaries

- **Browser to API** — all client inputs are untrusted, including uploaded PDFs, uploaded audio, route parameters, and form fields.
- **API to OpenAI / web search** — the server forwards resume-derived content, interview answers, and search instructions to third-party AI services and treats model output as semi-trusted.
- **API to in-memory state** — analysis IDs and lead IDs are the only selectors for retrieving cached results; this boundary currently has no user identity attached to it.
- **Frontend to external URLs** — the app renders third-party profile links, source links, and remote photo URLs returned by AI-generated lead data.
- **Production vs dev-only artifacts** — `artifacts/applai` and `artifacts/api-server` are production surfaces; `artifacts/mockup-sandbox` is dev-only by assumption.

## Scan Anchors

- Production API entry points: `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/routes/analyses.ts`
- Production web entry points: `artifacts/applai/src/main.tsx`, `artifacts/applai/src/App.tsx`, `artifacts/applai/src/pages/*`
- Highest-risk code area: `artifacts/api-server/src/routes/analyses.ts` because it handles file uploads, sensitive resume-derived data, in-memory object access, and every expensive LLM call
- Public surface: all API routes in `artifacts/api-server/src/routes/*` and both frontend routes (`/`, `/results/:analysisId`)
- Usually ignore as dev-only: `artifacts/mockup-sandbox/**`

## Threat Categories

### Spoofing

The production app has no authenticated user concept, so it cannot bind analyses or interview sessions to a verified identity. If the application continues to use opaque analysis IDs as the only access mechanism, those identifiers must be treated as bearer secrets and protected anywhere they are stored, displayed, logged, or shared.

### Tampering

Users can upload PDFs and audio files and can influence model prompts through resume text, majors, universities, and interview answers. The server must validate file types and sizes, constrain request bodies, and treat all model output as untrusted data before returning it to the browser.

### Information Disclosure

Resume text, extracted keywords, interview transcripts, and user-specific analysis results are sensitive even if the app has no accounts. The system must not expose one user’s analysis to another party through predictable selectors, insecure sharing patterns, logs, or browser-visible third-party requests.

### Denial of Service

Public endpoints trigger expensive PDF parsing, AI completions, speech transcription, and grounded web search. The production system must enforce abuse controls such as rate limits, quotas, and bounded retention so unauthenticated users cannot exhaust compute budget, memory, or provider quotas.

### Elevation of Privilege

Because there is no role model, the main privilege boundary is between a caller who owns a generated analysis and every other caller on the internet. The API must enforce that boundary server-side rather than assuming possession of a route parameter alone is sufficient authorization.
