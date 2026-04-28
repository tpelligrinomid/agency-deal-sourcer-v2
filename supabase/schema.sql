-- Agency Deal Sourcer v2 - Supabase Schema (Agency-Centric)
-- Run this in the Supabase SQL Editor

-- ============================================
-- SEARCHES table (unchanged structure)
-- ============================================
CREATE TABLE IF NOT EXISTS searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_type TEXT NOT NULL CHECK (query_type IN ('natural_language', 'domain_lookalike', 'csv_upload')),
  query_text TEXT,
  seed_domains TEXT[],
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'discovering', 'enriching', 'profiling', 'scoring', 'complete', 'failed')),
  current_step TEXT,
  progress_pct INTEGER DEFAULT 0,
  error_message TEXT,
  total_discovered INTEGER DEFAULT 0,
  total_qualified INTEGER DEFAULT 0,
  ocean_search_after TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- AGENCIES table (replaces prospects)
-- Domain is globally unique (not per-search)
-- ============================================
CREATE TABLE IF NOT EXISTS agencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT NOT NULL UNIQUE,
  company_name TEXT,
  source TEXT CHECK (source IN ('exa_search', 'exa_similar', 'ocean_lookalike')),
  discovered_by_search_id UUID REFERENCES searches(id) ON DELETE SET NULL,
  last_enriched_at TIMESTAMPTZ,

  -- Exa data
  exa_title TEXT,
  exa_description TEXT,
  exa_highlights TEXT[],
  exa_score REAL,

  -- Enrichment
  enrichment_status TEXT DEFAULT 'pending' CHECK (enrichment_status IN ('pending', 'enriching', 'complete', 'failed')),
  enrichment_data JSONB,

  -- Denormalized enrichment fields
  description TEXT,
  industry TEXT,
  employee_count INTEGER,
  founded_year INTEGER,
  location TEXT,
  linkedin_url TEXT,
  technologies TEXT[],
  services TEXT[],
  revenue_estimate REAL,

  -- Firecrawl agency profile
  agency_profile JSONB,

  -- Scores
  total_score REAL,
  fit_level TEXT CHECK (fit_level IN ('high', 'medium', 'low')),
  revenue_score REAL,
  team_size_score REAL,
  specialization_score REAL,
  founder_led_score REAL,
  b2b_focus_score REAL,
  scoring_signals TEXT[],

  -- Draft outreach messages (two variants: rapport and direct pitch)
  draft_message_rapport TEXT,
  draft_message_direct TEXT,

  -- Review status: pending_review → approved | skipped | blacklisted
  review_status TEXT DEFAULT 'pending_review'
    CHECK (review_status IN ('pending_review', 'approved', 'skipped', 'blacklisted')),

  -- Pipedrive
  pipedrive_org_id INTEGER,
  pipedrive_pushed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agencies_domain ON agencies(domain);
CREATE INDEX IF NOT EXISTS idx_agencies_review_status ON agencies(review_status);
CREATE INDEX IF NOT EXISTS idx_agencies_fit_level ON agencies(fit_level);
CREATE INDEX IF NOT EXISTS idx_agencies_discovered_by ON agencies(discovered_by_search_id);

-- ============================================
-- SEARCH_AGENCIES junction table
-- Links searches to agencies (many-to-many)
-- ============================================
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

-- ============================================
-- CONTACTS table (globally unique people)
-- ============================================
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

-- ============================================
-- AGENCY_CONTACTS junction table
-- Links contacts to agencies (many-to-many)
-- ============================================
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

-- ============================================
-- Enable Realtime on all tables
-- ============================================
ALTER PUBLICATION supabase_realtime ADD TABLE searches;
ALTER PUBLICATION supabase_realtime ADD TABLE agencies;
ALTER PUBLICATION supabase_realtime ADD TABLE search_agencies;
ALTER PUBLICATION supabase_realtime ADD TABLE contacts;
ALTER PUBLICATION supabase_realtime ADD TABLE agency_contacts;

-- ============================================
-- Updated_at trigger function
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_searches_updated_at
  BEFORE UPDATE ON searches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_agencies_updated_at
  BEFORE UPDATE ON agencies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_contacts_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
