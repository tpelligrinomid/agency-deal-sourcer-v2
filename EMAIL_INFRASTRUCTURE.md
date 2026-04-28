# Email Infrastructure: EmailBison Integration

## Overview

This platform uses **EmailBison** ($599/mo flat) as the email sending infrastructure for
one-to-one personalized outreach. EmailBison provides **dedicated IPs and isolated SMTP
servers per workspace**, meaning each client's sending reputation is completely independent.

This is NOT bulk email. Every email is a personalized, Claude-generated message sent to a
specific decision-maker at a qualified agency. Deliverability is the #1 priority.

## Why EmailBison (Not SmartLead/Instantly)

| Concern | SmartLead/Instantly | EmailBison |
|---------|-------------------|------------|
| Infrastructure | Shared IPs across all customers | Dedicated IPs per workspace |
| Reputation risk | Neighbor's bad behavior tanks your deliverability | Fully isolated — one client's burned IP doesn't affect others |
| Architecture | Built for volume blasting | Built for high-deliverability 1:1 outreach |
| API | Limited | API-first with real-time webhooks |
| Pricing | Per-seat, per-account fees add up | $599/mo flat — unlimited workspaces, users, leads |

## Multi-Tenant Architecture

Each client (organization) in the platform gets their own EmailBison workspace with
dedicated infrastructure. One EmailBison account ($599/mo) supports unlimited clients.

```
Your Platform
    │
    ├── Organization: "Acme Agency"
    │   └── EmailBison Workspace A
    │       ├── Dedicated IP(s)
    │       ├── Dedicated SMTP server
    │       └── Sends as: tristan@acmeagency.com
    │
    ├── Organization: "Beta Corp"
    │   └── EmailBison Workspace B
    │       ├── Dedicated IP(s)
    │       ├── Dedicated SMTP server
    │       └── Sends as: sarah@betacorp.com
    │
    └── Organization: "Gamma LLC"
        └── EmailBison Workspace C
            ├── Dedicated IP(s)
            ├── Dedicated SMTP server
            └── Sends as: mike@gammallc.com
```

**If Acme Agency burns their IP**, Beta Corp and Gamma LLC are completely unaffected.

## Data Model

```sql
-- Each organization stores their own EmailBison workspace credentials
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,

  -- EmailBison (per-client, isolated sending infrastructure)
  emailbison_workspace_id TEXT,
  emailbison_api_key TEXT,  -- encrypted at rest

  -- HeyReach (per-client, LinkedIn outreach)
  heyreach_api_key TEXT,    -- encrypted at rest
  heyreach_campaign_id TEXT,

  -- Global services use platform-level env vars, NOT per-client keys:
  --   CRUSTDATA_API_KEY, CLEANLIST_API_KEY, OCEAN_IO_API_TOKEN,
  --   EXA_API_KEY, FIRECRAWL_API_KEY, ANTHROPIC_API_KEY

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Email sends are tracked per agency-contact pair
CREATE TABLE email_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id),
  agency_id UUID REFERENCES agencies(id),
  contact_id UUID REFERENCES contacts(id),

  -- EmailBison tracking
  emailbison_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, sent, delivered, opened, replied, bounced

  -- Content
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  message_variant TEXT,  -- 'rapport' or 'direct'

  -- Timestamps from webhooks
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  bounced_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT now()
);
```

## Client Onboarding Flow

```
1. Create organization record in Supabase
2. Create EmailBison workspace via API
3. Store workspace_id + api_key on the organization record
4. Connect client's sending domain (DNS: SPF, DKIM, DMARC)
5. EmailBison auto-warms the dedicated IPs
6. Once warm-up complete → ready to send
```

## Integration with Trigger.dev Pipeline

Email sending happens AFTER the agency sourcing pipeline completes and the user
approves agencies for outreach. It is NOT part of the `run-agency-sourcer` or
`process-agency` tasks.

### Trigger: User clicks "Approve" on an agency

```
approve-agency (edge function)
    │
    ├── Update agency review_status → 'approved'
    │
    ├── Trigger: send-outreach (Trigger.dev task)
    │   │
    │   ├── Look up organization's EmailBison credentials
    │   │
    │   ├── Select best contact (founder > CEO > owner > C-suite)
    │   │
    │   ├── Select message variant (rapport or direct, from draft_messages)
    │   │
    │   ├── Send via EmailBison API:
    │   │   POST /api/v1/send
    │   │   Headers: { Authorization: Bearer <org_emailbison_api_key> }
    │   │   Body: {
    │   │     to: contact.email,
    │   │     from: client's configured sender,
    │   │     subject: personalized subject,
    │   │     body: Claude-generated message
    │   │   }
    │   │
    │   ├── Store emailbison_message_id in email_sends table
    │   │
    │   └── (Optional) Also trigger HeyReach LinkedIn sequence
    │
    └── Frontend updates via Supabase Realtime
```

### Webhook: EmailBison → Your Platform

EmailBison fires real-time webhooks on email events. Set up a Supabase edge function
to receive them:

```
EmailBison webhook → POST /functions/v1/emailbison-webhook
    │
    ├── Event: "delivered" → update email_sends.delivered_at
    ├── Event: "opened"    → update email_sends.opened_at
    ├── Event: "replied"   → update email_sends.replied_at, notify user
    ├── Event: "bounced"   → update email_sends.bounced_at, flag contact
    │
    └── All events update email_sends.status
```

## Coordinated Multi-Channel Outreach (Optional)

For maximum response rates, coordinate LinkedIn (HeyReach) and email (EmailBison)
in a single orchestrated sequence via Trigger.dev:

```
Day 0:  LinkedIn connection request (HeyReach) — blank, no message
Day 1:  Personalized email #1 (EmailBison) — rapport variant
Day 3:  If no reply → LinkedIn message (HeyReach) — personalized
Day 6:  If no reply → Email #2 (EmailBison) — direct variant
Day 10: If no reply → LinkedIn nudge (HeyReach) — podcast invite / soft close
Day 14: If no reply → Final email (EmailBison) — breakup message
```

This sequence lives in a Trigger.dev task (`run-outreach-sequence`) that uses
`wait.for({ seconds })` between steps and checks for replies before sending
the next touch.

## API Key Separation: Global vs Per-Client

| Service | Scope | Why |
|---------|-------|-----|
| EmailBison | **Per-client** (workspace API key) | Emails go out as the client — their domain, their reputation |
| HeyReach | **Per-client** (API key) | LinkedIn outreach is from the client's LinkedIn account |
| Crustdata | **Global** (platform env var) | Data enrichment — your cost, not client-facing |
| Cleanlist | **Global** (platform env var) | Contact enrichment — your cost, not client-facing |
| Ocean.io | **Global** (platform env var) | Discovery + enrichment — your cost |
| Exa.ai | **Global** (platform env var) | Discovery — your cost |
| Firecrawl | **Global** (platform env var) | Website scraping — your cost |
| Anthropic | **Global** (platform env var) | AI analysis + messages — your cost |
| Supabase | **Global** (platform env var) | Database — your infrastructure |

**Rule of thumb:** If it touches the prospect's inbox or social, it's per-client.
If it's data/intelligence behind the scenes, it's global.

## EmailBison Plan Details

- **Price:** $599/month flat
- **Emails:** 500,000/month (additional buckets available)
- **Workspaces:** Unlimited
- **Team members:** Unlimited
- **Leads storage:** Unlimited
- **Includes:** Dedicated IPs, email warm-up, bounce protection, API access
- **Compliance:** SOC 2 Type II, HIPAA, GDPR
- **Support:** Dedicated private Slack channel
