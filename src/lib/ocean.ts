/**
 * Ocean.io API integration + Apollo fallback for people search.
 * Replaces Clay for both company enrichment and people/founder lookup.
 *   1. Enrich Company (Ocean.io) — company data (industry, size, revenue, description, etc.)
 *   2. People Search (Ocean.io → Apollo fallback) — founders/owners/C-suite with LinkedIn URLs
 */

import type { ClayEnrichmentData, ClayPerson, RawProspect } from "../types/prospects";

const OCEAN_BASE_URL = "https://api.ocean.io/v2";

function getApiToken(): string {
  const token = process.env.OCEAN_IO_API_TOKEN;
  if (!token) throw new Error("OCEAN_IO_API_TOKEN not configured");
  return token;
}

// ============================================
// Company Enrichment
// ============================================

interface OceanCompanyResponse {
  domain?: string;
  name?: string;
  description?: string;
  industries?: string[];
  industryCategories?: string[];
  linkedinIndustry?: string;
  companySize?: string;
  employeeCountOcean?: number;
  employeeCountLinkedin?: number;
  revenue?: string;
  yearFounded?: number;
  technologies?: string[];
  technologyCategories?: string[];
  medias?: {
    linkedin?: { url?: string };
    [key: string]: any;
  };
  locations?: Array<{
    city?: string;
    state?: string;
    country?: string;
    address?: string;
  }>;
  [key: string]: any;
}

async function enrichCompany(domain: string, companyName: string | null): Promise<OceanCompanyResponse | null> {
  const apiToken = getApiToken();

  const body: Record<string, any> = {
    company: {
      domain,
      ...(companyName ? { name: companyName } : {}),
    },
  };

  console.log(`Ocean.io: enriching company ${domain}`);

  const response = await fetch(`${OCEAN_BASE_URL}/enrich/company?apiToken=${apiToken}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.warn(`Ocean.io enrich company failed for ${domain}: ${response.status} ${errorText}`);
    return null;
  }

  const result = await response.json();
  return result as OceanCompanyResponse;
}

// ============================================
// People Search (founders/owners/C-suite)
// ============================================

interface OceanPerson {
  name?: string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  jobTitleEnglish?: string;
  linkedinUrl?: string;
  seniorities?: string[];
  departments?: string[];
  country?: string;
  location?: string;
  photo?: string;
  summary?: string;
}

interface OceanPeopleSearchResponse {
  results?: Array<{
    people?: OceanPerson[];
    [key: string]: any;
  }>;
  people?: OceanPerson[];
  [key: string]: any;
}

async function fetchPeople(apiToken: string, body: Record<string, any>): Promise<OceanPerson[]> {
  const response = await fetch(`https://api.ocean.io/v3/search/people?apiToken=${apiToken}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.warn(`Ocean.io people search failed: ${response.status} ${errorText}`);
    return [];
  }

  const result: OceanPeopleSearchResponse = await response.json();
  console.log(`Ocean.io people search response keys: ${Object.keys(result).join(", ")}`);

  if (result.people && Array.isArray(result.people)) {
    return result.people;
  }

  if (result.results && Array.isArray(result.results)) {
    const allPeople: OceanPerson[] = [];
    for (const r of result.results) {
      if (r.people && Array.isArray(r.people)) {
        allPeople.push(...r.people);
      }
    }
    return allPeople;
  }

  // Log full response if we can't find people in it
  console.log(`Ocean.io people search raw response: ${JSON.stringify(result).slice(0, 500)}`);
  return [];
}

async function searchPeople(domain: string): Promise<OceanPerson[]> {
  const apiToken = getApiToken();

  const body = {
    companiesFilters: {
      includeDomains: [domain],
    },
    peopleFilters: {
      seniorities: ["Founder", "Owner", "C-Level"],
    },
    peoplePerCompany: 5,
    size: 10,
  };

  console.log(`Ocean.io: searching for founders/C-suite at ${domain}`);

  let people = await fetchPeople(apiToken, body);

  // If no results with seniority filter, try broad Ocean.io search
  if (people.length === 0) {
    console.log(`Ocean.io: no founders/C-suite found for ${domain}, retrying without seniority filter`);
    const broadBody = {
      companiesFilters: {
        includeDomains: [domain],
      },
      peoplePerCompany: 5,
      size: 10,
    };
    people = await fetchPeople(apiToken, broadBody);
  }

  // Check if any Ocean.io results have founder/owner/C-level tags
  const hasFounders = people.some((p) => {
    const seniorities = p.seniorities || [];
    const titleLower = (p.jobTitle || "").toLowerCase();
    return seniorities.includes("Founder") || seniorities.includes("Owner") || seniorities.includes("C-Level")
      || titleLower.includes("founder") || titleLower.includes("co-founder")
      || titleLower.includes("owner") || titleLower.includes("principal")
      || titleLower.includes("ceo") || titleLower.includes("chief")
      || titleLower.includes("managing director") || titleLower.includes("president");
  });

  // If no founders identified, supplement with Apollo
  if (!hasFounders) {
    console.log(`Ocean.io: ${people.length} people found but no founders/owners for ${domain}, supplementing with Apollo`);
    const apolloPeople = await searchPeopleApollo(domain);
    if (apolloPeople.length > 0) {
      // Dedupe by LinkedIn URL or name, Apollo results first (higher priority for founders)
      const existingUrls = new Set(people.filter((p) => p.linkedinUrl).map((p) => p.linkedinUrl));
      const existingNames = new Set(people.map((p) => (p.name || "").toLowerCase()));
      for (const ap of apolloPeople) {
        const isDupe = (ap.linkedinUrl && existingUrls.has(ap.linkedinUrl))
          || existingNames.has((ap.name || "").toLowerCase());
        if (!isDupe) {
          people.unshift(ap); // founders first
        }
      }
    }
  }

  return people;
}

// ============================================
// Apollo Fallback (people search)
// ============================================

interface ApolloPerson {
  id?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  title?: string;
  headline?: string;
  linkedin_url?: string;
  email?: string;
  seniority?: string;
  departments?: string[];
  city?: string;
  state?: string;
  country?: string;
  organization?: {
    name?: string;
    primary_domain?: string;
  };
}

async function searchPeopleApollo(domain: string, name?: string): Promise<OceanPerson[]> {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) {
    console.warn("Apollo: APOLLO_API_KEY not configured, skipping fallback");
    return [];
  }

  console.log(`Apollo: searching ${name ? `for "${name}"` : "for founders/C-suite"} at ${domain}`);

  try {
    // With a name, search by keyword across all seniorities; otherwise fall
    // back to the founder/owner/C-suite filter.
    const searchBody: Record<string, any> = {
      q_organization_domains_list: [domain],
      per_page: name ? 10 : 5,
    };
    if (name) {
      searchBody.q_keywords = name;
    } else {
      searchBody.person_seniorities = ["founder", "owner", "c_suite"];
    }

    const response = await fetch("https://api.apollo.io/api/v1/mixed_people/api_search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": apiKey,
      },
      body: JSON.stringify(searchBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`Apollo people search failed for ${domain}: ${response.status} ${errorText}`);
      return [];
    }

    const result = await response.json();
    const apolloPeople: ApolloPerson[] = result.people || [];

    console.log(`Apollo: found ${apolloPeople.length} people for ${domain}`);

    // Map Apollo format to OceanPerson format for consistent downstream handling
    return apolloPeople.map((p) => ({
      name: p.name || `${p.first_name || ""} ${p.last_name || ""}`.trim(),
      firstName: p.first_name,
      lastName: p.last_name,
      jobTitle: p.title,
      linkedinUrl: p.linkedin_url,
      seniorities: p.seniority ? [p.seniority] : [],
      country: p.country,
      location: [p.city, p.state, p.country].filter(Boolean).join(", ") || undefined,
    }));
  } catch (error) {
    console.error(`Apollo people search error for ${domain}:`, error);
    return [];
  }
}

// ============================================
// Person Lookup by Name (ad-hoc enrich-and-route flow)
// ============================================

/**
 * Map an Ocean.io / Apollo person record to the downstream ClayPerson shape.
 */
function oceanPersonToClayPerson(p: OceanPerson): ClayPerson {
  const seniorities = p.seniorities || [];
  const titleLower = (p.jobTitle || "").toLowerCase();

  return {
    fullName: p.name || `${p.firstName || ""} ${p.lastName || ""}`.trim(),
    firstName: p.firstName || null,
    lastName: p.lastName || null,
    title: p.jobTitle || null,
    linkedinUrl: p.linkedinUrl || null,
    email: null, // email reveal costs credits, skip for now
    phone: null,
    isFounder: seniorities.includes("Founder") || titleLower.includes("founder") || titleLower.includes("co-founder"),
    isCeo: titleLower.includes("ceo") || titleLower.includes("chief executive"),
    isOwner: seniorities.includes("Owner") || titleLower.includes("owner") || titleLower.includes("principal"),
  };
}

/** Normalize a name for loose comparison: lowercase, strip punctuation, collapse spaces. */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Loose name match — tolerates middle names, initials, and honorifics
 * ("Dr. Jane A. Smith" matches "Jane Smith"). Requires the first and last
 * token of `target` to both appear in `candidate`.
 */
export function nameMatches(candidate: string | null | undefined, target: string): boolean {
  if (!candidate) return false;
  const c = normalizeName(candidate);
  const t = normalizeName(target);
  if (!c || !t) return false;
  if (c === t) return true;

  const candidateTokens = new Set(c.split(" "));
  const targetTokens = t.split(" ");
  if (targetTokens.length >= 2) {
    return (
      candidateTokens.has(targetTokens[0]) &&
      candidateTokens.has(targetTokens[targetTokens.length - 1])
    );
  }
  return candidateTokens.has(targetTokens[0]);
}

/**
 * Resolve a specifically-named person at a company domain to a contact
 * record with (ideally) a LinkedIn URL. Used by the ad-hoc enrich-and-route
 * flow when the input is "name + company domain".
 *
 * Strategy:
 *   1. Ocean.io people search at the domain → match the name
 *   2. Apollo fallback → search by name + domain
 * Returns null if neither source can resolve the person.
 */
export async function findPersonByName(
  domain: string,
  personName: string
): Promise<ClayPerson | null> {
  const apiToken = getApiToken();

  const fullName = (p: OceanPerson) =>
    p.name || `${p.firstName || ""} ${p.lastName || ""}`.trim();

  // 1. Ocean.io: broad people search at the domain, then match the name.
  console.log(`Resolving "${personName}" at ${domain} — trying Ocean.io`);
  const oceanPeople = await fetchPeople(apiToken, {
    companiesFilters: { includeDomains: [domain] },
    peoplePerCompany: 25,
    size: 25,
  });
  const oceanMatch = oceanPeople.find((p) => nameMatches(fullName(p), personName));
  if (oceanMatch) {
    console.log(`Ocean.io: resolved "${personName}" at ${domain}`);
    return oceanPersonToClayPerson(oceanMatch);
  }

  // 2. Apollo fallback: search by name + domain.
  console.log(`Ocean.io: no match for "${personName}", trying Apollo`);
  const apolloPeople = await searchPeopleApollo(domain, personName);
  const apolloMatch = apolloPeople.find((p) => nameMatches(fullName(p), personName));
  if (apolloMatch) {
    console.log(`Apollo: resolved "${personName}" at ${domain}`);
    return oceanPersonToClayPerson(apolloMatch);
  }

  console.warn(`Could not resolve "${personName}" at ${domain} via Ocean.io or Apollo`);
  return null;
}

// ============================================
// Parse revenue string to number
// ============================================

function parseRevenueRange(revenue: string | null | undefined): number | null {
  if (!revenue) return null;
  // Ocean.io returns ranges like "1-10M", "10-50M", etc.
  const match = revenue.match(/(\d+)-(\d+)M/);
  if (match) {
    const low = parseInt(match[1], 10) * 1_000_000;
    const high = parseInt(match[2], 10) * 1_000_000;
    return Math.round((low + high) / 2);
  }
  const singleMatch = revenue.match(/(\d+)M/);
  if (singleMatch) {
    return parseInt(singleMatch[1], 10) * 1_000_000;
  }
  return null;
}

// ============================================
// Parse employee count from size range or number
// ============================================

function parseEmployeeCount(company: OceanCompanyResponse): number | null {
  // Prefer the numeric counts
  if (company.employeeCountOcean) return company.employeeCountOcean;
  if (company.employeeCountLinkedin) return company.employeeCountLinkedin;

  // Fall back to companySize range like "2-10", "11-50"
  if (company.companySize) {
    const match = company.companySize.match(/(\d+)-(\d+)/);
    if (match) {
      return Math.round((parseInt(match[1], 10) + parseInt(match[2], 10)) / 2);
    }
    const single = parseInt(company.companySize, 10);
    if (!isNaN(single)) return single;
  }

  return null;
}

// ============================================
// Main enrichment function (replaces Clay)
// ============================================

/**
 * Enrich a single domain via Ocean.io.
 * Calls enrich company + people search, returns data in the same
 * ClayEnrichmentData format the rest of the pipeline expects.
 */
export async function enrichWithOcean(
  domain: string,
  companyName: string | null
): Promise<ClayEnrichmentData | null> {
  try {
    // Run company enrichment and people search in parallel
    const [company, people] = await Promise.all([
      enrichCompany(domain, companyName),
      searchPeople(domain),
    ]);

    if (!company) {
      console.warn(`Ocean.io: no company data for ${domain}`);
      return null;
    }

    // Build location string from first location
    let location: string | null = null;
    if (company.locations && company.locations.length > 0) {
      const loc = company.locations[0];
      const parts = [loc.city, loc.state, loc.country].filter(Boolean);
      location = parts.length > 0 ? parts.join(", ") : null;
    }

    // Get LinkedIn URL
    const linkedinUrl = company.medias?.linkedin?.url || null;

    // Map Ocean.io people to ClayPerson format
    const mappedPeople: ClayPerson[] = people.map(oceanPersonToClayPerson);

    // Combine industries
    const industry = company.linkedinIndustry
      || (company.industries && company.industries.length > 0 ? company.industries[0] : null)
      || null;

    const result: ClayEnrichmentData = {
      companyName: company.name || companyName,
      description: company.description || null,
      industry,
      employeeCount: parseEmployeeCount(company),
      foundedYear: company.yearFounded || null,
      location,
      linkedinUrl,
      technologies: company.technologies || null,
      services: company.industryCategories || null,
      revenueEstimate: parseRevenueRange(company.revenue),
      people: mappedPeople.length > 0 ? mappedPeople : null,
    };

    console.log(`Ocean.io: enriched ${domain} — ${mappedPeople.length} people found`);
    return result;
  } catch (error) {
    console.error(`Ocean.io enrichment failed for ${domain}:`, error);
    return null;
  }
}

// ============================================
// Lookalike Company Search (replaces Exa findSimilar)
// ============================================

interface OceanSearchCompany {
  domain?: string;
  name?: string;
  description?: string;
  industries?: string[];
  industryCategories?: string[];
  linkedinIndustry?: string;
  companySize?: string;
  employeeCountOcean?: number;
  employeeCountLinkedin?: number;
  revenue?: string;
  yearFounded?: number;
  technologies?: string[];
  technologyCategories?: string[];
  medias?: {
    linkedin?: { url?: string };
    [key: string]: any;
  };
  locations?: Array<{
    city?: string;
    state?: string;
    country?: string;
    address?: string;
  }>;
  [key: string]: any;
}

interface OceanSearchCompaniesResponse {
  results?: Array<{
    companies?: OceanSearchCompany[];
    company?: OceanSearchCompany;
    score?: number;
    [key: string]: any;
  }>;
  companies?: OceanSearchCompany[];
  searchAfter?: string;
  [key: string]: any;
}

export interface LookalikeResult {
  prospects: RawProspect[];
  searchAfter: string | null;
}

/**
 * Search for lookalike companies via Ocean.io.
 * Uses firmographic similarity (industry, size, revenue, services, tech stack)
 * rather than text/content similarity like Exa findSimilar.
 *
 * Pass `searchAfter` cursor from a previous response to paginate.
 */
export async function searchLookalikes(
  seedDomains: string[],
  maxResults: number = 50,
  searchAfter?: string
): Promise<LookalikeResult> {
  const apiToken = getApiToken();

  // Ocean.io supports up to 10 seed domains
  const domains = seedDomains.slice(0, 10);

  console.log(`Ocean.io: searching for lookalikes of [${domains.join(", ")}] (max ${maxResults})${searchAfter ? " (paginated)" : ""}`);

  const body: Record<string, any> = {
    size: Math.min(maxResults, 100),
    companiesFilters: {
      lookalikeDomains: domains,
    },
    ...(searchAfter ? { searchAfter } : {}),
  };

  const response = await fetch(`https://api.ocean.io/v3/search/companies?apiToken=${apiToken}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Ocean.io lookalike search failed: ${response.status} ${errorText}`);
    // Surface 4xx errors (plan limits, auth, bad request) so the user sees the real cause.
    // 5xx is treated as transient and returns empty so the search can continue with other sources.
    if (response.status >= 400 && response.status < 500) {
      throw new Error(`Ocean.io lookalike search rejected (${response.status}): ${errorText.slice(0, 300)}`);
    }
    return { prospects: [], searchAfter: null };
  }

  const result = await response.json();

  // DEBUG: Log the full response structure
  console.log(`Ocean.io lookalike response type: ${typeof result}`);
  console.log(`Ocean.io lookalike top-level keys: ${Object.keys(result).join(", ")}`);
  if (result.results && Array.isArray(result.results) && result.results.length > 0) {
    console.log(`Ocean.io lookalike results[0] keys: ${Object.keys(result.results[0]).join(", ")}`);
    console.log(`Ocean.io lookalike results[0]: ${JSON.stringify(result.results[0]).slice(0, 500)}`);
  }
  if (!result.results) {
    console.log(`Ocean.io lookalike full response (first 1000 chars): ${JSON.stringify(result).slice(0, 1000)}`);
  }

  // Extract companies from response — Ocean.io may return:
  //   { companies: [...] }                          — flat array of company objects
  //   { results: [{ companies: [...] }] }           — nested under results
  //   { results: [{ company: {...}, score }, ...] }  — each result wraps a single company
  let companies: OceanSearchCompany[] = [];

  if (result.companies && Array.isArray(result.companies)) {
    // Ocean.io may return companies as direct objects OR wrapped: { company: {...}, score }
    for (const item of result.companies) {
      if (item.company && typeof item.company === "object" && !item.domain) {
        companies.push(item.company as OceanSearchCompany);
      } else {
        companies.push(item);
      }
    }
  } else if (result.results && Array.isArray(result.results)) {
    for (const r of result.results) {
      if (r.companies && Array.isArray(r.companies)) {
        companies.push(...r.companies);
      } else if (r.company && typeof r.company === "object") {
        // Single company per result: { company: {...}, score: ... }
        companies.push(r.company as OceanSearchCompany);
      }
    }
  }

  // If still empty, log the response shape for debugging
  if (companies.length === 0) {
    console.log(`Ocean.io lookalike raw response keys: ${Object.keys(result).join(", ")}`);
    console.log(`Ocean.io lookalike raw response: ${JSON.stringify(result).slice(0, 500)}`);
  }

  console.log(`Ocean.io: found ${companies.length} lookalike companies`);

  // Map to RawProspect with pre-enriched company data
  const prospects: RawProspect[] = [];

  // Debug: log first few companies to see what fields are present
  for (let i = 0; i < Math.min(3, companies.length); i++) {
    const c = companies[i];
    console.log(`Ocean.io company[${i}]: domain=${c.domain}, name=${c.name}, keys=${Object.keys(c).join(",")}`);
  }

  let skippedNoDomain = 0;
  let skippedSeedMatch = 0;

  for (const company of companies) {
    if (!company.domain) {
      skippedNoDomain++;
      continue;
    }

    const domain = company.domain.replace(/^www\./, "").toLowerCase();

    // Skip seed domains themselves
    if (seedDomains.some((s) => s.replace(/^www\./, "").toLowerCase() === domain)) {
      skippedSeedMatch++;
      continue;
    }

    // Build location string
    let location: string | null = null;
    if (company.locations && company.locations.length > 0) {
      const loc = company.locations[0];
      const parts = [loc.city, loc.state, loc.country].filter(Boolean);
      location = parts.length > 0 ? parts.join(", ") : null;
    }

    const linkedinUrl = company.medias?.linkedin?.url || null;
    const industry = company.linkedinIndustry
      || (company.industries && company.industries.length > 0 ? company.industries[0] : null)
      || null;

    prospects.push({
      domain,
      companyName: company.name || null,
      source: "ocean_lookalike",
      exaTitle: null,
      exaDescription: company.description || null,
      exaHighlights: null,
      exaScore: null,
      preEnriched: {
        companyName: company.name || null,
        description: company.description || null,
        industry,
        employeeCount: parseEmployeeCount(company as OceanCompanyResponse),
        foundedYear: company.yearFounded || null,
        location,
        linkedinUrl,
        technologies: company.technologies || null,
        services: company.industryCategories || null,
        revenueEstimate: parseRevenueRange(company.revenue),
        people: null, // People are fetched separately during enrichment
      },
    });
  }

  const nextCursor: string | null = result.searchAfter || null;
  console.log(`Ocean.io: ${prospects.length} lookalike prospects (skipped: ${skippedNoDomain} no domain, ${skippedSeedMatch} seed match)${nextCursor ? " — has next page" : " — no more pages"}`);
  return { prospects, searchAfter: nextCursor };
}
