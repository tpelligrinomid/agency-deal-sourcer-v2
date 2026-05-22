import { task } from "@trigger.dev/sdk";
import type { AgencySourcerInput } from "../src/types/inputs";
import type {
  RawProspect,
  EnrichedAgency,
} from "../src/types/prospects";
import { interpretQuery } from "../src/lib/claude";
import { exaSearch, deduplicateProspects } from "../src/lib/exa";
import { searchLookalikes } from "../src/lib/ocean";
import {
  updateSearchStatus,
  updateSearchCounts,
  markSearchFailed,
  upsertAgencies,
  getExcludedDomains,
  getSkippedAgencies,
  rediscoverAgency,
  insertSearchAgencies,
  updateSearchCursor,
  notifyLovableProgress,
} from "../src/lib/supabase";
import { processAgency } from "./process-agency";

/**
 * Main orchestrator task: discover → dedup → save → fan-out per-agency processing.
 *
 * Agency-centric pipeline:
 * - Agencies persist globally (unique by domain)
 * - Searches are research sessions that feed the agency database
 * - Dedup uses three-tier logic: exclude (blacklisted/approved/pending), rediscover (skipped), insert (new)
 * - Per-agency work (enrich, profile, score, messages) is fanned out to processAgency subtasks
 *   running up to 10 in parallel — no more timeout issues with large batches
 *
 * Pipedrive push and HeyReach push are NOT part of this task.
 * They happen later:
 *   - HeyReach: when user clicks "Approve" in the review UI (via approve-agency edge function)
 *   - Pipedrive: when HeyReach fires "Connection Request Accepted" webhook (via heyreach-webhook edge function)
 */
export const runAgencySourcer = task({
  id: "run-agency-sourcer",
  maxDuration: 3600, // 1 hour — generous limit since most time is spent waiting on subtasks
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 2000,
    maxTimeoutInMs: 30000,
    factor: 2,
  },
  onFailure: async ({ payload, error }) => {
    // Runs even when the task is killed by MAX_DURATION_EXCEEDED
    const { searchId } = payload;
    const errorMessage = error instanceof Error ? error.message : "Task failed or timed out";
    console.error(`onFailure for ${searchId}: ${errorMessage}`);
    await markSearchFailed(searchId, errorMessage);
    await notifyLovableProgress(searchId, "failed", undefined, errorMessage);
  },
  run: async (payload: AgencySourcerInput) => {
    const { searchId, queryType, queryText, seedDomains, scoringConfig, maxResults, searchAfter, batchIndex, totalBatches } = payload;

    const batchLabel = totalBatches ? ` (batch ${(batchIndex || 0) + 1}/${totalBatches})` : "";
    console.log(`Starting agency sourcer: ${searchId}${batchLabel}`);
    console.log(`Query type: ${queryType}, max results: ${maxResults}${searchAfter ? ", paginated (Load More)" : ""}`);

    try {
      // ==========================================
      // Step 1: Interpret query (NL → Exa search strings)
      // ==========================================
      let searchQueries: string[] = [];
      let allProspects: RawProspect[] = [];
      let nextSearchAfter: string | null = null;

      if (queryType === "csv_upload") {
        // CSV upload: seedDomains IS the list — skip discovery entirely
        await updateSearchStatus(searchId, "discovering", `Processing CSV domains${batchLabel}...`, 10);
        await notifyLovableProgress(searchId, "discovering", `Processing CSV domains${batchLabel}...`);

        for (const domain of (seedDomains || [])) {
          const cleanDomain = domain.replace(/^www\./, "").toLowerCase().trim();
          if (cleanDomain) {
            allProspects.push({
              domain: cleanDomain,
              companyName: null,
              source: "ocean_lookalike", // will be enriched via Ocean.io
              exaTitle: null,
              exaDescription: null,
              exaHighlights: null,
              exaScore: null,
              preEnriched: null,
            });
          }
        }
        console.log(`CSV upload: ${allProspects.length} domains to process${batchLabel}`);
      } else {
        await updateSearchStatus(searchId, "discovering", "Interpreting search query...", 5);
        await notifyLovableProgress(searchId, "discovering", "Interpreting search query...");

        if (queryType === "natural_language" && queryText) {
          searchQueries = await interpretQuery(queryText);
          console.log(`Interpreted into ${searchQueries.length} search queries`);
        }

        // ==========================================
        // Step 2: Discover prospects
        //   - NL queries → Exa neural search
        //   - Domain lookalikes → Ocean.io firmographic similarity
        // ==========================================
        await updateSearchStatus(searchId, "discovering", "Discovering agencies...", 10);
        await notifyLovableProgress(searchId, "discovering", "Discovering agencies...");

        if (searchQueries.length > 0) {
          const perQuery = Math.ceil(maxResults / searchQueries.length);
          const searchResults = await exaSearch(searchQueries, perQuery);
          allProspects.push(...searchResults);
        }

        if (seedDomains && seedDomains.length > 0) {
          await updateSearchStatus(searchId, "discovering", "Finding lookalike companies via Ocean.io...", 12);
          const lookalikeResult = await searchLookalikes(seedDomains, maxResults, searchAfter);
          allProspects.push(...lookalikeResult.prospects);
          nextSearchAfter = lookalikeResult.searchAfter;
        }
      }

      console.log(`Total raw results: ${allProspects.length}`);

      // ==========================================
      // Step 3: Deduplicate (agency-centric)
      //   3a. Batch dedup (same-search duplicates)
      //   3b. getExcludedDomains → filter out blacklisted/approved/pending_review
      //   3c. getSkippedAgencies → identify rediscoverable agencies
      //   3d. Enforce maxResults
      // ==========================================
      await updateSearchStatus(searchId, "discovering", "Deduplicating results...", 15);

      // 3a. Batch dedup within this search
      let deduped = deduplicateProspects(allProspects);
      console.log(`After batch dedup: ${deduped.length}`);

      // 3b. Exclude blacklisted/approved/pending_review agencies
      const allDomains = deduped.map((p) => p.domain);
      const excludedDomains = await getExcludedDomains(allDomains);
      if (excludedDomains.size > 0) {
        deduped = deduped.filter((p) => !excludedDomains.has(p.domain));
        console.log(`After excluding existing agencies: ${deduped.length} (removed ${excludedDomains.size})`);
      }

      // 3c. Identify skipped agencies that can be rediscovered
      const remainingDomains = deduped.map((p) => p.domain);
      const skippedAgencies = await getSkippedAgencies(remainingDomains);
      const skippedDomainMap = new Map(skippedAgencies.map((a) => [a.domain, a.id]));
      console.log(`Found ${skippedAgencies.length} skipped agencies to rediscover`);

      // Separate new agencies from rediscoveries
      const newProspects = deduped.filter((p) => !skippedDomainMap.has(p.domain));
      const rediscoveryProspects = deduped.filter((p) => skippedDomainMap.has(p.domain));

      // 3d. Enforce maxResults (new + rediscoveries combined)
      const totalAvailable = newProspects.length + rediscoveryProspects.length;
      let finalNewProspects = newProspects;
      let finalRediscoveries = rediscoveryProspects;

      if (totalAvailable > maxResults) {
        // Prioritize new agencies, then fill with rediscoveries
        if (newProspects.length >= maxResults) {
          finalNewProspects = newProspects.slice(0, maxResults);
          finalRediscoveries = [];
        } else {
          finalRediscoveries = rediscoveryProspects.slice(0, maxResults - newProspects.length);
        }
      }

      console.log(`Final: ${finalNewProspects.length} new + ${finalRediscoveries.length} rediscoveries`);

      // ==========================================
      // Step 4: Save agencies to Supabase
      //   4a. Insert new agencies → upsertAgencies()
      //   4b. Rediscover skipped agencies → rediscoverAgency() for each
      //   4c. Insert search_agencies junction rows
      //   4d. Build enrichedAgencies array (both new + rediscovered)
      // ==========================================
      await updateSearchStatus(searchId, "discovering", "Saving discovered agencies...", 20);

      // 4a. Insert new agencies — returns a domain→id map so ids are paired
      // to prospects by domain, never by array index.
      const newAgencyMap = finalNewProspects.length > 0
        ? await upsertAgencies(searchId, finalNewProspects)
        : new Map<string, string>();

      // 4b. Rediscover skipped agencies
      const rediscoveredIds: string[] = [];
      for (const prospect of finalRediscoveries) {
        const agencyId = skippedDomainMap.get(prospect.domain)!;
        await rediscoverAgency(agencyId, searchId);
        rediscoveredIds.push(agencyId);
      }

      // 4c. Insert search_agencies junction rows
      const newAgencyIds = [...new Set(newAgencyMap.values())];
      if (newAgencyIds.length > 0) {
        await insertSearchAgencies(searchId, newAgencyIds, false);
      }
      if (rediscoveredIds.length > 0) {
        await insertSearchAgencies(searchId, rediscoveredIds, true);
      }

      const totalAgencies = newAgencyIds.length + rediscoveredIds.length;
      await updateSearchCounts(searchId, { totalDiscovered: totalAgencies });
      console.log(`Saved ${totalAgencies} agencies (${newAgencyIds.length} new, ${rediscoveredIds.length} rediscovered)`);

      // 4d. Build enrichedAgencies array
      //   New agencies: one per distinct domain, id looked up by domain — a
      //   domain that collapsed on upsert can never be paired with a wrong id.
      const prospectByDomain = new Map<string, RawProspect>();
      for (const p of finalNewProspects) prospectByDomain.set(p.domain, p);

      const newEnrichedAgencies: EnrichedAgency[] = [];
      for (const [domain, p] of prospectByDomain) {
        const id = newAgencyMap.get(domain);
        if (!id) {
          console.warn(`No agency id for ${domain} — excluded from processing`);
          continue;
        }
        const pre = p.preEnriched;
        newEnrichedAgencies.push({
          id,
          domain,
          isRediscovery: false,
          companyName: pre?.companyName || p.companyName,
          description: pre?.description || null,
          industry: pre?.industry || null,
          employeeCount: pre?.employeeCount || null,
          foundedYear: pre?.foundedYear || null,
          location: pre?.location || null,
          linkedinUrl: pre?.linkedinUrl || null,
          technologies: pre?.technologies || null,
          services: pre?.services || null,
          revenueEstimate: pre?.revenueEstimate || null,
          enrichmentStatus: pre ? "complete" as const : "pending" as const,
          enrichmentData: pre || null,
          agencyProfile: null,
          contacts: [],
        });
      }

      const enrichedAgencies: EnrichedAgency[] = [
        ...newEnrichedAgencies,
        // Rediscovered agencies (cleared enrichment, need full re-enrichment)
        ...finalRediscoveries.map((p, i) => ({
          id: rediscoveredIds[i],
          domain: p.domain,
          isRediscovery: true,
          companyName: p.companyName,
          description: null,
          industry: null,
          employeeCount: null,
          foundedYear: null,
          location: null,
          linkedinUrl: null,
          technologies: null,
          services: null,
          revenueEstimate: null,
          enrichmentStatus: "pending" as const,
          enrichmentData: null,
          agencyProfile: null,
          contacts: [],
        })),
      ];

      // ==========================================
      // Step 5: Fan-out per-agency processing
      //   Each agency is processed independently (enrich → profile → score → messages)
      //   running up to 10 in parallel via the process-agency subtask queue.
      // ==========================================
      await updateSearchStatus(searchId, "enriching", `Processing ${enrichedAgencies.length} agencies (up to 10 in parallel)...`, 25);
      await notifyLovableProgress(searchId, "enriching", `Processing ${enrichedAgencies.length} agencies...`);

      const batchItems = enrichedAgencies.map((agency) => ({
        payload: { agency, scoringConfig },
      }));

      console.log(`Fanning out ${batchItems.length} process-agency subtasks...`);

      // Collect results from completed subtasks
      const scoredResults: { agencyId: string; fitLevel: string; totalScore: number }[] = [];

      // batchTriggerAndWait rejects empty batches — short-circuit when no agencies
      // made it through discovery/dedup so the search completes cleanly.
      const batchResults = batchItems.length > 0
        ? await processAgency.batchTriggerAndWait(batchItems)
        : { runs: [] as any[] };

      for (const result of batchResults.runs) {
        if (result.ok && result.output) {
          scoredResults.push({
            agencyId: result.output.agencyId,
            fitLevel: result.output.fitLevel,
            totalScore: result.output.totalScore,
          });
        } else {
          console.error(`Subtask failed for run ${result.id}:`, result.ok ? "no output" : "error");
        }
      }

      const qualified = scoredResults.filter((a) => a.fitLevel === "high" || a.fitLevel === "medium");
      await updateSearchCounts(searchId, { totalQualified: qualified.length });

      console.log(`Processing complete. ${qualified.length} qualified out of ${scoredResults.length} (${batchResults.runs.length - scoredResults.length} failed)`);

      // ==========================================
      // Save Ocean.io pagination cursor (for "Load More")
      // ==========================================
      await updateSearchCursor(searchId, nextSearchAfter);

      // ==========================================
      // Complete — agencies are now ready for review
      // ==========================================
      await updateSearchStatus(searchId, "complete", "Ready for review!", 100);
      await notifyLovableProgress(searchId, "complete", "Search complete — agencies ready for review!");

      const summary = {
        searchId,
        totalDiscovered: totalAgencies,
        totalQualified: qualified.length,
        highFit: scoredResults.filter((a) => a.fitLevel === "high").length,
        mediumFit: scoredResults.filter((a) => a.fitLevel === "medium").length,
        lowFit: scoredResults.filter((a) => a.fitLevel === "low").length,
        rediscovered: rediscoveredIds.length,
      };

      console.log("Agency sourcer complete:", summary);

      return { success: true, ...summary };
    } catch (error) {
      console.error(`Agency sourcer failed for ${searchId}:`, error);

      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      await markSearchFailed(searchId, errorMessage);
      await notifyLovableProgress(searchId, "failed", undefined, errorMessage);

      throw error;
    }
  },
});
