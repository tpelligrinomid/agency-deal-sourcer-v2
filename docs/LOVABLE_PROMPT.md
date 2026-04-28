# Lovable Project Prompt — Agency Deal Sourcer by Aragon Holdings

## Overview

Build a 3-page internal tool called **"Agency Deal Sourcer by Aragon Holdings"** for discovering, scoring, and managing agency acquisition prospects. The app connects to a Trigger.dev backend that handles prospect discovery (Exa.ai for natural language, Ocean.io for domain lookalikes), enrichment (Ocean.io + Apollo), website profiling (Firecrawl + Claude), scoring, and personalized message generation. The frontend submits searches, shows real-time progress, displays scored results with agency profiles, and lets the user review/approve prospects before pushing them to HeyReach for LinkedIn outreach.

**Key flow:** Automated research → Human review → Approve → HeyReach LinkedIn sequence → Connection accepted webhook → Pipedrive CRM entry

---

## Design System

Follow the Aragon Holdings design system exactly. This must match the existing Deal Room and Agency Profiles apps.

### Colors
- **Primary (green):** `hsl(92 91% 38%)` → `#58B50B`
- **Accent (orange):** `hsl(29 84% 57%)` → `#ED8C34`
- **Background:** `hsl(0 0% 93%)` → `#EDEDED`
- **Cards:** Pure white `hsl(0 0% 100%)`
- **Borders:** `hsl(0 0% 85%)` → `#D9D9D9`
- **Muted text:** `hsl(0 0% 40%)` → `#666666`
- **Destructive (red):** `hsl(0 84% 60%)` → `#F04438`

Apply the full light mode and dark mode CSS variable set from the design system document (provided below). Include sidebar-specific variables.

### Typography
- **Headings:** Playfair Display (serif) — `font-display`
- **Body:** Inter (sans-serif) — `font-sans`
- Import both from Google Fonts
- Apply `font-display` to all h1-h6 elements

### Layout
- Fixed left sidebar (256px / `w-64`) with white background
- Sidebar header: "Agency Deal Sourcer" with "by Aragon Holdings" subtitle in italic muted text
- Main content area: `ml-64 p-8 min-h-screen bg-background`
- Active nav: green left border + green text + white bg
- Inactive nav: muted text with hover state

### Components
Use shadcn/ui components: Button, Card, Badge, Input, Label, Dialog, Select, Tabs, Table, Skeleton, Separator, Toast (Sonner), Textarea, Tooltip, Progress. Follow the exact button variants, card structure, badge variants, and input styling from the design system.

### Status Badge Colors
- **Active/Success (green):** `bg-primary/10 text-primary`
- **Warning/Pending (orange):** `bg-accent/10 text-accent`
- **Error (red):** `bg-destructive/10 text-destructive`
- **Neutral:** `bg-muted text-muted-foreground`

### Icons
Lucide React. 16px inline (`h-4 w-4`), 20px for navigation (`h-5 w-5`).

---

## Supabase Database Schema

Run this SQL to create the 3 tables. Enable Realtime on all three.

```sql
CREATE TABLE IF NOT EXISTS searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_type TEXT NOT NULL CHECK (query_type IN ('natural_language', 'domain_lookalike')),
  query_text TEXT,
  seed_domains TEXT[],
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'discovering', 'enriching', 'profiling', 'scoring', 'complete', 'failed')),
  current_step TEXT,
  progress_pct INTEGER DEFAULT 0,
  error_message TEXT,
  total_discovered INTEGER DEFAULT 0,
  total_qualified INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prospects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id UUID NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  company_name TEXT,
  source TEXT CHECK (source IN ('exa_search', 'exa_similar', 'ocean_lookalike')),
  exa_title TEXT,
  exa_description TEXT,
  exa_highlights TEXT[],
  exa_score REAL,
  enrichment_status TEXT DEFAULT 'pending' CHECK (enrichment_status IN ('pending', 'enriching', 'complete', 'failed')),
  enrichment_data JSONB,
  description TEXT,
  industry TEXT,
  employee_count INTEGER,
  founded_year INTEGER,
  location TEXT,
  linkedin_url TEXT,
  technologies TEXT[],
  services TEXT[],
  revenue_estimate REAL,
  agency_profile JSONB,
  total_score REAL,
  fit_level TEXT CHECK (fit_level IN ('high', 'medium', 'low')),
  revenue_score REAL,
  team_size_score REAL,
  specialization_score REAL,
  founder_led_score REAL,
  b2b_focus_score REAL,
  scoring_signals TEXT[],
  draft_message TEXT,
  review_status TEXT DEFAULT 'pending_review' CHECK (review_status IN ('pending_review', 'approved', 'skipped')),
  pipedrive_org_id INTEGER,
  pipedrive_pushed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(domain, search_id)
);

CREATE INDEX IF NOT EXISTS idx_prospects_domain ON prospects(domain);
CREATE INDEX IF NOT EXISTS idx_prospects_search_id ON prospects(search_id);
CREATE INDEX IF NOT EXISTS idx_prospects_review_status ON prospects(review_status);
CREATE INDEX IF NOT EXISTS idx_prospects_fit_level ON prospects(fit_level);

CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  search_id UUID NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  title TEXT,
  email TEXT,
  phone TEXT,
  linkedin_url TEXT,
  is_founder BOOLEAN DEFAULT FALSE,
  is_ceo BOOLEAN DEFAULT FALSE,
  is_owner BOOLEAN DEFAULT FALSE,
  pipedrive_person_id INTEGER,
  pipedrive_label TEXT DEFAULT 'Cold Lead',
  pipedrive_pushed_at TIMESTAMPTZ,
  heyreach_lead_id TEXT,
  heyreach_campaign_id TEXT,
  heyreach_pushed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contacts_prospect_id ON contacts(prospect_id);
CREATE INDEX IF NOT EXISTS idx_contacts_search_id ON contacts(search_id);

ALTER PUBLICATION supabase_realtime ADD TABLE searches;
ALTER PUBLICATION supabase_realtime ADD TABLE prospects;
ALTER PUBLICATION supabase_realtime ADD TABLE contacts;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_searches_updated_at BEFORE UPDATE ON searches FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_prospects_updated_at BEFORE UPDATE ON prospects FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_contacts_updated_at BEFORE UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

---

## Pages (3 total)

### 1. Dashboard (`/`)

The main landing page showing recent searches.

**Components:**
- Page header: "Agency Deal Sourcer" h1 + "Discover, score, and manage agency acquisition prospects" subtitle + "New Search" primary button (top right)
- **Search cards** in a grid (`grid gap-6 md:grid-cols-2 lg:grid-cols-3`), each showing:
  - Query text (truncated) or "Domain Lookalike: {domains}"
  - Status badge (use status badge colors: pending=neutral, discovering/enriching/profiling/scoring=orange, complete=green, failed=red)
  - Progress bar (shows `progress_pct`, only visible when status is not complete/failed)
  - Stats row: "X discovered · Y qualified"
  - Timestamp: "Started {relative time}"
  - Click navigates to `/search/:id`
- **Empty state** when no searches: centered icon + "No searches yet" + "New Search" button
- Subscribe to Supabase Realtime on `searches` table for live status/progress updates

### 2. New Search (`/search/new`)

Form to submit a new search.

**Components:**
- Page header: "New Search" h1 + "Configure and launch a new prospect search" subtitle
- **Query type toggle** (Tabs component with 2 tabs):
  - **"Natural Language"** tab: single textarea, placeholder "Describe your ideal agency prospect... e.g. Small HubSpot agencies in the US with less than 15 employees that focus on B2B SaaS"
  - **"Domain Lookalike"** tab: input for comma-separated domains, placeholder "newnorth.com, impactplus.com, revenue.io"
- **Max results** number input (default 50, min 10, max 100)
- **Submit button**: "Launch Search" (primary, full width on mobile)
- On submit:
  1. Insert a row into `searches` table with `status: 'pending'`
  2. Call the `trigger-search` edge function with `{ searchId, queryType, queryText, seedDomains, maxResults }`
  3. Navigate to `/search/:id` to watch progress

### 3. Search Results (`/search/:id`)

**This is the most important page.** It's where the user reviews scored prospects, reads agency profiles, edits draft messages, and approves prospects for LinkedIn outreach. Every data field from the backend must be visible here.

---

#### Header Section

- **Back link**: "← All Searches" (navigates to `/`)
- **Title**: The search query text or "Agencies similar to {seedDomains}" for domain lookalikes
- **Status badge** + **progress bar** (animated, same colors as dashboard). Progress bar only shows when search is in progress.
- **Current step text** below progress bar (e.g. "Profiling agency websites..." or "Scoring prospects..."). This comes from `searches.current_step`.
- **Three stat cards** in a row:
  - **Discovered**: `total_discovered` count with Building icon
  - **Qualified**: `total_qualified` count (high + medium fit) with CheckCircle icon
  - **Approved**: count of prospects where `review_status = 'approved'` with UserCheck icon

---

#### Filter & Action Bar

Below the stats, above the prospect list:

- **Fit level filter** (Select): All / High Fit / Medium Fit / Low Fit — filters the prospect list by `fit_level`
- **Review status filter** (Select): All / Pending Review / Approved / Skipped — filters by `review_status`
- **Sort control** (Select): Score (High → Low) / Score (Low → High) / Company Name (A-Z)
- **"Approve All High Fit" button** (accent/orange color): Bulk-approves all prospects where `fit_level = 'high'` AND `review_status = 'pending_review'`. Shows confirmation dialog first with count.

---

#### Prospect List

Display prospects as **cards** (not a dense table). Each card is a self-contained unit showing the key info at a glance, with an expandable detail section.

**Default sort:** `total_score` descending (highest score first). Prospects with no score yet appear at the bottom.

**Each prospect card (collapsed view) shows:**

```
┌─────────────────────────────────────────────────────────────────────┐
│  [FitBadge] Company Name                    Score: 82/100    [▼]   │
│  domain.com · Industry · Location · Employees: 12                  │
│  "One-line positioning from agency profile..."                     │
│  [Service] [Service] [Service]            [Approve] [Skip]         │
└─────────────────────────────────────────────────────────────────────┘
```

Specifics:
- **Fit level badge** (left of company name): "HIGH FIT" green badge, "MEDIUM FIT" orange badge, "LOW FIT" gray badge. Don't show if `fit_level` is null (scoring hasn't run yet).
- **Company name**: Bold, large text. Use `company_name` field. If null, use `domain`.
- **Score**: Show as "82/100" with color: green text if >=75, orange text if >=50, red text if <50. If null, show "—" (scoring hasn't run yet).
- **Info row**: `domain` (as a link to https://{domain}, opens in new tab) · `industry` · `location` · "Employees: {employee_count}". Skip any null fields.
- **Positioning**: If `agency_profile` JSONB has a `positioning` field, show it as a single italic line (truncated to ~120 chars with "..."). This gives the user an instant read on what the agency does.
- **Service tags**: If `agency_profile` JSONB has a `services` array, show the first 4 as small badges/chips. If more than 4, show "+N more".
- **Action buttons** (right side): Only show for prospects where scoring is complete (`total_score` is not null):
  - If `review_status = 'pending_review'`: Show "Approve" (green primary button) + "Skip" (ghost button)
  - If `review_status = 'approved'`: Show green check icon + "Approved" text
  - If `review_status = 'skipped'`: Show "Skipped" muted text
- **Enrichment status indicator**: If `enrichment_status` is not 'complete', show a small spinner or "Enriching..." badge instead of the data fields. If 'failed', show a warning badge.

**Click to expand** the card to see the full detail view:

---

#### Expanded Prospect Detail

When a prospect card is expanded, show 4 sections below the summary row:

**Section 1: Agency Profile** (from `agency_profile` JSONB column)

The `agency_profile` column is a JSONB object with this structure:
```json
{
  "positioning": "string — one-line positioning statement",
  "services": ["array", "of", "service", "strings"],
  "industries": ["array", "of", "industry", "strings"],
  "clients": ["array", "of", "client", "names"],
  "caseStudies": ["array", "of", "case", "study", "descriptions"],
  "partnerships": ["array", "of", "partnership/certification", "strings"],
  "teamInfo": "string — team description",
  "redFlags": ["array", "of", "red", "flag", "strings"],
  "acquisitionNotes": "string — notes about acquisition fit",
  "scrapedAt": "ISO date string"
}
```

Display as:
- **Positioning** (full text, italic, prominent — this is the most important line)
- **Services** — show as green badge chips
- **Industries Served** — show as muted badge chips
- **Notable Clients** — bulleted list (or inline comma-separated if short)
- **Case Studies** — bulleted list with descriptions
- **Partnerships & Certifications** — show as badge chips
- **Team Info** — plain text paragraph
- **Red Flags** — show in red/destructive color. Each flag as a line with a warning icon. If empty array, don't show this section at all.
- **Acquisition Notes** — muted text block with a "Notes" label

If `agency_profile` is null (profiling hasn't run yet or failed), show "Agency profile not available" muted text.

**Section 2: Scoring Breakdown** (from individual score columns + `scoring_signals`)

Show a visual breakdown of the 5 scoring components:

```
Revenue Score         ████████████░░░░   72
Team Size Score       ████████████████   100
Specialization Score  ████████░░░░░░░░   50
Founder-Led Score     ████████████████   100
B2B Focus Score       ████████████░░░░   70
─────────────────────────────────────────
Total Score                              82/100
```

- Each component: label + horizontal bar (width proportional to score out of 100) + numeric score
- Bar colors: green if >=75, orange if >=50, red if <50
- Use `revenue_score`, `team_size_score`, `specialization_score`, `founder_led_score`, `b2b_focus_score` columns
- Below the bars, show **Scoring Signals** from the `scoring_signals` text array. Each signal is a short sentence explaining why the score is what it is. Display as a bulleted list in muted text.
  - Example signals: "Revenue estimate $1.2M in ideal range", "Team size 8 — ideal boutique", "Founder-led agency detected", "Multiple B2B indicators found"

If scores are all null (scoring hasn't run), show "Scoring not available yet" muted text.

**Section 3: Contacts** (from `contacts` table, joined by `prospect_id`)

Table with columns: **Name**, **Title**, **Email**, **Phone**, **LinkedIn**, **Tags**
- **Name**: `full_name` (bold)
- **Title**: `title` field
- **Email**: clickable `mailto:` link. Show "—" if null.
- **Phone**: plain text. Show "—" if null.
- **LinkedIn**: clickable link icon that opens `linkedin_url` in new tab. Show "—" if null.
- **Tags**: Show badge chips for: "Founder" (if `is_founder`), "CEO" (if `is_ceo`), "Owner" (if `is_owner`). Green color for these badges.

If no contacts found, show "No contacts found" muted text.

**Section 4: Draft Outreach Message** (from `draft_message` column)

This is the personalized LinkedIn message Claude generated for this prospect. The user should be able to review and edit it before approving.

- **Label**: "LinkedIn Outreach Message (Step 2)"
- **Subtitle** (muted): "Sent after connection request is accepted. Peer-to-peer tone, references their agency specifically."
- **Textarea**: Pre-filled with `draft_message` value. Editable. 4 rows tall.
- **Character count**: Show below the textarea, e.g. "247 / 300 characters" — green if under 300, orange if 250-300, red if over 300.
- **"Save Message" button**: Saves the edited text back to `prospects.draft_message` via a direct Supabase update.

If `draft_message` is null (message generation hasn't run yet, or prospect wasn't qualified), show "No draft message — only generated for qualified (high/medium fit) prospects" muted text.

---

#### Company Info Sidebar (within expanded detail)

Also show these enrichment fields from the prospect row in a small info panel or grid within the expanded view:

| Field | Column | Display |
|-------|--------|---------|
| Website | `domain` | Link: https://{domain} (new tab) |
| LinkedIn | `linkedin_url` | Link icon (new tab). Hide if null. |
| Industry | `industry` | Plain text |
| Location | `location` | Plain text |
| Employees | `employee_count` | Number |
| Founded | `founded_year` | Year |
| Revenue Est. | `revenue_estimate` | Format as currency: "$1.2M", "$750K", etc. |
| Technologies | `technologies` | Badge chips (show first 6, "+N more" if longer) |
| Services | `services` | Badge chips |
| Description | `description` | Paragraph text (from Ocean.io enrichment) |

---

#### Approve Action Logic

When user clicks **"Approve"** on a prospect:

1. Optimistically update the UI: set `review_status` to 'approved', show green check
2. Call the `approve-prospect` edge function with `{ prospectId }`
3. The edge function finds the best contact (founder/CEO preferred), reads the `draft_message`, and pushes the lead to HeyReach
4. Show a success toast: "Pushed {contactName} to HeyReach campaign"
5. If the edge function returns an error (e.g. no contact with LinkedIn URL), show an error toast and revert the optimistic update

When user clicks **"Skip"**:

1. Update `review_status` to 'skipped' in Supabase directly
2. Show the card as dimmed/muted with "Skipped" label

**"Approve All High Fit" button:**
1. Show confirmation dialog: "Approve N high-fit prospects? This will push them to the HeyReach LinkedIn campaign."
2. On confirm, call `approve-prospect` for each high-fit pending prospect sequentially
3. Show progress: "Approving 1 of N..."
4. Show summary toast when complete: "Approved N prospects"

---

#### Real-time Updates

Subscribe to Supabase Realtime on all three tables for this search:

- **`searches`** filtered by `id = searchId` — updates status, progress_pct, current_step, counts
- **`prospects`** filtered by `search_id = searchId` — rows appear live as they're discovered, then update with enrichment data, agency_profile, scores, draft_message, review_status
- **`contacts`** filtered by `search_id = searchId` — contact rows appear as enrichment finds people

When a prospect row updates (e.g. enrichment_status changes from 'enriching' to 'complete', or total_score gets set), the card should update in place without a page refresh. The user should see data filling in live as the Trigger.dev task runs.

---

## Sidebar Navigation

3 nav items:
1. **Dashboard** (LayoutDashboard icon) → `/`
2. **New Search** (PlusCircle icon) → `/search/new`
3. **Approved Emails** (UserCheck icon) → `/approved`

**Approved Emails page** (`/approved`): Simple table showing all prospects across all searches where `review_status = 'approved'`. Columns: Company Name, Domain, Contact Name, LinkedIn URL, HeyReach Status (pushed_at timestamp), Pipedrive Status (org_id set = "In CRM"). This lets the user track outreach progress across all searches.

Footer: "by Aragon Holdings" italic text

---

## Edge Functions (4 required)

### 1. `trigger-search`

Called by the frontend when a user submits a new search. Triggers the Trigger.dev task.

**Request:**
```json
{
  "searchId": "uuid",
  "queryType": "natural_language | domain_lookalike",
  "queryText": "string (optional)",
  "seedDomains": ["string (optional)"],
  "maxResults": 50
}
```

**Logic:**
1. Validate the request
2. Call the Trigger.dev API to trigger the `run-agency-sourcer` task with the payload
3. Return `{ success: true }`

**Environment variables needed:** `TRIGGER_SECRET_KEY` (to authenticate with Trigger.dev API)

### 2. `update-search`

Called by the Trigger.dev task to perform all database operations. Dispatches based on the `action` field.

**Request:** `{ "action": "...", ...payload }`

**Auth:** Validates `x-edge-function-key` header against a secret stored in env vars.

**Actions the edge function must handle:**

| Action | Payload | DB Operation |
|--------|---------|-------------|
| `update_search_status` | `searchId, status, currentStep?, progressPct?` | Update `searches` row |
| `update_search_counts` | `searchId, totalDiscovered?, totalQualified?` | Update `searches` counts |
| `mark_search_failed` | `searchId, errorMessage` | Set search status=failed |
| `upsert_prospects` | `searchId, prospects[]` | Upsert into `prospects`, return `{ ids: [...] }` |
| `update_prospect_enrichment` | `prospectId, enrichmentStatus, enrichmentData?, denormalized?` | Update prospect enrichment fields |
| `update_prospect_profile` | `prospectId, agencyProfile` | Set `agency_profile` JSONB field |
| `update_prospect_scores` | `prospectId, totalScore, fitLevel, scores{}, signals[]` | Update prospect score fields |
| `update_prospect_draft_message` | `prospectId, draftMessage` | Set `draft_message` text field |
| `update_prospect_review_status` | `prospectId, reviewStatus` | Set `review_status` field |
| `update_prospect_pipedrive` | `prospectId, orgId` | Set pipedrive_org_id + timestamp |
| `insert_contacts` | `contacts[]` | Insert into `contacts`, return `{ ids: [...] }` |
| `update_contact_pipedrive` | `contactId, personId, label` | Set pipedrive fields on contact |
| `update_contact_heyreach` | `contactId, leadId, campaignId` | Set heyreach fields on contact |
| `get_existing_domains` | `domains[]` | Query prospects for matching domains, return `{ domains: [...] }` |
| `get_prospects_by_search` | `searchId` | Return `{ prospects: [...] }` with nested contacts |
| `notify_progress` | `searchId, status, statusMessage?, errorMessage?` | Same as update_search_status (alias) |

Each action should use the Supabase service role client (available inside edge functions) to perform the database operation and return JSON.

### 3. `approve-prospect`

Called by the frontend when user clicks "Approve" on a prospect. Pushes the lead to HeyReach.

**Request:**
```json
{
  "prospectId": "uuid"
}
```

**Logic:**
1. Fetch the prospect from DB (need: domain, company_name, draft_message, review_status)
2. Fetch contacts for this prospect, pick the best one (prefer founder > CEO > owner > first contact)
3. The selected contact MUST have a `linkedin_url` — if no contact has one, return error
4. Update prospect `review_status` to 'approved'
5. Call HeyReach API to add the lead to the campaign:
   - `POST https://api.heyreach.io/api/public/v1/campaign/add-leads`
   - Include `customUserFields: [{ name: "personalized_message", value: draft_message }]`
   - Include the `linkedInAccountId` from env var `HEYREACH_LINKEDIN_ACCOUNT_ID`
6. Update the contact with `heyreach_lead_id`, `heyreach_campaign_id`, `heyreach_pushed_at`
7. Return `{ success: true, contactName, linkedinUrl }`

**Environment variables needed:** `HEYREACH_API_KEY`, `HEYREACH_CAMPAIGN_ID`, `HEYREACH_LINKEDIN_ACCOUNT_ID`

### 4. `heyreach-webhook`

Receives webhooks from HeyReach when a connection request is accepted. Creates the Pipedrive org + person as "Cold Lead".

**Request:** HeyReach webhook payload (contains lead info and event type). HeyReach sends a POST with JSON body when the configured webhook event fires.

**Logic:**
1. Parse the webhook payload and validate the event type is "Connection Request Accepted"
2. Extract the LinkedIn profile URL from the payload
3. Look up the contact in the `contacts` table by matching `linkedin_url`
4. If no matching contact found, log a warning and return 200 (don't break the webhook)
5. Fetch the associated prospect via `prospect_id` (need: `domain`, `company_name`, `description`, `location`, `total_score`)
6. **Pipedrive dedup check:** Search for existing org by domain: `GET https://api.pipedrive.com/v1/organizations/search?term={domain}&api_token={token}`
7. If no existing org found, **create organization:** `POST /v1/organizations` with name, address (location), and custom fields (domain, fit score)
8. **Create person** linked to the org: `POST /v1/persons` with:
   - `name`: contact full_name
   - `org_id`: the org ID (found or created)
   - `email`: `[{ value: contact.email, label: "work" }]`
   - `phone`: `[{ value: contact.phone, label: "mobile" }]` (if available)
   - `label_ids`: `[17]` (Cold Lead label)
9. Update prospect row: set `pipedrive_org_id` and `pipedrive_pushed_at`
10. Update contact row: set `pipedrive_person_id`, `pipedrive_label = "Cold Lead"`, `pipedrive_pushed_at`
11. Return `{ success: true }`

**Error handling:**
- If Pipedrive API calls fail, log the error but still return 200 to HeyReach (so the webhook doesn't retry endlessly)
- If the contact/prospect lookup fails, return 200 with `{ success: false, reason: "contact not found" }`

**Environment variables needed:** `PIPEDRIVE_API_TOKEN`, `PIPEDRIVE_COLD_LEAD_LABEL_ID`

---

## Environment Variables (Edge Functions)

- `TRIGGER_SECRET_KEY` — for calling Trigger.dev API from `trigger-search`
- `EDGE_FUNCTION_SECRET` — shared secret validated via `x-edge-function-key` header in `update-search`
- `HEYREACH_API_KEY` — for calling HeyReach API from `approve-prospect`
- `HEYREACH_CAMPAIGN_ID` — HeyReach campaign to add leads to
- `HEYREACH_LINKEDIN_ACCOUNT_ID` — LinkedIn sender account in HeyReach
- `PIPEDRIVE_API_TOKEN` — for calling Pipedrive API from `heyreach-webhook`
- `PIPEDRIVE_COLD_LEAD_LABEL_ID` — numeric label ID for "Cold Lead" in Pipedrive (17)

---

## LinkedIn Outreach Sequence (pre-built in HeyReach)

The HeyReach campaign uses a 4-step sequence. Steps 1 and 2 are automated via this system. Steps 3 and 4 are static templates configured directly in HeyReach.

1. **Step 1 — Blank connection request** (Day 0): No note. Blank connection requests have higher acceptance rates.
2. **Step 2 — Personalized message** (Day 2): Uses `{personalized_message}` custom variable. Claude-generated per-lead, references something specific about their agency (a client, case study, partnership, positioning). Peer-to-peer tone, under 300 chars, no hard ask.
3. **Step 3 — Podcast invite** (Day 5): Generic template (static in HeyReach). Invites the founder to appear on a podcast. Soft, value-first approach.
4. **Step 4 — Direct close** (Day 11): Generic template (static in HeyReach). Direct but respectful ask about whether they've considered a holding company or partnership model.

---

## User Flow Summary

1. **User creates a search** → Trigger.dev task runs automatically
2. **Task discovers** agencies via Exa.ai (natural language) or Ocean.io (domain lookalikes) → prospects appear live in the card list
3. **Task enriches** each prospect via Ocean.io + Apollo fallback → company data + contacts stream in
4. **Task profiles** each agency via Firecrawl + Claude → agency profile appears in expandable detail (positioning, services, clients, red flags, acquisition notes)
5. **Task scores** each prospect → fit level badges, score numbers, and scoring breakdowns appear on cards
6. **Task generates personalized messages** for qualified prospects → draft messages appear in detail view
7. **Search completes** → User reviews prospects sorted by score, reads agency profiles, edits draft messages if needed
8. **User clicks "Approve"** → Lead pushed to HeyReach campaign with personalized message
9. **HeyReach sends blank connection request** → If accepted, sends personalized message on Day 2
10. **HeyReach webhook fires on acceptance** → Pipedrive org + person created as "Cold Lead"

---

## Key Implementation Notes

1. **No authentication** — this is an internal tool, no login required
2. **Realtime is critical** — the entire UX depends on watching the search progress live as the Trigger.dev task runs
3. **The results page is the core of the app** — it must show ALL data from the backend: scores, agency profiles, contacts, draft messages, and review actions. Every field described above must be displayed.
4. **The Trigger.dev task does all the heavy lifting** — the frontend just submits searches and displays results
5. **Edge functions are the only bridge** — Trigger.dev cannot access Supabase directly, it calls the `update-search` edge function for all DB operations
6. **Review before outreach** — prospects must be reviewed and approved by the user before any LinkedIn outreach happens
7. **Draft messages are editable** — the user can modify Claude's generated message before approving
8. **Pipedrive is deferred** — CRM entries are only created when a LinkedIn connection request is accepted (via HeyReach webhook), not during the initial search
9. **Match the Aragon Holdings design system exactly** — Playfair Display headings, Inter body, green primary, orange accent, white cards on light gray background, fixed sidebar layout
10. **Revenue formatting** — The `revenue_estimate` field is stored as a number (e.g. 1200000). Display it formatted: "$1.2M", "$750K", "$3.5M", etc.
11. **Handle null/missing data gracefully** — During a search, data arrives progressively. Cards should work at every stage: discovery (just domain/name), enrichment (company data fills in), profiling (agency profile appears), scoring (fit badge + score appear), messaging (draft message appears). Use skeletons or "pending" states for sections that haven't loaded yet.
