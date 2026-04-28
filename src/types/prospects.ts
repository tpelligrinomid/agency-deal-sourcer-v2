// Raw prospect from Exa discovery (unchanged — discovery-layer type)
export interface RawProspect {
  domain: string;
  companyName: string | null;
  source: "exa_search" | "exa_similar" | "ocean_lookalike";
  exaTitle: string | null;
  exaDescription: string | null;
  exaHighlights: string[] | null;
  exaScore: number | null;
  // Pre-enriched company data from Ocean.io lookalike search (skips enrichment step)
  preEnriched: ClayEnrichmentData | null;
}

// Enrichment data from Clay/Ocean.io (JSONB blob)
export interface ClayEnrichmentData {
  // Company fields
  companyName: string | null;
  description: string | null;
  industry: string | null;
  employeeCount: number | null;
  foundedYear: number | null;
  location: string | null;
  linkedinUrl: string | null;
  technologies: string[] | null;
  services: string[] | null;
  revenueEstimate: number | null;

  // People (founders/owners/decision-makers)
  people: ClayPerson[] | null;
}

export interface ClayPerson {
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  linkedinUrl: string | null;
  email: string | null;
  phone: string | null;
  isFounder: boolean;
  isCeo: boolean;
  isOwner: boolean;
}

// Agency profile from Firecrawl + Claude analysis
export interface AgencyProfile {
  positioning: string | null;
  services: string[];
  industries: string[];
  clients: string[];
  caseStudies: string[];
  partnerships: string[];
  teamInfo: string | null;
  redFlags: string[];
  acquisitionNotes: string | null;
  scrapedAt: string;
}

// Review status — now includes blacklisted
export type ReviewStatus = "pending_review" | "approved" | "skipped" | "blacklisted";

// Enriched agency (replaces EnrichedProspect — no searchId, agencies are global)
export interface EnrichedAgency {
  id: string;
  domain: string;
  isRediscovery: boolean;

  // Company info (denormalized from enrichment)
  companyName: string | null;
  description: string | null;
  industry: string | null;
  employeeCount: number | null;
  foundedYear: number | null;
  location: string | null;
  linkedinUrl: string | null;
  technologies: string[] | null;
  services: string[] | null;
  revenueEstimate: number | null;

  // Enrichment metadata
  enrichmentStatus: "pending" | "enriching" | "complete" | "failed";
  enrichmentData: ClayEnrichmentData | null;

  // Firecrawl profile
  agencyProfile: AgencyProfile | null;

  // Contacts extracted from enrichment
  contacts: ClayPerson[];
}

// Component scores
export interface ScoreBreakdown {
  revenueScore: number;
  teamSizeScore: number;
  specializationScore: number;
  founderLedScore: number;
  b2bFocusScore: number;
}

// Contact record (globally unique, linked to agencies via agency_contacts junction)
export interface Contact {
  id?: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  isFounder: boolean;
  isCeo: boolean;
  isOwner: boolean;
  pipedrivePersonId: number | null;
  pipedriveLabel: string | null;
  pipedrivePushedAt: string | null;
  heyreachLeadId: string | null;
  heyreachCampaignId: string | null;
  heyreachPushedAt: string | null;
}

// Agency-contact junction record
export interface AgencyContact {
  id?: string;
  agencyId: string;
  contactId: string;
  isPrimary: boolean;
}

// Fit level type
export type FitLevel = "high" | "medium" | "low";
