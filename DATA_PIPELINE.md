# Data Pipeline: Layered Multi-Provider Enrichment Strategy

## Overview

This platform uses a **layered data strategy** — multiple specialized providers stacked
together rather than relying on any single source. Each provider is best-in-class at one
thing. We combine them to get coverage and accuracy that no single provider can match.

## The Problem with Single-Provider Enrichment

Our v2 pipeline relied on **Ocean.io** for both company enrichment AND people/contact data,
with **Apollo.io** as a fallback for people search. This created several issues:

- **Coverage gaps** — Ocean.io alone hits ~70% coverage on company data, worse on contacts
- **Single point of failure** — if Ocean.io is down or rate-limited, the whole pipeline stalls
- **Stale data** — one source means no way to cross-validate freshness
- **Weak contact data** — Ocean.io's people search + Apollo fallback still missed emails
  for 30-50% of contacts, and email accuracy was ~80% at best

## The Layered Approach

Instead of replacing providers, we **stack** them. Each layer adds data the others miss.

```
┌─────────────────────────────────────────────────────────────────┐
│                     DISCOVERY LAYER                             │
│                                                                 │
│  Exa.ai ─── Semantic/neural web search for NL queries          │
│  Ocean.io ── Firmographic lookalike search from seed domains    │
│                                                                 │
│  These find the companies. No changes from v2.                  │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                  COMPANY ENRICHMENT LAYER                       │
│                                                                 │
│  Ocean.io ──────┐                                               │
│                 ├──► Merge best fields (prefer most recent)     │
│  Crustdata ─────┘                                               │
│                                                                 │
│  Ocean.io: industry, size, revenue, description, tech stack     │
│  Crustdata: 250+ datapoints, real-time signals, hiring velocity,│
│             funding data, growth metrics, social signals         │
│                                                                 │
│  Run in parallel via Promise.all — no added latency.            │
│  Merge strategy: prefer freshest timestamp per field.           │
│  Store both raw responses for auditability.                     │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                  CONTACT ENRICHMENT LAYER                       │
│                                                                 │
│  Cleanlist ── Waterfall enrichment across 50+ providers         │
│               Built-in triple email verification                │
│               95-98% email accuracy                             │
│                                                                 │
│  Replaces: Ocean.io people search + Apollo.io fallback          │
│  Why: two sources at ~80% accuracy < 50 sources at 95-98%      │
│                                                                 │
│  Filter for decision-makers: founders, owners, C-suite, VPs    │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                  PROFILING LAYER                                │
│                                                                 │
│  Firecrawl ── Scrape agency websites (homepage + key pages)     │
│  Claude ───── Analyze content, generate structured profile      │
│               (positioning, services, clients, red flags, etc.) │
│                                                                 │
│  No changes from v2. This layer is already solid.               │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                  SCORING + MESSAGING LAYER                      │
│                                                                 │
│  Internal scoring engine (no external API)                      │
│  Claude ── Personalized message generation (rapport + direct)   │
│                                                                 │
│  No changes from v2.                                            │
└─────────────────────────────────────────────────────────────────┘
```

## Provider Details

### Exa.ai — Semantic Discovery
- **What it does:** Neural web search. Takes natural language queries like "HubSpot
  agencies under 20 people" and finds matching companies via semantic understanding.
- **Why we use it:** Only provider that does true semantic search (not keyword matching).
  Finds agencies that don't show up in traditional firmographic databases.
- **API:** REST. `POST /search` and `POST /findSimilar`
- **Env var:** `EXA_API_KEY` (global)

### Ocean.io — Lookalike Discovery + Company Enrichment
- **What it does:** Two roles in our pipeline:
  1. **Discovery:** Given seed domains, finds firmographically similar companies
  2. **Enrichment:** Company data (industry, size, revenue, tech stack, locations)
- **Why we keep it:** The lookalike search is unique — no other provider does
  "find me 100 companies similar to these 4 seed domains" as well. We also keep
  it as one of two company enrichment sources for cross-validation.
- **API:** REST. `/v2/search/companies`, `/v2/enrich/company`, `/v2/search/people`
- **Note:** We no longer use Ocean.io for people search. Cleanlist replaced that.
- **Env var:** `OCEAN_IO_API_TOKEN` (global)

### Crustdata — Real-Time Company Intelligence
- **What it does:** Company enrichment with 250+ datapoints per company, refreshed
  in real-time. Includes growth signals that Ocean.io doesn't have: hiring velocity,
  funding events, headcount trends, social engagement metrics.
- **Why we added it:** Fills gaps in Ocean.io data and provides freshness timestamps
  so we can always prefer the most recently updated field. The Watcher API also
  enables future use cases like alerting when a target company hits a buying signal.
- **API:** REST, API-first design. SDKs, Postman collection, webhooks.
- **Docs:** https://docs.crustdata.com/
- **Key endpoints:**
  - `GET /api/v2/company/enrich` — company enrichment by domain
  - Watcher API — webhooks on company signal changes (future use)
- **Coverage:** 60M+ companies, 1B+ people profiles
- **Env var:** `CRUSTDATA_API_KEY` (global)
- **YC-backed**

### Cleanlist — Waterfall Contact Enrichment
- **What it does:** Cascades contact lookups through 50+ data providers in sequence
  until it finds the best available data. Built-in triple email verification.
- **Why we added it:** Our previous approach (Ocean.io people search → Apollo fallback)
  only hit two sources. Cleanlist hits 50+ and cross-validates. Email accuracy jumps
  from ~80% to 95-98%. Phone coverage nearly doubles.
- **How waterfall works:**
  ```
  Input: company domain
      → Provider 1 (e.g., Wiza): found 3 contacts, 2 with emails
      → Provider 2 (e.g., Findymail): found 1 more email for contact #3
      → Provider 3 (e.g., Lusha): found phone numbers for 2 contacts
      → Provider 4 (e.g., Prospeo): verified all emails (triple validation)
      → ...up to 50+ providers
      → Output: merged "golden record" per contact with best available data
  ```
- **API:** REST. API access included on all plans.
- **Pricing:** $599/mo enterprise (10K-50K credits). 1 credit = 1 email, 10 credits = 1 phone.
- **Env var:** `CLEANLIST_API_KEY` (global)

### Firecrawl — Website Scraping
- **What it does:** Scrapes agency websites and returns clean markdown content.
- **Why we use it:** Purpose-built for scraping with JS rendering, anti-bot handling,
  and structured output. More reliable than raw HTTP fetches.
- **Pages scraped per agency:** homepage, /about, /services, /work, /case-studies,
  /clients, /team
- **API:** REST. `POST /v1/scrape`
- **Env var:** `FIRECRAWL_API_KEY` (global)

### Anthropic Claude — AI Analysis
- **What it does:** Three specific jobs:
  1. **Query interpretation** — converts NL search queries to structured search strings
  2. **Agency profiling** — analyzes scraped website content into structured profile
     (positioning, services, industries, clients, case studies, partnerships,
     team info, red flags, acquisition notes)
  3. **Message generation** — creates personalized outreach messages (rapport + direct
     variants) using the agency profile and target contact info
- **Model:** claude-sonnet-4-20250514
- **API:** Anthropic SDK (`@anthropic-ai/sdk`)
- **Env var:** `ANTHROPIC_API_KEY` (global)

## Company Data Merge Strategy

When Ocean.io and Crustdata both return data for the same company, we merge them
into a single enriched record using these rules:

```typescript
function mergeCompanyData(ocean: OceanData | null, crust: CrustData | null): MergedCompanyData {
  // If only one source returned data, use it
  if (!ocean) return fromCrust(crust);
  if (!crust) return fromOcean(ocean);

  return {
    // Prefer the source with the more recent update timestamp
    companyName:    preferFresher(ocean.name, crust.name, ocean.updatedAt, crust.updatedAt),
    employeeCount:  preferFresher(ocean.employeeCount, crust.employeeCount, ...),
    revenue:        preferFresher(ocean.revenue, crust.revenue, ...),
    foundedYear:    preferFresher(ocean.foundedYear, crust.foundedYear, ...),
    location:       preferFresher(ocean.location, crust.location, ...),
    linkedinUrl:    preferFresher(ocean.linkedinUrl, crust.linkedinUrl, ...),

    // For arrays, union and deduplicate
    technologies:   dedup([...(ocean.technologies || []), ...(crust.technologies || [])]),
    industries:     dedup([...(ocean.industries || []), ...(crust.industries || [])]),

    // Crustdata-exclusive signals (Ocean.io doesn't have these)
    hiringVelocity: crust.hiringVelocity,
    fundingData:    crust.fundingData,
    growthMetrics:  crust.growthMetrics,

    // Store both raw responses
    rawOcean: ocean,
    rawCrust: crust,
  };
}
```

**Why "prefer fresher"?** B2B data decays at ~2.1% per month. A company that was 15
employees when Ocean.io last checked may be 22 now per Crustdata's real-time data.
The most recently updated value is almost always more accurate.

## Trigger.dev Task Architecture

All per-agency processing runs as parallel subtasks to avoid timeout issues.

```
run-agency-sourcer (orchestrator, max 3600s)
    │
    ├── Step 1: Discover (Exa + Ocean.io lookalikes)
    ├── Step 2: Deduplicate
    ├── Step 3: Save to Supabase
    │
    └── Step 4: batchTriggerAndWait(agencies)
                    │
                    ├── process-agency (max 300s, concurrency: 10)
                    │   ├── A. Company enrichment: Ocean.io ∥ Crustdata → merge
                    │   ├── B. Contact enrichment: Cleanlist waterfall
                    │   ├── C. Website profiling: Firecrawl → Claude
                    │   ├── D. Scoring (internal)
                    │   └── E. Message generation (Claude, qualified only)
                    │
                    ├── process-agency ...
                    ├── process-agency ...
                    └── (up to 10 running simultaneously)
```

Each subtask gets 5 minutes and 2 retries. A single agency failure doesn't affect
the rest of the batch. The orchestrator collects results and updates final counts.

## Cost Structure

| Provider | Pricing Model | Estimated Cost per Agency |
|----------|--------------|--------------------------|
| Exa.ai | Per search | ~$0.01 (discovery, amortized) |
| Ocean.io | Per API call | ~$0.05 (lookalike + enrichment) |
| Crustdata | Consumption-based | ~$0.02-0.05 (enrichment) |
| Cleanlist | Credit-based ($599/mo for 50K credits) | ~$0.10-0.15 (contacts + verification) |
| Firecrawl | Per scrape | ~$0.05-0.10 (multi-page) |
| Anthropic | Per token | ~$0.02-0.05 (profile + messages) |
| **Total** | | **~$0.25-0.40 per agency** |

At 100 agencies per search, that's roughly $25-40 per search run in API costs.

## Services We Evaluated but Did Not Choose

| Service | What It Does | Why We Passed |
|---------|-------------|---------------|
| **SmartLead** | Cold email at scale | Shared infrastructure, built for volume not deliverability |
| **Instantly** | Cold email + lead sourcing | Shared IPs, 30-40% deliverability drops reported |
| **ZoomInfo** | Enterprise contact database | Expensive ($15K+/yr), overkill for our volume |
| **Cognism** | EMEA-focused B2B data | We're targeting US agencies primarily |
| **People Data Labs** | Raw data API (3B+ profiles) | Great for building custom products, but Cleanlist's waterfall approach gets better results with less code |
| **Apollo.io** | Contact database + sequences | Kept as legacy fallback in v2 but replaced by Cleanlist in v3 — single-source ~80% accuracy can't compete with 50-source waterfall at 95-98% |
| **Clay** | Workflow-based waterfall enrichment | Powerful but expensive ($495+/mo) and requires manual workflow setup. Cleanlist does waterfall automatically at lower cost. We had a legacy Clay integration in v2 that we deprecated. |

## Future Considerations

- **Crustdata Watcher API** — Set up webhooks to monitor target companies for buying
  signals (leadership changes, hiring spikes, funding rounds). Could trigger
  re-enrichment or priority outreach automatically.
- **Cleanlist phone credits** — At 10 credits per phone number, phone data is 10x
  the cost of email. Only pull phone numbers for high-fit agencies that have been
  approved for outreach, not during initial enrichment.
- **Provider health monitoring** — Track enrichment hit rates per provider over time.
  If Crustdata starts returning nulls for a field that Ocean.io covers well, adjust
  the merge strategy dynamically.
