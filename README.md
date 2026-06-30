# Community Hero

**A civic issue-reporting and resolution platform that uses AI to help communities report, verify, escalate, and resolve local problems — with transparency and accountability built in.**

Built for the BlockseBlock Hackathon (Problem Statement 2: Community Hero — Hyperlocal Problem Solver).

🔗 **Live App:** https://community-hero-54733550535.us-west1.run.app/
📦 **Repository:** https://github.com/avaneeshmenon/community-hero

---

## Table of Contents
- [The Problem](#the-problem)
- [Our Solution](#our-solution)
- [The End-to-End Flow](#the-end-to-end-flow)
- [Key Features](#key-features)
- [How the AI Works](#how-the-ai-works)
- [Tech Stack](#tech-stack)
- [Google Technologies Used](#google-technologies-used)
- [Architecture](#architecture)
- [Data Model](#data-model)
- [Engineering Decisions & Trade-offs](#engineering-decisions--trade-offs)
- [Local Setup](#local-setup)
- [Deployment](#deployment)

---

## The Problem

Communities everywhere face the same recurring civic issues — potholes, water leakages, broken streetlights, uncollected waste, exposed wiring, open manholes. The problem isn't a lack of issues to report; it's that **reporting is fragmented, opaque, and rarely leads to resolution.**

A citizen who spots a hazard today has poor options: a phone call that goes unlogged, a complaint portal that never updates, or a social media post that authorities never see. There's no shared record, no way for neighbours to confirm an issue is real, no transparency into whether anyone is acting on it, and no accountability when nothing happens. Issues get reported ten times or zero times, and either way they fall through the cracks.

**Community Hero closes that loop** — from the moment a citizen photographs a problem to the moment it's verified, formally escalated to the right authority, and confirmed fixed.

---

## Our Solution

Community Hero is a community-driven civic platform where citizens **report, validate, track, and resolve** local issues through collaboration and intelligent automation. It combines a familiar, engaging community feed (Reddit-style verification and discussion) with a powerful AI layer that does the heavy lifting — categorizing issues, drafting formal complaints, routing them to the correct municipal department, and escalating them up the government hierarchy when they go unaddressed.

The core insight: **the community decides what's real, and AI handles the bureaucracy.** Citizens verify each other's reports through upvotes; once an issue crosses a verification threshold, an AI agent autonomously drafts a formal complaint to the responsible department. If the issue stays unresolved, the platform escalates it — Local Authority, then Ward Office, then Municipal Commissioner — generating a progressively firmer formal notice at each stage.

This transforms civic reporting from a shout into the void to a **transparent, accountable, AI-assisted escalation pipeline.**

---

## The End-to-End Flow

1. **Report** — A citizen photographs an issue. Gemini Vision analyzes the image and automatically fills in the category, sub-category, severity, a clear title, a structured description, an urgency score, and a risk assessment. The citizen just confirms and posts.
2. **Deduplicate** — Before the report is filed, the system checks for nearby existing reports of the same type (geo + AI image comparison) and offers to verify the existing one instead, preventing clutter.
3. **Verify** — The report appears in the community feed. Neighbours upvote to verify it's real. The upvote *is* the verification — reputation-weighted so trusted contributors carry more weight.
4. **Promote** — At 3 community verifications, the issue is automatically promoted from *Reported* to *Verified*.
5. **Escalate (AI Agent)** — On reaching *Verified*, an AI agent drafts a formal complaint, determines the responsible municipal department, and prepares it for dispatch with a unique reference ID. If unresolved over time, it escalates up the authority chain with new AI-drafted notices.
6. **Track** — The issue moves transparently through *Reported → Verified → In Progress → Resolved*, visible to everyone.
7. **Confirm the fix** — When resolved, any citizen can upload an "after" photo; Gemini compares before/after and marks it *Resolved · AI Verified* with a confidence score.
8. **Analyze** — A Civic Intelligence Dashboard surfaces aggregate trends, AI-generated insights, and recurring-issue projections grounded in the real data.

---

## Key Features

### Reporting & AI Intake
- **Photo-based reporting** with on-device camera capture and GPS auto-tagging.
- **AI Intelligent Intake** — a single Gemini Vision call returns category, sub-category, severity, title, description, an urgency score, a risk assessment, and a spam/validity check.
- **Two-level civic taxonomy** — eight departments (Roads, Water, Electricity, Waste, Safety, Animals, Environment, Public Facilities), each with specific sub-categories. The department doubles as the routing key for the complaint agent.
- **Multi-image uploads** (up to 5 photos) with a swipeable gallery and full-screen lightbox.
- **AI Duplicate Detection** — geo + image comparison against nearby reports to prevent the same issue being logged repeatedly; offers to verify the existing report instead.

### Community Verification & Trust
- **Upvote-as-verification** — verifying a report means confirming it's real; the vote count is the verification count.
- **Reputation-weighted verification** via Impact Points, so verifications aren't easily gamed.
- **Threshold-based flagging** — a single flag does nothing punitive; an issue only goes *Under Community Review* at 3 independent flags, and a verified issue can never be suppressed by flags. Flagged posts stay visible and rescuable by community verification.

### The AI Complaint & Escalation Agent (core differentiator)
- **Autonomous complaint drafting** — on reaching Verified, an agent drafts a formal, government-appropriate complaint letter.
- **Department routing** — the agent maps the issue to the correct municipal authority and addresses the complaint accordingly.
- **Unified Authority Escalation Trail** — one escalating ladder of formal letters: Initial Complaint (Department) → Level 1 (Local Authority) → Level 2 (Ward Office) → Level 3 (Municipal Commissioner). Each letter is addressed to a progressively higher authority, references all prior letters and the time unresolved, and adopts a firmer tone.
- **Reference IDs, Copy / Download / Mark-as-Dispatched** actions, and full transparency (clearly labelled AI-drafted).

### Transparency & Tracking
- **Status lifecycle** — *Reported → Verified → In Progress → Resolved*, with a clear distinction between community-driven promotion (to Verified) and authority-side progression.
- **Interactive map** — all reports plotted as status-colour-coded pins, with clustering, filters, popup mini-cards, and a draggable pin-picker in the composer.
- **AI Resolution Verification** — before/after photo comparison via Gemini, producing a *Resolved · AI Verified* badge with a confidence score.

### Engagement & Recognition
- **Impact Points** — a reputation system rewarding genuine impact (reports verified, issues resolved, accurate verifications), not raw volume.
- **Civic tiers** — Citizen → Volunteer → Community Guardian → Civic Champion → Community Hero.
- **~70 achievement badges** spanning reporting, resolution, department specialisation, verification, escalation, engagement, streaks, hyperlocal contribution, and rare milestones — visible on every user profile.
- **Notification centre** — real-time alerts for everything happening to a user's reports (verified, complaint generated, escalated, resolved, commented, flagged, rescued) plus badge and tier achievements.
- **Threaded comments & replies** for community discussion on each issue.

### Intelligence
- **Civic Intelligence Dashboard** — exact computed statistics (totals, resolution rate, breakdowns by department/locality/severity) plus AI-generated insights that interpret *only the real aggregates*, and grounded recurring-issue projections. No fabricated figures.

---

## How the AI Works

Every AI capability in Community Hero runs on **Gemini**, called server-side so the API key is never exposed to the browser. Four distinct AI workflows:

1. **Intelligent Intake** (Gemini Vision) — multimodal analysis of the reported photo returning a strict JSON object (department, sub-category, severity, title, description, priority score, risk assessment, validity check).
2. **Duplicate Detection** (Gemini Vision) — compares a new report's image and description against nearby candidates to decide if they depict the same physical issue.
3. **Complaint & Escalation Agent** (Gemini) — an agentic pipeline that reasons about the responsible authority, drafts a formal letter tailored to each escalation stage, and produces structured output.
4. **Resolution Verification** (Gemini Vision) — compares before/after photos and returns a resolution judgement with a confidence score.

**Reliability engineering:** every Gemini call is wrapped in a resilient pattern — automatic retries with exponential backoff on transient errors (503/429/500), automatic model fallback (`gemini-2.5-flash` → `gemini-2.5-flash-lite`), JSON-mode structured output, markdown-fence stripping, and a graceful text-fallback so a parsing failure degrades to a usable result rather than an error.

**Integrity principle:** the AI never fabricates precise figures. Estimates are clearly labelled "AI estimate," priority is explicitly scoped to "how it looks in the photo," and dashboard insights interpret only real computed aggregates. This honesty is a deliberate trust signal.

---

## Tech Stack

**Frontend**
- React (SPA)
- Vite (build tool)
- Tailwind CSS (styling)
- lucide-react (icons)
- React Router (client-side routing, deep-linkable report/profile/map/dashboard routes)

**Mapping**
- Leaflet + react-leaflet (interactive map)
- OpenStreetMap (map tiles)
- leaflet.markercluster (clustering)
- OpenStreetMap Nominatim (reverse geocoding → neighbourhood-level localities)

**Backend / Data**
- Firebase Authentication (Google sign-in)
- Cloud Firestore (all application data, real-time via onSnapshot)
- Client-side image compression + base64 storage in Firestore (no external blob storage required)

**AI**
- Google Gemini 2.5 Flash (primary multimodal model)
- Google Gemini 2.5 Flash-Lite (fallback model)
- Gemini structured (JSON) output mode

**Build & Deploy**
- Google AI Studio (Build mode — full-stack app generation, server-side runtime for Gemini calls)
- Google Cloud Run (deployment)

---

## Google Technologies Used

Community Hero is built end-to-end on Google's stack:

| Technology | Role in the project |
|---|---|
| **Google AI Studio** | Core build-and-deploy environment; generated the full-stack app and hosts the server-side runtime that makes Gemini calls with the managed API key. |
| **Google Gemini 2.5 Flash** | Multimodal vision + reasoning powering all four AI workflows: intelligent intake, duplicate detection, the complaint/escalation agent, and resolution verification. |
| **Google Gemini 2.5 Flash-Lite** | Automatic fallback model for resilience under load. |
| **Firebase Authentication** | Google sign-in and user identity. |
| **Cloud Firestore** | Real-time database for reports, users, verifications, comments, complaints, escalations, notifications, and badges. |
| **Google Cloud Run** | Serverless hosting of the deployed, publicly accessible application. |

This integrated Google-first architecture means AI, auth, data, and hosting all live within one ecosystem, provisioned and deployed through Google AI Studio.

---

## Architecture

```
                    ┌─────────────────────────────┐
                    │   React + Vite SPA (client)  │
                    │  Tailwind · lucide · Router   │
                    │  Leaflet/OSM map · galleries  │
                    └──────────────┬───────────────┘
                                   │
              ┌────────────────────┼─────────────────────┐
              │                    │                      │
      ┌───────▼────────┐  ┌────────▼─────────┐  ┌─────────▼─────────┐
      │ Firebase Auth  │  │  Cloud Firestore  │  │  Server runtime   │
      │ (Google sign-in)│  │ (real-time data,  │  │ (AI Studio) calls │
      │                │  │  base64 images)   │  │  Gemini securely  │
      └────────────────┘  └───────────────────┘  └─────────┬─────────┘
                                                            │
                                              ┌─────────────▼─────────────┐
                                              │  Google Gemini 2.5 Flash   │
                                              │  (+ Flash-Lite fallback)   │
                                              │  intake · dedup · agent ·  │
                                              │  resolution verification   │
                                              └────────────────────────────┘

      Reverse geocoding → OpenStreetMap Nominatim
      Deployed on → Google Cloud Run
```

**Key architectural points:**
- All Gemini calls execute **server-side** within the AI Studio runtime; the API key is never shipped to the client.
- Firestore is the **single source of truth** and drives real-time UI via `onSnapshot` listeners — the live deployed site and the development preview read/write the same database.
- The app is a **single-page application** with SPA routing fallback so deep links (`/report/{id}`, `/user/{uid}`, `/map`, `/dashboard`) resolve correctly on direct load.

---

## Data Model

Core Firestore collections (simplified):

- **`reports/{id}`** — title, description, department, subcategory, severity, status, lat/lng, locality, reporter info, verificationCount, commentCount, flagCount, AI fields (priorityScore, risks, validity), escalation/complaint trail.
- **`reports/{id}/verifications/{uid}`** — one doc per verifying user (existence = a verification).
- **`reports/{id}/comments/{autoId}`** — threaded comments and replies.
- **`reports/{id}/flags/{uid}`** — one flag per user, threshold-based review.
- **`reports/{id}/images/{autoId}`** & **`reportImages/{id}`** — compressed base64 image data, stored separately from the main doc to keep feed queries fast.
- **`reports/{id}/afterImages/{autoId}`** — resolution proof photos.
- **`reports/{id}/authorityActions`** — the unified complaint + escalation trail (stages 0–3).
- **`users/{uid}`** — displayName, photoURL, impactPoints, level, counts, earnedBadges, joinedAt.
- **`notifications/{uid}/items/{autoId}`** — per-user notification feed.

---

## Engineering Decisions & Trade-offs

We made several deliberate engineering choices to keep the platform **free, accessible, and reliable** — fitting for a civic product meant for communities:

- **Image storage via client-side compression + base64 in Firestore**, rather than Firebase Storage. Firebase Storage now requires a billing plan; we instead resize images in-browser (longest side ~1280px, JPEG quality ~0.65) and store them as base64, keeping image data under Firestore's 1 MB document limit and stored separately from report metadata for fast feed queries. This keeps the entire platform on the free tier with no loss of functionality.
- **Leaflet + OpenStreetMap for mapping**, rather than Google Maps Platform. This keeps mapping key-free and billing-free while still delivering pins, clustering, filtering, and a draggable pin-picker. Reverse geocoding uses OpenStreetMap Nominatim, called sparingly and cached to respect rate limits.
- **Resilient Gemini calls everywhere** — retries, model fallback, and graceful degradation so transient model overload never breaks a user flow or a live demo.
- **AI honesty over fake precision** — the AI never invents population figures or statistics; estimates are labelled, and dashboard insights interpret only real computed aggregates. Data integrity is a visible trust signal.
- **One escalation ladder, not two systems** — the complaint and escalation were unified into a single Authority Escalation Trail to avoid redundancy and present one coherent accountability story.

---

## Local Setup

> The application is built and deployed via Google AI Studio. To run a local copy of the exported source:

1. **Clone the repository**
   ```bash
   git clone https://github.com/avaneeshmenon/community-hero.git
   cd community-hero
   ```
2. **Install dependencies**
   ```bash
   npm install
   ```
3. **Configure environment** — create a `.env` (or use the AI Studio Secrets panel) with your Firebase config and Gemini API key:
   ```
   FIREBASE_API_KEY=...
   FIREBASE_PROJECT_ID=mythical-xray-sbwbv
   FIREBASE_AUTH_DOMAIN=...
   GEMINI_API_KEY=...        # used server-side only
   ```
4. **Run the dev server**
   ```bash
   npm run dev
   ```

> Note: Gemini calls run server-side; in production the key is managed by Google AI Studio and never exposed to the client.

---

## Deployment

The application is deployed to **Google Cloud Run** via Google AI Studio's one-click deploy. The live, publicly accessible URL is:

**https://community-hero-54733550535.us-west1.run.app/**

The deployment serves the built SPA with routing fallback so all deep links resolve, and runs the server-side functions that make secure Gemini API calls.

---

## Acknowledgements

Built for the **BlockseBlock Hackathon** under Problem Statement 2 (Community Hero — Hyperlocal Problem Solver), using Google AI Studio as the core build-and-deploy tool.
