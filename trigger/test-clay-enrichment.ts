import { task } from "@trigger.dev/sdk";
import { enrichWithOcean } from "../src/lib/ocean";

/**
 * Dev utility: Test Ocean.io enrichment for a single domain.
 * Returns company data + founders/C-suite.
 */
export const testOceanEnrichment = task({
  id: "test-ocean-enrichment",
  run: async (payload: { domain: string; companyName?: string }) => {
    console.log(`Testing Ocean.io enrichment for ${payload.domain}`);

    const enrichedData = await enrichWithOcean(
      payload.domain,
      payload.companyName || null
    );

    if (!enrichedData) {
      console.log("No data returned from Ocean.io");
      return { success: false, domain: payload.domain };
    }

    console.log("Enriched data from Ocean.io:");
    console.log(JSON.stringify(enrichedData, null, 2));

    return {
      success: true,
      domain: payload.domain,
      enrichedData,
    };
  },
});
