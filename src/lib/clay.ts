import { wait } from "@trigger.dev/sdk";
import type { ClayEnrichmentData, ClayPerson } from "../types/prospects";

/**
 * Enrich a single domain via Clay webhook + Trigger.dev wait token.
 * Clay sends enriched data back to the callback URL.
 * Returns null on timeout or failure.
 */
export async function enrichWithClay(
  domain: string,
  companyName: string | null,
  searchId: string
): Promise<ClayEnrichmentData | null> {
  const clayWebhookUrl = process.env.CLAY_AGENCY_WEBHOOK_URL;
  if (!clayWebhookUrl) {
    throw new Error("CLAY_AGENCY_WEBHOOK_URL not configured");
  }

  console.log(`Clay enrichment: ${domain}`);

  // Create a wait token with 5 minute timeout
  const token = await wait.createToken({
    idempotencyKey: `clay-enrich-${searchId}-${domain}`,
    timeout: "5m",
  });

  console.log(`Clay callback URL created for ${domain}`);

  // Send to Clay webhook
  const response = await fetch(clayWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      domain,
      companyName: companyName || domain,
      searchId,
      callbackUrl: token.url,
    }),
  });

  if (!response.ok) {
    console.error(`Clay webhook failed for ${domain}: ${response.status}`);
    return null;
  }

  console.log(`Sent ${domain} to Clay, waiting for callback...`);

  // Wait for Clay to POST back the enriched data
  try {
    const rawData = await wait.forToken<Record<string, any>>(token);

    if (!rawData || rawData.ok === false) {
      console.warn(`Clay returned no data or error for ${domain}`);
      return null;
    }

    // Clay wraps response in { ok: true, output: { ... } } — unwrap if needed
    const data = rawData.output || rawData;
    return normalizeClayResponse(data);
  } catch (error) {
    console.error(`Clay enrichment failed/timed out for ${domain}:`, error);
    return null;
  }
}

/**
 * Normalize Clay's response into our standard ClayEnrichmentData format.
 * Clay column names may vary — this maps common field names.
 */
function normalizeClayResponse(raw: Record<string, any>): ClayEnrichmentData {
  // Extract people array — Clay may return as "people", "founders", "contacts", etc.
  // Claygent may return a string like "No results found" instead of an array
  const rawPeopleField = raw.people || raw.founders || raw.contacts;
  const rawPeople: any[] = Array.isArray(rawPeopleField) ? rawPeopleField : [];

  const people: ClayPerson[] = rawPeople.map((p: any) => ({
    fullName: p.fullName || p.full_name || `${p.firstName || p.first_name || ""} ${p.lastName || p.last_name || ""}`.trim(),
    firstName: p.firstName || p.first_name || null,
    lastName: p.lastName || p.last_name || null,
    title: p.title || p.jobTitle || p.job_title || null,
    linkedinUrl: p.linkedinUrl || p.linkedin_url || p.linkedin || null,
    email: p.email || p.workEmail || p.work_email || null,
    phone: p.phone || p.mobile || p.mobilePhone || null,
    isFounder: Boolean(p.isFounder || p.is_founder),
    isCeo: Boolean(p.isCeo || p.is_ceo),
    isOwner: Boolean(p.isOwner || p.is_owner),
  }));

  // Parse technologies/services from string or array
  const parseTags = (val: any): string[] | null => {
    if (!val) return null;
    if (Array.isArray(val)) return val;
    if (typeof val === "string") return val.split(/[;,]/).map((s: string) => s.trim()).filter(Boolean);
    return null;
  };

  return {
    companyName: raw.companyName || raw.company_name || raw.name || null,
    description: raw.description || raw.companyDescription || raw.company_description || null,
    industry: raw.industry || null,
    employeeCount: parseNumber(raw.employeeCount || raw.employee_count || raw.employees),
    foundedYear: parseNumber(raw.foundedYear || raw.founded_year || raw.founded),
    location: raw.location || raw.headquarters || raw.hq || null,
    linkedinUrl: raw.linkedinUrl || raw.linkedin_url || raw.companyLinkedin || null,
    technologies: parseTags(raw.technologies || raw.tech_stack),
    services: parseTags(raw.services || raw.specializations),
    revenueEstimate: parseNumber(raw.revenueEstimate || raw.revenue_estimate || raw.revenue || raw.annualRevenue),
    people,
  };
}

function parseNumber(val: any): number | null {
  if (val === null || val === undefined) return null;
  const num = typeof val === "number" ? val : Number(val);
  return isNaN(num) ? null : num;
}
