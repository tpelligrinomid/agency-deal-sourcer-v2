import { task } from "@trigger.dev/sdk";
import type { EnrichAndRouteInput } from "../src/types/inputs";
import type { EnrichedAgency, RawProspect } from "../src/types/prospects";
import {
  updateSearchStatus,
  updateSearchCounts,
  markSearchFailed,
  upsertAgencies,
  insertSearchAgencies,
  notifyLovableProgress,
} from "../src/lib/supabase";
import { processAgency } from "./process-agency";

/**
 * Ad-hoc single-entity task: enrich one company (or one named person at a
 * company) and stage it for review — no discovery step.
 *
 * The Lovable "Quick Add" form creates a `searches` row, then triggers this
 * task with that searchId. The entity is enriched, profiled, scored, and a
 * personalized message is generated, then it surfaces in the normal review
 * UI. HeyReach push happens later, on Approve — same as the batch flow.
 *
 * For inputType "person", the specifically-named person is resolved (Ocean.io
 * → Apollo) and used as the outreach target. If their LinkedIn URL can't be
 * found they are still staged, flagged for manual entry before approval.
 */
export const enrichAndRoute = task({
  id: "enrich-and-route",
  maxDuration: 600,
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 2000,
    maxTimeoutInMs: 30000,
    factor: 2,
  },
  onFailure: async ({ payload, error }) => {
    const { searchId } = payload;
    const errorMessage = error instanceof Error ? error.message : "Task failed or timed out";
    console.error(`onFailure for enrich-and-route ${searchId}: ${errorMessage}`);
    await markSearchFailed(searchId, errorMessage);
    await notifyLovableProgress(searchId, "failed", undefined, errorMessage);
  },
  run: async (payload: EnrichAndRouteInput) => {
    const { searchId, inputType, domain, personName, personTitle, scoringConfig } = payload;

    const cleanDomain = domain
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/.*$/, "")
      .toLowerCase()
      .trim();

    console.log(
      `enrich-and-route: ${inputType} — ${cleanDomain}${personName ? ` (${personName})` : ""}`
    );

    try {
      if (!cleanDomain) {
        throw new Error("A valid company domain is required");
      }
      if (inputType === "person" && !personName) {
        throw new Error("personName is required when inputType is 'person'");
      }

      // ── Step 1: Persist the agency + link it to this search ─────────
      await updateSearchStatus(searchId, "discovering", `Adding ${cleanDomain}...`, 10);
      await notifyLovableProgress(searchId, "discovering", `Adding ${cleanDomain}...`);

      const prospect: RawProspect = {
        domain: cleanDomain,
        companyName: null,
        source: "ocean_lookalike", // enriched via Ocean.io, same as CSV uploads
        exaTitle: null,
        exaDescription: null,
        exaHighlights: null,
        exaScore: null,
        preEnriched: null,
      };

      const agencyMap = await upsertAgencies(searchId, [prospect]);
      const agencyId = agencyMap.get(cleanDomain);
      if (!agencyId) {
        throw new Error(`Failed to create agency row for ${cleanDomain}`);
      }
      await insertSearchAgencies(searchId, [agencyId], false);
      await updateSearchCounts(searchId, { totalDiscovered: 1 });

      const agency: EnrichedAgency = {
        id: agencyId,
        domain: cleanDomain,
        isRediscovery: false,
        companyName: null,
        description: null,
        industry: null,
        employeeCount: null,
        foundedYear: null,
        location: null,
        linkedinUrl: null,
        technologies: null,
        services: null,
        revenueEstimate: null,
        enrichmentStatus: "pending",
        enrichmentData: null,
        agencyProfile: null,
        contacts: [],
      };

      // ── Step 2: Enrich → profile → score → message (reuse process-agency) ──
      await updateSearchStatus(searchId, "enriching", `Enriching ${cleanDomain}...`, 35);
      await notifyLovableProgress(searchId, "enriching", `Enriching ${cleanDomain}...`);

      const result = await processAgency.triggerAndWait({
        agency,
        scoringConfig,
        targetPersonName: inputType === "person" ? personName : undefined,
        targetPersonTitle: inputType === "person" ? personTitle : undefined,
        forceMessage: true,
      });

      if (!result.ok) {
        throw new Error(`process-agency subtask failed for ${cleanDomain}`);
      }

      // ── Step 3: Complete — ready for review ─────────────────────────
      await updateSearchCounts(searchId, {
        totalQualified: result.output.fitLevel === "low" ? 0 : 1,
      });
      await updateSearchStatus(searchId, "complete", "Ready for review!", 100);
      await notifyLovableProgress(searchId, "complete", "Entity enriched — ready for review!");

      const summary = {
        success: true,
        searchId,
        agencyId,
        domain: cleanDomain,
        inputType,
        fitLevel: result.output.fitLevel,
        totalScore: result.output.totalScore,
        contacts: result.output.contacts.length,
      };
      console.log("enrich-and-route complete:", summary);
      return summary;
    } catch (error) {
      console.error(`enrich-and-route failed for ${cleanDomain}:`, error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      await markSearchFailed(searchId, errorMessage);
      await notifyLovableProgress(searchId, "failed", undefined, errorMessage);
      throw error;
    }
  },
});
