import { task } from "@trigger.dev/sdk";
import type {
  EnrichedAgency,
  ClayEnrichmentData,
  AgencyProfile,
  ClayPerson,
} from "../src/types/prospects";
import type { ScoringConfig } from "../src/types/inputs";
import { enrichWithOcean } from "../src/lib/ocean";
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
    const { agency, scoringConfig } = payload;
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
        const contactInserts = enrichmentData.people.map((person) => ({
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

        const contactIds = await upsertContacts(agency.id, contactInserts);
        for (let ci = 0; ci < contactIds.length; ci++) {
          contactRows.push({
            contactId: contactIds[ci],
            fullName: contactInserts[ci].fullName,
            firstName: contactInserts[ci].firstName,
            lastName: contactInserts[ci].lastName,
            title: contactInserts[ci].title,
            linkedinUrl: contactInserts[ci].linkedinUrl,
            email: contactInserts[ci].email,
          });
        }
      }
    } else {
      agency.enrichmentStatus = "failed";
      await updateAgencyEnrichment(agency.id, "failed");
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

    // ── Step 4: Generate messages (qualified only) ──────────────────
    if (scored.fitLevel === "high" || scored.fitLevel === "medium") {
      const titleMatch = (title: string | null, keyword: string) =>
        (title || "").toLowerCase().includes(keyword);

      const targetContact =
        contactRows.find(
          (c) =>
            titleMatch(c.title, "founder") ||
            titleMatch(c.title, "ceo") ||
            titleMatch(c.title, "owner") ||
            titleMatch(c.title, "principal") ||
            titleMatch(c.title, "president") ||
            titleMatch(c.title, "managing director")
        ) || contactRows[0];

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
