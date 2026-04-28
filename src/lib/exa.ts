import type { RawProspect } from "../types/prospects";

const EXA_BASE_URL = "https://api.exa.ai";

interface ExaSearchResult {
  url: string;
  title: string | null;
  text: string | null;
  highlights: string[] | null;
  score: number | null;
}

interface ExaSearchResponse {
  results: ExaSearchResult[];
}

function getApiKey(): string {
  const key = process.env.EXA_API_KEY;
  if (!key) throw new Error("EXA_API_KEY not configured");
  return key;
}

function extractDomain(url: string): string {
  try {
    const hostname = new URL(url.startsWith("http") ? url : `https://${url}`).hostname;
    return hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function extractCompanyName(url: string, title: string | null): string | null {
  if (title) {
    // Take first part before common separators
    const name = title.split(/\s*[|–—-]\s*/)[0].trim();
    if (name.length > 0 && name.length < 100) return name;
  }
  // Fallback: capitalize domain
  const domain = extractDomain(url);
  const name = domain.split(".")[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Exa semantic search - discover prospects matching search queries
 */
export async function exaSearch(
  queries: string[],
  maxResultsPerQuery: number = 20
): Promise<RawProspect[]> {
  const apiKey = getApiKey();
  const allResults: RawProspect[] = [];

  for (const query of queries) {
    console.log(`Exa search: "${query}" (max ${maxResultsPerQuery})`);

    const response = await fetch(`${EXA_BASE_URL}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        query,
        type: "neural",
        numResults: maxResultsPerQuery,
        contents: {
          text: { maxCharacters: 500 },
          highlights: { numSentences: 3 },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Exa search failed for "${query}": ${response.status} ${errorText}`);
      continue;
    }

    const data: ExaSearchResponse = await response.json();

    for (const result of data.results) {
      const domain = extractDomain(result.url);
      allResults.push({
        domain,
        companyName: extractCompanyName(result.url, result.title),
        source: "exa_search",
        exaTitle: result.title,
        exaDescription: result.text,
        exaHighlights: result.highlights,
        exaScore: result.score,
        preEnriched: null,
      });
    }

    console.log(`Exa search "${query}": ${data.results.length} results`);
  }

  return allResults;
}

/**
 * Exa find-similar - discover prospects similar to seed domains
 */
export async function exaFindSimilar(
  seedDomains: string[],
  maxResultsPerDomain: number = 20
): Promise<RawProspect[]> {
  const apiKey = getApiKey();
  const allResults: RawProspect[] = [];

  for (const seed of seedDomains) {
    const seedUrl = seed.startsWith("http") ? seed : `https://${seed}`;
    console.log(`Exa find-similar: ${seedUrl} (max ${maxResultsPerDomain})`);

    const response = await fetch(`${EXA_BASE_URL}/findSimilar`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        url: seedUrl,
        numResults: maxResultsPerDomain,
        contents: {
          text: { maxCharacters: 500 },
          highlights: { numSentences: 3 },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Exa findSimilar failed for ${seed}: ${response.status} ${errorText}`);
      continue;
    }

    const data: ExaSearchResponse = await response.json();

    for (const result of data.results) {
      const domain = extractDomain(result.url);
      allResults.push({
        domain,
        companyName: extractCompanyName(result.url, result.title),
        source: "exa_similar",
        exaTitle: result.title,
        exaDescription: result.text,
        exaHighlights: result.highlights,
        exaScore: result.score,
        preEnriched: null,
      });
    }

    console.log(`Exa find-similar ${seed}: ${data.results.length} results`);
  }

  return allResults;
}

/**
 * Deduplicate prospects by domain (keep highest exa_score per domain)
 */
export function deduplicateProspects(prospects: RawProspect[]): RawProspect[] {
  const byDomain = new Map<string, RawProspect>();

  for (const p of prospects) {
    const existing = byDomain.get(p.domain);
    if (!existing || (p.exaScore ?? 0) > (existing.exaScore ?? 0)) {
      byDomain.set(p.domain, p);
    }
  }

  return Array.from(byDomain.values());
}
