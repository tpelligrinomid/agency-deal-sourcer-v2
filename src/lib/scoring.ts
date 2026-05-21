import type { EnrichedAgency, ScoreBreakdown, FitLevel, AgencyProfile } from "../types/prospects";
import type { ScoringConfig } from "../types/inputs";

// Default scoring configuration (matches Python criteria.yaml)
const DEFAULT_CONFIG = {
  revenue: {
    min: 750000,
    max: 15000000,
    idealMin: 2500000,
    idealMax: 7000000,
    weight: 0.25,
  },
  teamSize: {
    max: 75,
    idealMax: 40,
    weight: 0.15,
  },
  specialization: {
    preferredNiches: [
      "hubspot",
      "revops",
      "marketing-automation",
      "b2b-saas",
      "content-marketing",
      "podcast-production",
      "demand-generation",
      "account-based-marketing",
      "marketing-operations",
    ],
    weight: 0.20,
  },
  founderLed: {
    weight: 0.20,
  },
  b2bFocus: {
    weight: 0.20,
  },
  thresholds: {
    highFit: 75,
    mediumFit: 50,
  },
};

function mergeConfig(overrides?: ScoringConfig) {
  if (!overrides) return DEFAULT_CONFIG;
  return {
    revenue: { ...DEFAULT_CONFIG.revenue, ...overrides.revenue },
    teamSize: { ...DEFAULT_CONFIG.teamSize, ...overrides.teamSize },
    specialization: { ...DEFAULT_CONFIG.specialization, ...overrides.specialization },
    founderLed: { ...DEFAULT_CONFIG.founderLed, ...overrides.founderLed },
    b2bFocus: { ...DEFAULT_CONFIG.b2bFocus, ...overrides.b2bFocus },
    thresholds: { ...DEFAULT_CONFIG.thresholds, ...overrides.thresholds },
  };
}

function toList(value: any): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    return value.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Score revenue (0-100)
 */
function scoreRevenue(
  revenue: number | null | undefined,
  config: typeof DEFAULT_CONFIG.revenue,
  signals: string[]
): number {
  if (revenue === null || revenue === undefined) {
    signals.push("Revenue: unknown (neutral 50)");
    return 50;
  }

  if (revenue >= config.idealMin && revenue <= config.idealMax) {
    signals.push(`Revenue: $${(revenue / 1000000).toFixed(1)}M (ideal range, 100)`);
    return 100;
  }

  if (revenue >= config.min && revenue <= config.max) {
    signals.push(`Revenue: $${(revenue / 1000000).toFixed(1)}M (acceptable range, 70)`);
    return 70;
  }

  // Outside the acceptable range: decay gradually from 50 toward 0 over one
  // full band-width past the boundary, rather than a hard 0. A near-miss can
  // still compete on its other factors.
  const revM = (revenue / 1000000).toFixed(1);
  if (revenue > config.max) {
    const score = Math.max(0, Math.round(50 * (1 - (revenue - config.max) / config.max)));
    signals.push(`Revenue: $${revM}M (above $${(config.max / 1000000).toFixed(1)}M max, decayed ${score})`);
    return score;
  }

  const score = Math.max(0, Math.round(50 * (1 - (config.min - revenue) / config.min)));
  signals.push(`Revenue: $${revM}M (below $${(config.min / 1000000).toFixed(2)}M min, decayed ${score})`);
  return score;
}

/**
 * Score team size (0-100)
 */
function scoreTeamSize(
  employeeCount: number | null | undefined,
  config: typeof DEFAULT_CONFIG.teamSize,
  signals: string[]
): number {
  if (employeeCount === null || employeeCount === undefined) {
    signals.push("Team size: unknown (neutral 50)");
    return 50;
  }

  if (employeeCount <= config.idealMax) {
    signals.push(`Team size: ${employeeCount} (ideal ≤${config.idealMax}, 100)`);
    return 100;
  }

  if (employeeCount <= config.max) {
    signals.push(`Team size: ${employeeCount} (acceptable ${config.idealMax + 1}-${config.max}, 70)`);
    return 70;
  }

  // Above the max: decay gradually from 50 toward 0 over one full max-width
  // past the boundary, rather than a hard 0.
  const score = Math.max(0, Math.round(50 * (1 - (employeeCount - config.max) / config.max)));
  signals.push(`Team size: ${employeeCount} (above ${config.max} max, decayed ${score})`);
  return score;
}

/**
 * Score specialization (0-100)
 * Now uses both Clay services AND Firecrawl profile services/partnerships
 */
function scoreSpecialization(
  clayServices: string[] | null | undefined,
  profile: AgencyProfile | null,
  config: typeof DEFAULT_CONFIG.specialization,
  signals: string[]
): number {
  // Combine Clay services + Firecrawl profile services + partnerships
  const allServices: string[] = [
    ...toList(clayServices),
    ...(profile?.services || []),
    ...(profile?.partnerships || []),
  ];

  if (allServices.length === 0) {
    signals.push("Specialization: no services listed (neutral 50)");
    return 50;
  }

  const niches = config.preferredNiches;
  const matches: string[] = [];

  for (const service of allServices) {
    const serviceLower = service.toLowerCase();
    for (const niche of niches) {
      if (serviceLower.includes(niche.toLowerCase())) {
        matches.push(niche);
      }
    }
  }

  const uniqueMatches = [...new Set(matches)];

  if (uniqueMatches.length >= 2) {
    signals.push(`Specialization: ${uniqueMatches.length} niche matches (${uniqueMatches.join(", ")}), 100`);
    return 100;
  }

  if (uniqueMatches.length === 1) {
    signals.push(`Specialization: 1 niche match (${uniqueMatches[0]}), 75`);
    return 75;
  }

  signals.push("Specialization: 0 niche matches, 40");
  return 40;
}

/**
 * Score founder-led signals (0-100)
 * Uses Clay contacts + Firecrawl team info
 */
function scoreFounderLed(
  contacts: { isFounder: boolean; isCeo: boolean }[],
  profile: AgencyProfile | null,
  signals: string[]
): number {
  let score = 50;

  const founders = contacts.filter((c) => c.isFounder);
  if (founders.length > 0) {
    score += 25;
    signals.push(`Founder-led: ${founders.length} founder(s) found (+25)`);

    const founderCeo = founders.some((f) => f.isCeo);
    if (founderCeo) {
      score += 25;
      signals.push("Founder-led: founder is CEO (+25)");
    }
  } else if (profile?.teamInfo) {
    // Check Firecrawl team info for founder signals
    const teamLower = profile.teamInfo.toLowerCase();
    if (teamLower.includes("founder") || teamLower.includes("owner")) {
      score += 25;
      signals.push("Founder-led: founder mentioned in team info (+25)");
    }
  } else {
    signals.push("Founder-led: no founders identified (base 50)");
  }

  return Math.min(score, 100);
}

/**
 * Score B2B focus (0-100)
 * Uses Clay data + Firecrawl profile industries and clients
 */
function scoreB2bFocus(
  description: string | null | undefined,
  industry: string | null | undefined,
  clayServices: string[] | null | undefined,
  profile: AgencyProfile | null,
  signals: string[]
): number {
  let score = 0;

  const b2bKeywords = ["b2b", "saas", "enterprise", "technology"];
  const industryKeywords = ["technology", "software", "saas", "b2b", "enterprise"];

  // Check Clay description
  const descLower = (description || "").toLowerCase();
  for (const keyword of b2bKeywords) {
    if (descLower.includes(keyword)) {
      score += 30;
      signals.push(`B2B focus: "${keyword}" in description (+30)`);
    }
  }

  // Check Clay industry
  const industryLower = (industry || "").toLowerCase();
  for (const keyword of industryKeywords) {
    if (industryLower.includes(keyword)) {
      score += 20;
      signals.push(`B2B focus: "${keyword}" in industry (+20)`);
    }
  }

  // Check Clay services
  const serviceList = toList(clayServices);
  for (const service of serviceList) {
    const sLower = service.toLowerCase();
    for (const keyword of b2bKeywords) {
      if (sLower.includes(keyword)) {
        score += 15;
        signals.push(`B2B focus: "${keyword}" in services (+15)`);
      }
    }
  }

  // Check Firecrawl profile industries
  if (profile?.industries) {
    for (const ind of profile.industries) {
      const indLower = ind.toLowerCase();
      for (const keyword of b2bKeywords) {
        if (indLower.includes(keyword)) {
          score += 20;
          signals.push(`B2B focus: "${keyword}" in profile industries (+20)`);
        }
      }
    }
  }

  // Check Firecrawl positioning
  if (profile?.positioning) {
    const posLower = profile.positioning.toLowerCase();
    for (const keyword of b2bKeywords) {
      if (posLower.includes(keyword)) {
        score += 20;
        signals.push(`B2B focus: "${keyword}" in positioning (+20)`);
      }
    }
  }

  if (score === 0) {
    signals.push("B2B focus: no indicators found (neutral 50)");
    return 50;
  }

  return Math.min(score, 100);
}

/**
 * Score a single enriched agency using the 5-factor weighted model.
 * Uses both enrichment data and Firecrawl agency profile for better accuracy.
 */
export function scoreAgency(
  agency: EnrichedAgency,
  configOverrides?: ScoringConfig
): { totalScore: number; fitLevel: FitLevel; scores: ScoreBreakdown; scoringSignals: string[] } & EnrichedAgency {
  const config = mergeConfig(configOverrides);
  const signals: string[] = [];
  const profile = agency.agencyProfile;

  const revenueScore = scoreRevenue(agency.revenueEstimate, config.revenue, signals);
  const teamSizeScore = scoreTeamSize(agency.employeeCount, config.teamSize, signals);
  const specializationScore = scoreSpecialization(agency.services, profile, config.specialization, signals);
  const founderLedScore = scoreFounderLed(agency.contacts || [], profile, signals);
  const b2bFocusScore = scoreB2bFocus(agency.description, agency.industry, agency.services, profile, signals);

  // Check for red flags from Firecrawl profile
  if (profile?.redFlags && profile.redFlags.length > 0) {
    signals.push(`Red flags: ${profile.redFlags.join("; ")}`);
  }

  const totalScore =
    revenueScore * config.revenue.weight +
    teamSizeScore * config.teamSize.weight +
    specializationScore * config.specialization.weight +
    founderLedScore * config.founderLed.weight +
    b2bFocusScore * config.b2bFocus.weight;

  const roundedScore = Math.round(totalScore * 100) / 100;

  let fitLevel: FitLevel;
  if (roundedScore >= config.thresholds.highFit) {
    fitLevel = "high";
  } else if (roundedScore >= config.thresholds.mediumFit) {
    fitLevel = "medium";
  } else {
    fitLevel = "low";
  }

  const scores: ScoreBreakdown = {
    revenueScore,
    teamSizeScore,
    specializationScore,
    founderLedScore,
    b2bFocusScore,
  };

  return {
    ...agency,
    totalScore: roundedScore,
    fitLevel,
    scores,
    scoringSignals: signals,
  };
}

/**
 * Score a batch of agencies, sorted by total score descending
 */
export function scoreBatch(
  agencies: EnrichedAgency[],
  configOverrides?: ScoringConfig
) {
  return agencies
    .map((a) => scoreAgency(a, configOverrides))
    .sort((a, b) => b.totalScore - a.totalScore);
}
