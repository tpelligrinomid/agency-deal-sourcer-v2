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
