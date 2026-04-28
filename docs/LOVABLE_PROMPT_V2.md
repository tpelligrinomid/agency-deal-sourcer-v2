# Lovable Project Prompt V2 — Agency Deal Sourcer by Aragon Holdings

## Overview

Build a 5-page internal tool called **"Agency Deal Sourcer by Aragon Holdings"** for discovering, scoring, and managing agency acquisition targets. The app uses an **agency-centric data model**: agencies persist globally (unique by domain) across all searches. Searches are research sessions that feed the agency database. The frontend shows search progress, lets users review agencies with full profiles, and manages a review pipeline with three outcomes: **approve** (push to outreach), **skip** (meh, might reconsider later), and **blacklist** (garbage, never again).

**Key flow:** Automated research → Human review → Approve → HeyReach LinkedIn sequence → Connection accepted webhook → Pipedrive CRM entry

**Data model change from V1:** Agencies are global entities (not per-search). A `search_agencies` junction table links searches to agencies. Contacts are globally unique people linked to agencies via an `agency_contacts` junction. Skipped agencies can be rediscovered; blacklisted/approved agencies are permanently excluded from future searches.

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

Apply the full light mode and dark mode CSS variable set from the design system document. Include sidebar-specific variables.

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
- **Blacklisted (dark):** `bg-gray-800 text-white` or `bg-destructive text-destructive-foreground`

### Icons
Lucide React. 16px inline (`h-4 w-4`), 20px for navigation (`h-5 w-5`).

---

## Supabase Database Schema

Run this SQL to create the 5 tables. Enable Realtime on all five.

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

CREATE TABLE IF NOT EXISTS agencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT NOT NULL UNIQUE,
  company_name TEXT,
  source TEXT CHECK (source IN ('exa_search', 'exa_similar', 'ocean_lookalike')),
  discovered_by_search_id UUID REFERENCES searches(id) ON DELETE SET NULL,
  last_enriched_at TIMESTAMPTZ,
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
  review_status TEXT DEFAULT 'pending_review'
    CHECK (review_status IN ('pending_review', 'approved', 'skipped', 'blacklisted')),
  pipedrive_org_id INTEGER,
  pipedrive_pushed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agencies_domain ON agencies(domain);
CREATE INDEX IF NOT EXISTS idx_agencies_review_status ON agencies(review_status);
CREATE INDEX IF NOT EXISTS idx_agencies_fit_level ON agencies(fit_level);
CREATE INDEX IF NOT EXISTS idx_agencies_discovered_by ON agencies(discovered_by_search_id);

CREATE TABLE IF NOT EXISTS search_agencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id UUID NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  was_rediscovery BOOLEAN DEFAULT FALSE,
  UNIQUE(search_id, agency_id)
);

CREATE INDEX IF NOT EXISTS idx_search_agencies_search ON search_agencies(search_id);
CREATE INDEX IF NOT EXISTS idx_search_agencies_agency ON search_agencies(agency_id);

CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  title TEXT,
  email TEXT UNIQUE,
  phone TEXT,
  linkedin_url TEXT UNIQUE,
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

CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
CREATE INDEX IF NOT EXISTS idx_contacts_linkedin ON contacts(linkedin_url);

CREATE TABLE IF NOT EXISTS agency_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  is_primary BOOLEAN DEFAULT FALSE,
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(agency_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_agency_contacts_agency ON agency_contacts(agency_id);
CREATE INDEX IF NOT EXISTS idx_agency_contacts_contact ON agency_contacts(contact_id);

ALTER PUBLICATION supabase_realtime ADD TABLE searches;
ALTER PUBLICATION supabase_realtime ADD TABLE agencies;
ALTER PUBLICATION supabase_realtime ADD TABLE search_agencies;
ALTER PUBLICATION supabase_realtime ADD TABLE contacts;
ALTER PUBLICATION supabase_realtime ADD TABLE agency_contacts;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_searches_updated_at BEFORE UPDATE ON searches FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_agencies_updated_at BEFORE UPDATE ON agencies FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_contacts_updated_at BEFORE UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

**Key schema differences from V1:**
- `agencies` table replaces `prospects` — `UNIQUE(domain)` instead of `UNIQUE(domain, search_id)`
- `search_agencies` junction links searches to agencies (many-to-many)
- `contacts` are globally unique by `email` and `linkedin_url` (PostgreSQL UNIQUE allows multiple NULLs)
- `agency_contacts` junction links contacts to agencies (many-to-many, a contact can work at multiple agencies)
- `review_status` adds `'blacklisted'` option
- Deleting a search does NOT delete agencies (`ON DELETE SET NULL` on `discovered_by_search_id`)

---

## Pages (5 total)

### 1. Dashboard (`/`)

The main landing page showing recent searches.

**Components:**
- Page header: "Agency Deal Sourcer" h1 + "Discover, score, and manage agency acquisition targets" subtitle + "New Search" primary button (top right)
- **Search cards** in a grid (`grid gap-6 md:grid-cols-2 lg:grid-cols-3`), each showing:
  - Query text (truncated) or "Domain Lookalike: {domains}"
  - Status badge (pending=neutral, discovering/enriching/profiling/scoring=orange, complete=green, failed=red)
  - Progress bar (shows `progress_pct`, only visible when status is not complete/failed)
  - Stats row: "X discovered · Y qualified"
  - Timestamp: "Started {relative time}"
  - Click navigates to `/search/:id`
- **Empty state** when no searches: centered icon + "No searches yet" + "New Search" button
- Subscribe to Supabase Realtime on `searches` table for live status/progress updates

### 2. New Search (`/search/new`)

Form to submit a new search.

**Components:**
- Page header: "New Search" h1 + "Configure and launch a new agency search" subtitle
- **Query type toggle** (Tabs component with 2 tabs):
  - **"Natural Language"** tab: single textarea, placeholder "Describe your ideal agency target... e.g. Small HubSpot agencies in the US with less than 15 employees that focus on B2B SaaS"
  - **"Domain Lookalike"** tab: input for comma-separated domains, placeholder "newnorth.com, impactplus.com, revenue.io"
- **Max results** number input (default 50, min 10, max 100)
- **Submit button**: "Launch Search" (primary, full width on mobile)
- On submit:
  1. Insert a row into `searches` table with `status: 'pending'`
  2. Call the `trigger-search` edge function with `{ searchId, queryType, queryText, seedDomains, maxResults }`
  3. Navigate to `/search/:id` to watch progress

### 3. Agencies (`/agencies`)

**Master list of ALL agencies across all searches.** This is the central agency database.

**Components:**
- Page header: "Agencies" h1 + "All discovered agencies across all searches" subtitle
- **Filter bar:**
  - **Review status filter** (Select): All / Pending Review / Approved / Skipped / Blacklisted
  - **Fit level filter** (Select): All / High Fit / Medium Fit / Low Fit
  - **Source filter** (Select): All / Exa Search / Exa Similar / Ocean Lookalike
  - **Search filter** (Select): All searches / specific search (populated from `searches` table)
  - **Sort** (Select): Score (High → Low) / Score (Low → High) / Company Name (A-Z) / Newest First
- **Bulk actions bar** (shown when agencies are selected via checkboxes):
  - "Approve Selected" (green button)
  - "Skip Selected" (ghost button)
  - "Blacklist Selected" (destructive button, with confirmation dialog)
- **Agency table/cards** — same card format as Search Results (see below), showing all agencies from the `agencies` table
- **Pagination** — agencies list can be large, use pagination (25 per page)
- When filtering by a specific search, join through `search_agencies` junction and show "Rediscovered" badge on rows where `was_rediscovery = TRUE`

### 4. Contacts (`/contacts`)

**Master list of ALL contacts across all agencies.** Shows outreach status per person — who has been pushed to HeyReach, who has been pushed to Pipedrive, and current status.

**Components:**
- Page header: "Contacts" h1 + "All discovered contacts and their outreach status" subtitle
- **Filter bar:**
  - **Outreach status filter** (Select): All / Pushed to HeyReach / Pushed to Pipedrive / Not Pushed
  - **Role filter** (Select): All / Founders / CEOs / Owners
  - **Agency filter** (Select): All / specific agency (searchable dropdown from `agencies` table)
  - **Search** (Input): Free text search across name, email, title
- **Contacts table** with columns:
  - **Name**: `full_name` (bold), with "Primary" star icon if `agency_contacts.is_primary = true` for any linked agency
  - **Title**: `title`
  - **Email**: clickable `mailto:` link, "—" if null
  - **LinkedIn**: clickable link icon to `linkedin_url`, "—" if null
  - **Agency**: Company name(s) from linked agencies via `agency_contacts` → `agencies`. If linked to multiple agencies, show as comma-separated list or stacked badges. Each agency name links to its card on the Agencies page.
  - **Tags**: "Founder" / "CEO" / "Owner" green badges based on flags
  - **HeyReach**: If `heyreach_pushed_at` is set, show green "Pushed" badge with relative timestamp (e.g. "Pushed 3d ago"). If `heyreach_campaign_id` is set, show campaign ID as muted text. If not pushed, show "—".
  - **Pipedrive**: If `pipedrive_person_id` is set, show green "In CRM" badge with relative timestamp from `pipedrive_pushed_at`. Show `pipedrive_label` as a muted badge (e.g. "Cold Lead"). If not in CRM, show "—".
- **Pagination** — 25 per page
- **Sort** (Select): Name (A-Z) / Newest First / Recently Pushed to HeyReach / Recently Pushed to Pipedrive
- **Empty state**: "No contacts discovered yet" + "Contacts are found during agency enrichment"

**Row click** expands an inline detail panel showing:
- Full contact info (name, title, email, phone, LinkedIn)
- All linked agencies (from `agency_contacts` junction), each showing: agency name, domain, review status badge, fit level badge
- HeyReach details: campaign ID, lead ID, pushed timestamp
- Pipedrive details: person ID, label, pushed timestamp

### 5. Search Results (`/search/:id`)

Shows agencies linked to a specific search via the `search_agencies` junction table.

---

#### Header Section

- **Back link**: "← All Searches" (navigates to `/`)
- **Title**: The search query text or "Agencies similar to {seedDomains}" for domain lookalikes
- **Status badge** + **progress bar** (animated). Progress bar only shows when search is in progress.
- **Current step text** below progress bar (from `searches.current_step`).
- **Three stat cards** in a row:
  - **Discovered**: `total_discovered` count with Building icon
  - **Qualified**: `total_qualified` count with CheckCircle icon
  - **Approved**: count of agencies where `review_status = 'approved'` (linked to this search) with UserCheck icon

---

#### Filter & Action Bar

- **Fit level filter** (Select): All / High Fit / Medium Fit / Low Fit
- **Review status filter** (Select): All / Pending Review / Approved / Skipped / Blacklisted
- **Sort control** (Select): Score (High → Low) / Score (Low → High) / Company Name (A-Z)
- **"Approve All High Fit" button** (accent/orange): Bulk-approves all agencies where `fit_level = 'high'` AND `review_status = 'pending_review'`. Confirmation dialog with count.

---

#### Agency Card Format (used on both Agencies page and Search Results page)

Display agencies as **cards**. Each card is a self-contained unit with an expandable detail section.

**Default sort:** `total_score` descending. Agencies with no score yet appear at the bottom.

**Each agency card (collapsed view):**

```
┌──────────────────────────────────────────────────────────────────────┐
│  [FitBadge] Company Name                    Score: 82/100    [▼]    │
│  domain.com · Industry · Location · Employees: 12                   │
│  "One-line positioning from agency profile..."                      │
│  [Service] [Service] [Service]       [Approve] [Skip] [Blacklist]   │
│  [Rediscovered badge if applicable]                                 │
└──────────────────────────────────────────────────────────────────────┘
```

Specifics:
- **Fit level badge**: "HIGH FIT" green, "MEDIUM FIT" orange, "LOW FIT" gray. Hidden if `fit_level` is null.
- **Company name**: Bold, large text. Use `company_name`, fallback to `domain`.
- **Score**: "82/100" — green if >=75, orange if >=50, red if <50. Show "—" if null.
- **Info row**: `domain` (link to https://{domain}) · `industry` · `location` · "Employees: {employee_count}". Skip nulls.
- **Positioning**: From `agency_profile.positioning`, italic, truncated ~120 chars.
- **Service tags**: From `agency_profile.services`, first 4 as badges, "+N more" if longer.
- **Rediscovered badge**: Show "Rediscovered" orange badge if this agency was rediscovered in this search (from `search_agencies.was_rediscovery`). Only on Search Results page.
- **Action buttons** (only when `total_score` is not null):
  - `pending_review`: "Approve" (green, **disabled with tooltip "No contacts with LinkedIn URL" if no linked contacts have a `linkedin_url`**) + "Skip" (ghost) + "Blacklist" (small destructive icon button with tooltip)
  - `approved`: Green check + "Approved" text
  - `skipped`: "Skipped" muted text + "Reconsider" ghost button (resets to pending_review)
  - `blacklisted`: "Blacklisted" destructive badge, no actions
- **Enrichment status**: Spinner/"Enriching..." if not complete. Warning badge if failed.

---

#### Expanded Agency Detail

When an agency card is expanded, show 4 sections:

**Section 1: Agency Profile** (from `agency_profile` JSONB)

Same JSONB structure as V1:
```json
{
  "positioning": "string",
  "services": ["array"],
  "industries": ["array"],
  "clients": ["array"],
  "caseStudies": ["array"],
  "partnerships": ["array"],
  "teamInfo": "string",
  "redFlags": ["array"],
  "acquisitionNotes": "string",
  "scrapedAt": "ISO date"
}
```

Display:
- **Positioning** — full text, italic, prominent
- **Services** — green badge chips
- **Industries Served** — muted badge chips
- **Notable Clients** — bulleted list
- **Case Studies** — bulleted list with descriptions
- **Partnerships & Certifications** — badge chips
- **Team Info** — plain text paragraph
- **Red Flags** — red/destructive color with warning icons. Hidden if empty.
- **Acquisition Notes** — muted text block

If null, show "Agency profile not available" muted text.

**Section 2: Scoring Breakdown**

Visual breakdown of 5 scoring components with horizontal bars:
- `revenue_score`, `team_size_score`, `specialization_score`, `founder_led_score`, `b2b_focus_score`
- Bar colors: green >=75, orange >=50, red <50
- Total score at bottom
- **Scoring Signals** from `scoring_signals` array as bulleted muted text

If null, show "Scoring not available yet".

**Section 3: Contacts** (from `contacts` joined through `agency_contacts`)

Table: **Name**, **Title**, **Email**, **Phone**, **LinkedIn**, **Tags**, **Primary**
- Query: join `agency_contacts` on `agency_id`, then join `contacts` on `contact_id`
- **Name**: `full_name` (bold)
- **Title**: `title`
- **Email**: clickable `mailto:` link
- **Phone**: plain text
- **LinkedIn**: clickable link icon
- **Tags**: "Founder" / "CEO" / "Owner" green badges
- **Primary**: Star icon if `agency_contacts.is_primary = true`

If no contacts, show "No contacts found — add one manually to enable approval."

**"Add Contact" button** (below the contacts table, always visible):
- Opens a dialog/inline form with fields: **Full Name** (required), **LinkedIn URL** (required), **Title**, **Email**, **Phone**, and checkboxes for **Founder** / **CEO** / **Owner**
- On submit: call `upsert_contacts` edge function action with `{ agencyId, contacts: [{ ... }] }` to insert the contact and create the `agency_contacts` junction row
- After adding, the contact appears in the table and the Approve button becomes enabled (if the contact has a LinkedIn URL)

**Section 4: Draft Outreach Message**

- **Label**: "LinkedIn Outreach Message (Step 2)"
- **Subtitle**: "Sent after connection request is accepted."
- **Textarea**: Pre-filled with `draft_message`, editable, 4 rows
- **Character count**: "247 / 300" — green <250, orange 250-300, red >300
- **"Save Message" button**: Saves to `agencies.draft_message`

If null, show "No draft message — only generated for qualified (high/medium fit) agencies".

---

#### Company Info Panel (within expanded detail)

| Field | Column | Display |
|-------|--------|---------|
| Website | `domain` | Link: https://{domain} |
| LinkedIn | `linkedin_url` | Link icon |
| Industry | `industry` | Plain text |
| Location | `location` | Plain text |
| Employees | `employee_count` | Number |
| Founded | `founded_year` | Year |
| Revenue Est. | `revenue_estimate` | "$1.2M", "$750K" |
| Technologies | `technologies` | Badge chips (first 6) |
| Services | `services` | Badge chips |
| Description | `description` | Paragraph |

---

#### Approve/Skip/Blacklist Action Logic

**Approve (two-step flow — user picks the contact):**
1. User clicks "Approve" on an agency card
2. **Contact selection dialog** opens, showing all contacts linked to this agency (from `agency_contacts` → `contacts`):
   - Each contact row shows: Name, Title, Email, LinkedIn URL, Tags (Founder/CEO/Owner)
   - Contacts without a `linkedin_url` are shown but **grayed out / disabled** with tooltip "No LinkedIn URL — cannot push to HeyReach"
   - Radio button selection (single contact) — pre-selects the first founder/CEO if available
   - The `draft_message` textarea is shown below the contact list, pre-filled and editable (last chance to tweak before sending)
   - Character count on the message (green <250, orange 250-300, red >300)
   - **"Approve & Push to HeyReach"** confirm button (green primary) + "Cancel" button
3. On confirm: optimistically update `review_status` to 'approved', call `approve-agency` edge function with `{ agencyId, contactId, draftMessage }`
4. Edge function pushes the selected contact to HeyReach with the (possibly edited) draft message
5. Success toast: "Pushed {contactName} to HeyReach campaign"
6. Error: revert optimistic update, show error toast
7. **Note:** The Approve button is disabled if no contacts have a LinkedIn URL. The user must add a contact manually first (via the "Add Contact" button in the expanded agency detail). This means the approve dialog will never open for agencies with no valid contacts.

**Skip:**
1. Update `review_status` to 'skipped' in Supabase directly
2. Show card as dimmed with "Skipped" label + "Reconsider" button
3. Note: skipped agencies CAN be rediscovered by future searches (reset to pending_review, re-enriched, re-scored)

**Blacklist:**
1. Show confirmation dialog: "Blacklist {company_name}? This agency will never appear in future search results."
2. On confirm, update `review_status` to 'blacklisted'
3. Show card with "Blacklisted" destructive badge, no further actions available
4. Blacklisted agencies are permanently excluded from all future searches

**"Approve All High Fit" button:**
1. Confirmation dialog: "Approve N high-fit agencies? Each agency will use the best available contact (founder > CEO > owner > first with LinkedIn URL). You can review individual contacts by approving agencies one at a time instead."
2. Two options: "Approve All (auto-select contacts)" or "Cancel"
3. If confirmed, for each agency: auto-select best contact with a LinkedIn URL (founder > CEO > owner > first available), call `approve-agency` with `{ agencyId, contactId, draftMessage }`
4. Agencies with no contacts that have a LinkedIn URL are skipped with a warning
5. Progress: "Approving 1 of N..."
6. Summary toast: "Approved X agencies, Y skipped (no LinkedIn contact)"

---

#### Real-time Updates

Subscribe to Supabase Realtime:
- **`searches`** filtered by `id = searchId` — status, progress, counts
- **`agencies`** — rows update with enrichment, profile, scores, messages, review status
- **`search_agencies`** filtered by `search_id = searchId` — new junction rows appear as agencies are linked
- **`contacts`** — new contacts appear as enrichment finds people
- **`agency_contacts`** — junction rows link contacts to agencies

---

## Sidebar Navigation

5 nav items:
1. **Dashboard** (LayoutDashboard icon) → `/`
2. **New Search** (PlusCircle icon) → `/search/new`
3. **Agencies** (Building icon) → `/agencies`
4. **Contacts** (Users icon) → `/contacts`
5. **Pipeline** (UserCheck icon) → `/pipeline`

**Pipeline page** (`/pipeline`): Table of all agencies where `review_status = 'approved'`. Columns: Company Name, Domain, Contact Name (from primary contact via `agency_contacts`), LinkedIn URL, HeyReach Status (`heyreach_pushed_at`), Pipedrive Status (`pipedrive_org_id` set = "In CRM"). Tracks outreach progress across all searches.

Footer: "by Aragon Holdings" italic text

---

## Edge Functions (4 required)

### 1. `trigger-search`

Called by the frontend when a user submits a new search.

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
2. Call the Trigger.dev API to trigger the `run-agency-sourcer` task
3. Return `{ success: true }`

### 2. `update-search`

Called by the Trigger.dev task for all database operations. Dispatches on `action` field.

**Auth:** Validates `x-edge-function-key` header.

**Actions:**

| Action | Payload | DB Operation |
|--------|---------|-------------|
| `update_search_status` | `searchId, status, currentStep?, progressPct?` | Update `searches` row |
| `update_search_counts` | `searchId, totalDiscovered?, totalQualified?` | Update `searches` counts |
| `mark_search_failed` | `searchId, errorMessage` | Set search status=failed |
| `upsert_agencies` | `searchId, agencies[]` | Upsert into `agencies` (ON CONFLICT domain DO UPDATE), set `discovered_by_search_id`, return `{ ids: [...] }` |
| `update_agency_enrichment` | `agencyId, enrichmentStatus, enrichmentData?, denormalized?` | Update agency enrichment fields + `last_enriched_at` |
| `update_agency_profile` | `agencyId, agencyProfile` | Set `agency_profile` JSONB |
| `update_agency_scores` | `agencyId, totalScore, fitLevel, scores{}, signals[]` | Update agency score fields |
| `update_agency_draft_message` | `agencyId, draftMessage` | Set `draft_message` |
| `update_agency_review_status` | `agencyId, reviewStatus` | Set `review_status` (pending_review, approved, skipped, blacklisted) |
| `update_agency_pipedrive` | `agencyId, orgId` | Set `pipedrive_org_id` + timestamp |
| `upsert_contacts` | `agencyId, contacts[]` | For each contact: find by email → find by linkedin_url → insert new. Link to agency via `agency_contacts` junction (ON CONFLICT DO NOTHING). Return `{ ids: [...] }` |
| `update_contact_pipedrive` | `contactId, personId, label` | Set pipedrive fields on contact |
| `update_contact_heyreach` | `contactId, leadId, campaignId` | Set heyreach fields on contact |
| `get_excluded_domains` | `domains[]` | Query `agencies` where `domain IN (...)` AND `review_status IN ('blacklisted', 'approved', 'pending_review')`, return `{ domains: [...] }` |
| `get_skipped_agencies` | `domains[]` | Query `agencies` where `domain IN (...)` AND `review_status = 'skipped'`, return `{ agencies: [{ id, domain }] }` |
| `rediscover_agency` | `agencyId, searchId` | Reset agency: `review_status = 'pending_review'`, clear enrichment/profile/scores/message, insert `search_agencies` junction row with `was_rediscovery = TRUE` |
| `insert_search_agencies` | `searchId, agencyIds[], wasRediscovery` | Insert junction rows into `search_agencies` (ON CONFLICT DO NOTHING) |
| `get_agencies_by_search` | `searchId` | Join `search_agencies` → `agencies`, return `{ agencies: [...] }` with nested contacts (via `agency_contacts` → `contacts`) |
| `notify_progress` | `searchId, status, statusMessage?, errorMessage?` | Same as `update_search_status` |

**Contact upsert logic (for `upsert_contacts` action):**
```
For each contact in the array:
  1. If contact.email is set → try INSERT INTO contacts ... ON CONFLICT (email) DO UPDATE SET full_name=..., title=..., etc. RETURNING id
  2. Else if contact.linkedin_url is set → try INSERT INTO contacts ... ON CONFLICT (linkedin_url) DO UPDATE SET full_name=..., title=..., etc. RETURNING id
  3. Else → INSERT INTO contacts ... RETURNING id (no conflict possible)
  4. INSERT INTO agency_contacts (agency_id, contact_id) VALUES (agencyId, contactId) ON CONFLICT DO NOTHING
```

### 3. `approve-agency`

Called by the frontend when user confirms the approve dialog (after selecting a contact).

**Request:**
```json
{
  "agencyId": "uuid",
  "contactId": "uuid",
  "draftMessage": "string (the possibly-edited outreach message)"
}
```

**Logic:**
1. Fetch the agency (domain, company_name)
2. Fetch the selected contact by `contactId` — verify it has a `linkedin_url`, error if not
3. Update agency `review_status` to 'approved' and `draft_message` to the provided `draftMessage` (in case user edited it in the dialog)
4. Mark this contact as primary for this agency: update `agency_contacts` set `is_primary = true` where `agency_id` and `contact_id` match (and set all others for this agency to `false`)
5. Call HeyReach API to add lead to campaign with `customUserFields: [{ name: "personalized_message", value: draftMessage }]`
6. Update contact with `heyreach_lead_id`, `heyreach_campaign_id`, `heyreach_pushed_at`
7. Return `{ success: true, contactName, linkedinUrl }`

### 4. `heyreach-webhook`

Receives webhooks from HeyReach on connection request accepted. Creates Pipedrive entries.

**Logic:**
1. Parse webhook, validate event = "Connection Request Accepted"
2. Extract LinkedIn URL from payload
3. Look up contact by `linkedin_url`
4. If no match, return 200 (don't break webhook)
5. Find the agency via `agency_contacts` junction
6. **Pipedrive dedup:** Search org by domain
7. If no org, create org with name, address, custom fields
8. Create person linked to org
9. Update agency: `pipedrive_org_id`, `pipedrive_pushed_at`
10. Update contact: `pipedrive_person_id`, `pipedrive_label = "Cold Lead"`, `pipedrive_pushed_at`
11. Return `{ success: true }`

---

## Environment Variables (Edge Functions)

- `TRIGGER_SECRET_KEY` — Trigger.dev API auth
- `EDGE_FUNCTION_SECRET` — shared secret for `x-edge-function-key` header
- `HEYREACH_API_KEY` — HeyReach API
- `HEYREACH_CAMPAIGN_ID` — campaign to add leads to
- `HEYREACH_LINKEDIN_ACCOUNT_ID` — LinkedIn sender account
- `PIPEDRIVE_API_TOKEN` — Pipedrive API
- `PIPEDRIVE_COLD_LEAD_LABEL_ID` — label ID for "Cold Lead" (17)

---

## LinkedIn Outreach Sequence (pre-built in HeyReach)

4-step sequence:
1. **Blank connection request** (Day 0): No note.
2. **Personalized message** (Day 2): `{personalized_message}` custom variable. Claude-generated, references their agency specifically.
3. **Podcast invite** (Day 5): Generic template. Soft, value-first.
4. **Direct close** (Day 11): Generic template. Direct ask about holding company/partnership.

---

## Key Implementation Notes

1. **No authentication** — internal tool, no login
2. **Realtime is critical** — entire UX depends on live updates
3. **Agency-centric model** — agencies persist globally, not per-search. The Agencies page is the master list.
4. **Three review states**: approve (push to outreach), skip (might reconsider — can be rediscovered), blacklist (never again)
5. **Contacts are global** — one person can be linked to multiple agencies via junction table. The Contacts page (`/contacts`) is the master list showing outreach status (HeyReach + Pipedrive) per person.
6. **Search Results page queries via junction** — join `search_agencies` to get agencies for a specific search
7. **Rediscovery badge** — on Search Results page, show "Rediscovered" badge for agencies where `search_agencies.was_rediscovery = TRUE`
8. **Edge functions are the only bridge** — Trigger.dev calls `update-search` for all DB operations
9. **Draft messages are editable** before approving
10. **Pipedrive is deferred** — CRM entries only on connection acceptance
11. **Match Aragon Holdings design system exactly**
12. **Revenue formatting** — `revenue_estimate` stored as number, display as "$1.2M", "$750K"
13. **Handle progressive data** — cards work at every stage (discovery → enrichment → profiling → scoring → messaging). Use skeletons for pending sections.
