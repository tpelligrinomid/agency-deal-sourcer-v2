/**
 * Firecrawl integration for scraping agency websites.
 * Scrapes homepage + key pages to gather positioning, services, clients, etc.
 */

interface FirecrawlScrapeResponse {
  success: boolean;
  data?: {
    markdown?: string;
    metadata?: {
      title?: string;
      description?: string;
    };
  };
}

function getApiKey(): string {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) throw new Error("FIRECRAWL_API_KEY not configured");
  return key;
}

/**
 * Scrape a single URL and return markdown content.
 */
async function scrapeUrl(url: string): Promise<string | null> {
  const apiKey = getApiKey();

  try {
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
        timeout: 30000,
      }),
    });

    if (!response.ok) {
      console.warn(`Firecrawl scrape failed for ${url}: ${response.status}`);
      return null;
    }

    const result: FirecrawlScrapeResponse = await response.json();
    return result.data?.markdown || null;
  } catch (error) {
    console.warn(`Firecrawl scrape error for ${url}:`, error);
    return null;
  }
}

/**
 * Scrape an agency's website — homepage + key subpages.
 * Returns combined markdown content for Claude to analyze.
 */
export async function scrapeAgencyWebsite(domain: string): Promise<string | null> {
  const baseUrl = `https://${domain}`;

  console.log(`Firecrawl: scraping ${domain}`);

  // Scrape homepage first
  const homepage = await scrapeUrl(baseUrl);
  if (!homepage) {
    console.warn(`Firecrawl: homepage scrape failed for ${domain}`);
    return null;
  }

  // Try common subpages (best-effort, don't fail if these 404)
  const subpages = ["/about", "/services", "/work", "/case-studies", "/clients", "/team"];
  const sections: string[] = [`## Homepage\n${homepage.slice(0, 4000)}`];

  for (const path of subpages) {
    const content = await scrapeUrl(`${baseUrl}${path}`);
    if (content && content.length > 100) {
      const pageName = path.replace("/", "").replace("-", " ");
      sections.push(`## ${pageName}\n${content.slice(0, 3000)}`);
    }
  }

  const combined = sections.join("\n\n---\n\n");
  console.log(`Firecrawl: scraped ${sections.length} pages for ${domain} (${combined.length} chars)`);

  // Cap total content to avoid token limits
  return combined.slice(0, 20000);
}
