import { z } from "zod";

// Query type: natural language search, domain lookalike, or CSV bulk import
export const QueryTypeSchema = z.enum(["natural_language", "domain_lookalike", "csv_upload"]);
export type QueryType = z.infer<typeof QueryTypeSchema>;

// Search status progression
export const SearchStatusSchema = z.enum([
  "pending",
  "discovering",
  "enriching",
  "profiling",
  "scoring",
  "complete",
  "failed",
]);
export type SearchStatus = z.infer<typeof SearchStatusSchema>;

// Scoring configuration (optional overrides)
export const ScoringConfigSchema = z.object({
  revenue: z.object({
    min: z.number().default(750000),
    max: z.number().default(15000000),
    idealMin: z.number().default(2500000),
    idealMax: z.number().default(7000000),
    weight: z.number().default(0.25),
  }).optional(),
  teamSize: z.object({
    max: z.number().default(75),
    idealMax: z.number().default(40),
    weight: z.number().default(0.15),
  }).optional(),
  specialization: z.object({
    preferredNiches: z.array(z.string()).default([
      "hubspot",
      "revops",
      "marketing-automation",
      "b2b-saas",
      "content-marketing",
      "podcast-production",
      "demand-generation",
      "account-based-marketing",
      "marketing-operations",
    ]),
    weight: z.number().default(0.20),
  }).optional(),
  founderLed: z.object({
    weight: z.number().default(0.20),
  }).optional(),
  b2bFocus: z.object({
    weight: z.number().default(0.20),
  }).optional(),
  thresholds: z.object({
    highFit: z.number().default(75),
    mediumFit: z.number().default(50),
  }).optional(),
}).optional();

export type ScoringConfig = z.infer<typeof ScoringConfigSchema>;

// Main task input schema
export const AgencySourcerInputSchema = z.object({
  // Core identifiers
  searchId: z.string().uuid(),

  // Query
  queryType: QueryTypeSchema,
  queryText: z.string().optional(),
  seedDomains: z.array(z.string()).optional(),

  // Optional scoring config overrides
  scoringConfig: ScoringConfigSchema,

  // Limits
  maxResults: z.number().default(50),

  // Pagination cursor from Ocean.io (for "Load More" on same search)
  searchAfter: z.string().optional(),

  // Batch info for CSV uploads (Lovable splits large lists into batches)
  batchIndex: z.number().optional(),
  totalBatches: z.number().optional(),
});

export type AgencySourcerInput = z.infer<typeof AgencySourcerInputSchema>;

// ============================================
// Single-entity enrich + route ("Quick Add")
// ============================================

// Ad-hoc flow: enrich one company, or one named person at a company, then
// stage it for review (Approve → HeyReach). Skips discovery — the domain is
// supplied directly. The Lovable UI creates the `searches` row and triggers
// the `enrich-and-route` task with that searchId.
export const EnrichAndRouteInputSchema = z.object({
  // The searches row created for this single-entity add
  searchId: z.string().uuid(),

  // "company" → target the founder/decision-maker, like the batch flow
  // "person"  → target the specifically named person
  inputType: z.enum(["company", "person"]),

  // Company domain — required for both (a person is identified by name + domain)
  domain: z.string(),

  // Person identity — required when inputType === "person"
  personName: z.string().optional(),
  personTitle: z.string().optional(),

  // Optional scoring config overrides (same shape as the batch flow)
  scoringConfig: ScoringConfigSchema,
});

export type EnrichAndRouteInput = z.infer<typeof EnrichAndRouteInputSchema>;
