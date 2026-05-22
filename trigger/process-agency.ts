import { task } from "@trigger.dev/sdk";
import type {
  EnrichedAgency,
  ClayEnrichmentData,
  AgencyProfile,
  ClayPerson,
} from "../src/types/prospects";
import type { ScoringConfig } from "../src/types/inputs";
import { enrichWithOcean, findPersonByName, nameMatches } from "../src/lib/ocean";
import { scrapeAgencyWebsite } from "../src/lib/firecrawl";
import { generateAgencyProfile, generatePersonalizedMessages } from "../src/lib/claude";
import { scoreAgency } from "../src/lib/scoring";
import {
  updateAgencyEnrichment,
  updateAgencyProfile,
  updateAgencyScores,
  updateAgencyDraftMessages,
  upsertContacts,
} from "../src/lib/supabase";

export interface ProcessAgencyInput {
  agency: EnrichedAgency;
  scoringConfig?: ScoringConfig;
  // Ad-hoc enrich-and-route flow: when set, ensure this specific person is in
  // the contact set and use them as the outreach target.
  targetPersonName?: string;
  targetPersonTitle?: string;
  // Generate the outreach message even for low-fit agencies — ad-hoc adds are
  // deliberately chosen, so they always get a message.
  forceMessage?: boolean;
}

export interface ProcessAgencyOutput {
  agencyId: string;
  domain: string;
  companyName: string | null;
  fitLevel: string;
  totalScore: number;
  contacts: {
    contactId: string;
    fullName: string;
    firstName: string | null;
    lastName: string | null;
    title: string | null;
    linkedinUrl: string | null;
    email: string | null;
  }[];
  agencyProfile: AgencyProfile | null;
}

/**
 * Build a placeholder contact from a user-supplied name/title when the person
 * can't be resolved to a real profile. Staged so the user can fill in the
 * LinkedIn URL during review before approving.
 */
function makePersonStub(name: string, title?: string | null): ClayPerson {
  const parts = name.trim().split(/\s+/);
  const t = (title || "").toLowerCase();
  return {
    fullName: name.trim(),
    firstName: parts[0] || null,
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : null,
    title: title || null,
    linkedinUrl: null,
    email: null,
    phone: null,
    isFounder: t.includes("founder"),
    isCeo: t.includes("ceo") || t.includes("chief executive"),
    isOwner: t.includes("owner") || t.includes("principal"),
  };
}

/**
 * Upsert people as contacts for an agency and return the review-output rows.
 */
async function stageContacts(
  agencyId: string,
  people: ClayPerson[]
): Promise<ProcessAgencyOutput["contacts"]> {
  if (people.length === 0) return [];

  const inserts = people.map((person) => ({
    fullName: person.fullName,
    firstName: person.firstName,
    lastName: person.lastName,
    title: person.title,
    email: person.email,
    phone: person.phone,
    linkedinUrl: person.linkedinUrl,
    isFounder: person.isFounder,
    isCeo: person.isCeo,
    isOwner: person.isOwner,
  }));

  const ids = await upsertContacts(agencyId, inserts);
  return ids.map((contactId, i) => ({
    contactId,
    fullName: inserts[i].fullName,
    firstName: inserts[i].firstName,
    lastName: inserts[i].lastName,
    title: inserts[i].title,
    linkedinUrl: inserts[i].linkedinUrl,
    email: inserts[i].email,
  }));
}

/**
 * Per-agency processing subtask: enrich → profile → score → generate messages.
 *
 * Fan-out from run-agency-sourcer — each agency gets its own run with
 * independent retries and duration limits. Concurrency is capped at the
 * queue level so we don't overwhelm external APIs.
 */
export const processAgency = task({
  id: "process-agency",
  queue: {
    concurrencyLimit: 10,
  },
  maxDuration: 300, // 5 minutes per agency is plenty
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 2000,
    maxTimeoutInMs: 15000,
    factor: 2,
  },
  run: async (payload: ProcessAgencyInput): Promise<ProcessAgencyOutput> => {
    const { agency, scoringConfig, targetPersonName, targetPersonTitle, forceMessage } = payload;
    const contactRows: ProcessAgencyOutput["contacts"] = [];

    // ── Step 1: Enrich ──────────────────────────────────────────────
    let enrichmentData: ClayEnrichmentData | null;

    if (agency.enrichmentStatus === "complete" && agency.enrichmentData) {
      // Pre-enriched from Ocean.io lookalike — only fetch people
      console.log(`${agency.domain}: pre-enriched from lookalike, fetching people...`);
      await updateAgencyEnrichment(agency.id, "enriching");

      const fullEnrichment = await enrichWithOcean(agency.domain, agency.companyName);
      if (fullEnrichment) {
        enrichmentData = {
          ...agency.enrichmentData,
          people: fullEnrichment.people,
        };
      } else {
        enrichmentData = agency.enrichmentData;
      }
    } else {
      await updateAgencyEnrichment(agency.id, "enriching");
      enrichmentData = await enrichWithOcean(agency.domain, agency.companyName);
    }

    if (enrichmentData) {
      agency.enrichmentStatus = "complete";
      agency.enrichmentData = enrichmentData;
      agency.companyName = enrichmentData.companyName || agency.companyName;
      agency.description = enrichmentData.description;
      agency.industry = enrichmentData.industry;
      agency.employeeCount = enrichmentData.employeeCount;
      agency.foundedYear = enrichmentData.foundedYear;
      agency.location = enrichmentData.location;
      agency.linkedinUrl = enrichmentData.linkedinUrl;
      agency.technologies = enrichmentData.technologies;
      agency.services = enrichmentData.services;
      agency.revenueEstimate = enrichmentData.revenueEstimate;
      agency.contacts = enrichmentData.people || [];

      // Ad-hoc person flow: make sure the specifically-named person is in the
      // contact set, even if Ocean's founder/C-suite search missed them.
      if (targetPersonName) {
        const people = enrichmentData.people || [];
        const alreadyPresent = people.some((p) => nameMatches(p.fullName, targetPersonName));
        if (!alreadyPresent) {
          console.log(`${agency.domain}: "${targetPersonName}" not in enrichment — resolving directly`);
          const resolved = await findPersonByName(agency.domain, targetPersonName);
          // Resolved person, or a stub flagged for manual LinkedIn URL entry.
          people.unshift(resolved || makePersonStub(targetPersonName, targetPersonTitle));
          enrichmentData.people = people;
          agency.contacts = people;
        }
      }

      await updateAgencyEnrichment(agency.id, "complete", enrichmentData as any, {
        companyName: agency.companyName,
        description: agency.description,
        industry: agency.industry,
        employeeCount: agency.employeeCount,
        foundedYear: agency.foundedYear,
        location: agency.location,
        linkedinUrl: agency.linkedinUrl,
        technologies: agency.technologies,
        services: agency.services,
        revenueEstimate: agency.revenueEstimate,
      });

      // Upsert contacts
      if (enrichmentData.people && enrichmentData.people.length > 0) {
        contactRows.push(...(await stageContacts(agency.id, enrichmentData.people)));
      }
    } else {
      agency.enrichmentStatus = "failed";
      await updateAgencyEnrichment(agency.id, "failed");

      // Ad-hoc person flow: even when company enrichment fails entirely, still
      // stage the named person so the user can review and complete them.
      if (targetPersonName) {
        const resolved = await findPersonByName(agency.domain, targetPersonName);
        const person = resolved || makePersonStub(targetPersonName, targetPersonTitle);
        contactRows.push(...(await stageContacts(agency.id, [person])));
        agency.contacts = [person];
      }
    }

    // ── Step 2: Profile ─────────────────────────────────────────────
    try {
      const websiteContent = await scrapeAgencyWebsite(agency.domain);

      if (websiteContent) {
        const profile: AgencyProfile = await generateAgencyProfile(
          agency.domain,
          websiteContent,
          {
            companyName: agency.companyName,
            industry: agency.industry,
            employeeCount: agency.employeeCount,
            services: agency.services,
            revenueEstimate: agency.revenueEstimate,
          }
        );

        agency.agencyProfile = profile;
        await updateAgencyProfile(agency.id, profile);
      } else {
        console.warn(`No website content for ${agency.domain}, skipping profile`);
      }
    } catch (error) {
      console.error(`Profiling failed for ${agency.domain}:`, error);
    }

    // ── Step 3: Score ───────────────────────────────────────────────
    const scored = scoreAgency(agency, scoringConfig);

    await updateAgencyScores(
      agency.id,
      scored.totalScore,
      scored.fitLevel,
      scored.scores,
      scored.scoringSignals
    );

    // ── Step 4: Generate messages ───────────────────────────────────
    // Qualified (high/medium) agencies, or any agency in the ad-hoc flow
    // (forceMessage) — those are deliberately chosen and always get a message.
    if (scored.fitLevel !== "low" || forceMessage) {
      const titleMatch = (title: string | null, keyword: string) =>
        (title || "").toLowerCase().includes(keyword);

      // Ad-hoc person flow targets the named person; otherwise the most senior
      // decision-maker by title.
      const targetContact =
        (targetPersonName
          ? contactRows.find((c) => nameMatches(c.fullName, targetPersonName))
          : undefined) ||
        contactRows.find(
          (c) =>
            titleMatch(c.title, "founder") ||
            titleMatch(c.title, "ceo") ||
            titleMatch(c.title, "owner") ||
            titleMatch(c.title, "principal") ||
            titleMatch(c.title, "president") ||
            titleMatch(c.title, "managing director")
        ) ||
        contactRows[0];

      if (targetContact && agency.agencyProfile) {
        try {
          const messages = await generatePersonalizedMessages(
            targetContact.fullName,
            agency.agencyProfile,
            agency.companyName || agency.domain,
            agency.domain
          );

          await updateAgencyDraftMessages(agency.id, messages.rapport, messages.direct);
        } catch (error) {
          console.error(`Message generation failed for ${agency.domain}:`, error);
        }
      }
    }

    console.log(`${agency.domain}: done (${scored.fitLevel}, score=${scored.totalScore})`);

    return {
      agencyId: agency.id,
      domain: agency.domain,
      companyName: agency.companyName,
      fitLevel: scored.fitLevel,
      totalScore: scored.totalScore,
      contacts: contactRows,
      agencyProfile: agency.agencyProfile,
    };
  },
});
