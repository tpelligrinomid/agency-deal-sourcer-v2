/**
 * All database operations go through Lovable's Supabase Edge Functions.
 * Trigger.dev does NOT have direct Supabase access.
 *
 * Single edge function: POST /functions/v1/update-search
 * Dispatches based on the `action` field in the request body.
 */

import type { SearchStatus } from "../types/inputs";
import type { RawProspect, Contact, ScoreBreakdown, FitLevel, AgencyProfile, ReviewStatus } from "../types/prospects";

// ============================================
// Edge Function Client
// ============================================

function getEdgeFunctionConfig(): { url: string; key: string } {
  const url = process.env.LOVABLE_SUPABASE_URL;
  const key = process.env.EDGE_FUNCTION_KEY;

  if (!url || !key) {
    throw new Error("LOVABLE_SUPABASE_URL and EDGE_FUNCTION_KEY must be configured");
  }

  return { url, key };
}

async function callEdgeFunction<T = any>(
  action: string,
  payload: Record<string, any>
): Promise<T> {
  const { url, key } = getEdgeFunctionConfig();

  const response = await fetch(`${url}/functions/v1/update-search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-edge-function-key": key,
    },
    body: JSON.stringify({ action, ...payload }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Edge function [${action}] failed: ${response.status} ${errorText}`);
    throw new Error(`Edge function [${action}] failed: ${response.status}`);
  }

  return response.json();
}

async function callEdgeFunctionSafe(
  action: string,
  payload: Record<string, any>
): Promise<void> {
  try {
    await callEdgeFunction(action, payload);
  } catch (error) {
    console.warn(`Edge function [${action}] failed (non-critical):`, error);
  }
}

// ============================================
// Search CRUD + Progress
// ============================================

export async function updateSearchStatus(
  searchId: string,
  status: SearchStatus,
  currentStep?: string,
  progressPct?: number
): Promise<void> {
  await callEdgeFunctionSafe("update_search_status", {
    searchId,
    status,
    currentStep,
    progressPct,
  });
}

export async function updateSearchCounts(
  searchId: string,
  counts: {
    totalDiscovered?: number;
    totalQualified?: number;
  }
): Promise<void> {
  await callEdgeFunctionSafe("update_search_counts", {
    searchId,
    ...counts,
  });
}

export async function updateSearchCursor(
  searchId: string,
  oceanSearchAfter: string | null
): Promise<void> {
  await callEdgeFunctionSafe("update_search_cursor", {
    searchId,
    oceanSearchAfter,
  });
}

export async function markSearchFailed(
  searchId: string,
  errorMessage: string
): Promise<void> {
  await callEdgeFunctionSafe("mark_search_failed", {
    searchId,
    errorMessage,
  });
}

// ============================================
// Agency CRUD (replaces Prospect CRUD)
// ============================================

/**
 * Upsert agencies and return a domain → id map.
 *
 * Each agency is upserted in its own edge-function call so the returned id is
 * unambiguously paired with its domain. A batch call returns a bare id array
 * whose length can differ from the input when two domains collapse on the
 * ON CONFLICT(domain) upsert — pairing those by array index silently crosses
 * agency identities (one company's data written onto another's row).
 */
export async function upsertAgencies(
  searchId: string,
  agencies: RawProspect[]
): Promise<Map<string, string>> {
  const domainToId = new Map<string, string>();
  const concurrency = 10;

  for (let i = 0; i < agencies.length; i += concurrency) {
    const chunk = agencies.slice(i, i + concurrency);
    const results = await Promise.all(
      chunk.map(async (agency) => {
        try {
          const result = await callEdgeFunction<{ ids: string[] }>("upsert_agencies", {
            searchId,
            agencies: [agency],
          });
          return { domain: agency.domain, id: result.ids?.[0] };
        } catch (error) {
          console.error(`upsert_agencies failed for ${agency.domain}:`, error);
          return { domain: agency.domain, id: undefined as string | undefined };
        }
      })
    );
    for (const { domain, id } of results) {
      if (id) domainToId.set(domain, id);
      else console.warn(`upsert_agencies returned no id for ${domain} — agency skipped`);
    }
  }

  return domainToId;
}

export async function updateAgencyEnrichment(
  agencyId: string,
  enrichmentStatus: "enriching" | "complete" | "failed",
  enrichmentData?: Record<string, any>,
  denormalized?: {
    companyName?: string | null;
    description?: string | null;
    industry?: string | null;
    employeeCount?: number | null;
    foundedYear?: number | null;
    location?: string | null;
    linkedinUrl?: string | null;
    technologies?: string[] | null;
    services?: string[] | null;
    revenueEstimate?: number | null;
  }
): Promise<void> {
  await callEdgeFunctionSafe("update_agency_enrichment", {
    agencyId,
    enrichmentStatus,
    enrichmentData,
    denormalized,
  });
}

export async function updateAgencyProfile(
  agencyId: string,
  agencyProfile: AgencyProfile
): Promise<void> {
  await callEdgeFunctionSafe("update_agency_profile", {
    agencyId,
    agencyProfile,
  });
}

export async function updateAgencyScores(
  agencyId: string,
  totalScore: number,
  fitLevel: FitLevel,
  scores: ScoreBreakdown,
  signals: string[]
): Promise<void> {
  await callEdgeFunctionSafe("update_agency_scores", {
    agencyId,
    totalScore,
    fitLevel,
    scores,
    signals,
  });
}

export async function updateAgencyDraftMessages(
  agencyId: string,
  draftMessageRapport: string,
  draftMessageDirect: string
): Promise<void> {
  await callEdgeFunctionSafe("update_agency_draft_messages", {
    agencyId,
    draftMessageRapport,
    draftMessageDirect,
  });
}

export async function updateAgencyReviewStatus(
  agencyId: string,
  reviewStatus: ReviewStatus
): Promise<void> {
  await callEdgeFunctionSafe("update_agency_review_status", {
    agencyId,
    reviewStatus,
  });
}

export async function updateAgencyPipedrive(
  agencyId: string,
  orgId: number
): Promise<void> {
  await callEdgeFunctionSafe("update_agency_pipedrive", {
    agencyId,
    orgId,
  });
}

// ============================================
// Contact CRUD (globally unique, with junction)
// ============================================

/**
 * Upsert contacts globally (dedup by email, then linkedin_url).
 * Links each contact to the specified agency via agency_contacts junction.
 * Returns contact IDs in the same order as the input array.
 */
export async function upsertContacts(
  agencyId: string,
  contacts: Omit<Contact, "id" | "pipedrivePersonId" | "pipedriveLabel" | "pipedrivePushedAt" | "heyreachLeadId" | "heyreachCampaignId" | "heyreachPushedAt">[]
): Promise<string[]> {
  const result = await callEdgeFunction<{ ids: string[] }>("upsert_contacts", {
    agencyId,
    contacts,
  });

  return result.ids || [];
}

export async function updateContactPipedrive(
  contactId: string,
  personId: number,
  label: string
): Promise<void> {
  await callEdgeFunctionSafe("update_contact_pipedrive", {
    contactId,
    personId,
    label,
  });
}

export async function updateContactHeyreach(
  contactId: string,
  leadId: string,
  campaignId: string
): Promise<void> {
  await callEdgeFunctionSafe("update_contact_heyreach", {
    contactId,
    leadId,
    campaignId,
  });
}

// ============================================
// Search-Agency Junction
// ============================================

export async function insertSearchAgencies(
  searchId: string,
  agencyIds: string[],
  wasRediscovery: boolean = false
): Promise<void> {
  await callEdgeFunctionSafe("insert_search_agencies", {
    searchId,
    agencyIds,
    wasRediscovery,
  });
}

// ============================================
// Dedup Queries (Agency-Centric)
// ============================================

/**
 * Returns domains where review_status IN ('blacklisted', 'approved', 'pending_review').
 * These agencies should be excluded from new search results.
 */
export async function getExcludedDomains(
  domains: string[]
): Promise<Set<string>> {
  try {
    const result = await callEdgeFunction<{ domains: string[] }>(
      "get_excluded_domains",
      { domains }
    );
    return new Set(result.domains || []);
  } catch {
    return new Set();
  }
}

/**
 * Returns skipped agencies matching the given domains.
 * These can be rediscovered (reset to pending_review, re-enrich, re-score).
 */
export async function getSkippedAgencies(
  domains: string[]
): Promise<{ id: string; domain: string }[]> {
  try {
    const result = await callEdgeFunction<{ agencies: { id: string; domain: string }[] }>(
      "get_skipped_agencies",
      { domains }
    );
    return result.agencies || [];
  } catch {
    return [];
  }
}

/**
 * Rediscover a skipped agency: reset to pending_review, clear enrichment data,
 * link to the new search via search_agencies junction.
 */
export async function rediscoverAgency(
  agencyId: string,
  searchId: string
): Promise<void> {
  await callEdgeFunctionSafe("rediscover_agency", {
    agencyId,
    searchId,
  });
}

export async function getAgenciesBySearchId(
  searchId: string
): Promise<any[]> {
  try {
    const result = await callEdgeFunction<{ agencies: any[] }>(
      "get_agencies_by_search",
      { searchId }
    );
    return result.agencies || [];
  } catch {
    return [];
  }
}

// ============================================
// Progress Notification
// ============================================

export async function notifyLovableProgress(
  searchId: string,
  status: SearchStatus,
  statusMessage?: string,
  errorMessage?: string
): Promise<void> {
  await callEdgeFunctionSafe("notify_progress", {
    searchId,
    status,
    statusMessage,
    errorMessage,
  });
}
