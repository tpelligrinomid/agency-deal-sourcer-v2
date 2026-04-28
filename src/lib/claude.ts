import Anthropic from "@anthropic-ai/sdk";
import type { AgencyProfile } from "../types/prospects";

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  return new Anthropic({ apiKey });
}

/**
 * Helper to extract and parse JSON from Claude's response
 */
function parseJsonResponse<T>(text: string): T {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Try to extract JSON from markdown code block
    const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      return JSON.parse(match[1].trim());
    }
    // Try to find raw JSON object or array
    const jsonMatch = trimmed.match(/[\[{][\s\S]*[\]}]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error(`Failed to parse JSON from response: ${trimmed.slice(0, 200)}`);
  }
}

// ============================================
// Query Interpretation (NL → Exa search strings)
// ============================================

const QUERY_SYSTEM_PROMPT = `You are a search query optimizer for agency deal sourcing. Given a natural language description of an ideal agency prospect, generate 2-3 optimized search queries for the Exa.ai semantic search API.

The queries should help find marketing agencies, digital agencies, or B2B service companies that match the described criteria.

Rules:
- Generate 2-3 distinct search queries that cover different angles
- Each query should be a natural language sentence (Exa works best with semantic queries, not keyword lists)
- Focus on finding company websites, not job listings or news articles
- Include signals like industry focus, team size, service offerings, geography if mentioned
- Return ONLY a JSON array of strings, no other text

Example input: "Small HubSpot agencies in the US with less than 15 employees that focus on B2B SaaS"
Example output: ["small HubSpot partner agency specializing in B2B SaaS marketing", "boutique marketing agency focused on HubSpot implementation for technology companies", "B2B SaaS marketing agency offering HubSpot services and revenue operations"]`;

export async function interpretQuery(naturalLanguageQuery: string): Promise<string[]> {
  const client = getClient();

  console.log(`Interpreting query: "${naturalLanguageQuery}"`);

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 512,
    system: QUERY_SYSTEM_PROMPT,
    messages: [{ role: "user", content: naturalLanguageQuery }],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }

  const queries = parseJsonResponse<string[]>(textBlock.text);
  if (!Array.isArray(queries) || queries.length === 0) {
    throw new Error("Expected non-empty array of search queries");
  }

  console.log(`Generated ${queries.length} search queries`);
  return queries.map(String);
}

// ============================================
// Agency Profiling (Firecrawl content → structured profile)
// ============================================

const PROFILE_SYSTEM_PROMPT = `You are an M&A analyst evaluating marketing agencies for acquisition. Given scraped website content from an agency, extract a structured profile.

Return a JSON object with these fields:
- "positioning": string | null — their one-line positioning statement or value prop
- "services": string[] — list of service offerings (e.g., "HubSpot implementation", "Content marketing", "ABM")
- "industries": string[] — verticals/industries they serve (e.g., "B2B SaaS", "Fintech", "Healthcare")
- "clients": string[] — named clients or types of clients mentioned (e.g., "Slack", "Series B startups")
- "caseStudies": string[] — brief headline results from case studies (e.g., "Grew MQLs 300% for fintech client")
- "partnerships": string[] — tech partnerships or certifications (e.g., "HubSpot Diamond Partner", "Google Partner")
- "teamInfo": string | null — brief note on team size, structure, or leadership style if mentioned
- "redFlags": string[] — anything that might disqualify them as an acquisition target (too large, consumer focus, part of a bigger holding company, etc.)
- "acquisitionNotes": string | null — your assessment of why this agency is or isn't a good acquisition fit for a holding company acquiring founder-led B2B marketing agencies in the $1-2.5M revenue range

Be concise. If information isn't available, use null or empty arrays. Return ONLY the JSON object.`;

export async function generateAgencyProfile(
  domain: string,
  websiteContent: string,
  clayData?: {
    companyName?: string | null;
    industry?: string | null;
    employeeCount?: number | null;
    services?: string[] | null;
    revenueEstimate?: number | null;
  }
): Promise<AgencyProfile> {
  const client = getClient();

  let context = `Agency domain: ${domain}\n\n`;
  if (clayData) {
    const parts: string[] = [];
    if (clayData.companyName) parts.push(`Company: ${clayData.companyName}`);
    if (clayData.industry) parts.push(`Industry: ${clayData.industry}`);
    if (clayData.employeeCount) parts.push(`Employees: ${clayData.employeeCount}`);
    if (clayData.services?.length) parts.push(`Known services: ${clayData.services.join(", ")}`);
    if (clayData.revenueEstimate) parts.push(`Revenue estimate: $${clayData.revenueEstimate.toLocaleString()}`);
    if (parts.length > 0) {
      context += `Enrichment data:\n${parts.join("\n")}\n\n`;
    }
  }
  context += `Website content:\n${websiteContent}`;

  console.log(`Generating agency profile for ${domain}`);

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1500,
    system: PROFILE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: context }],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude for agency profile");
  }

  const raw = parseJsonResponse<Record<string, any>>(textBlock.text);

  const profile: AgencyProfile = {
    positioning: raw.positioning || null,
    services: Array.isArray(raw.services) ? raw.services : [],
    industries: Array.isArray(raw.industries) ? raw.industries : [],
    clients: Array.isArray(raw.clients) ? raw.clients : [],
    caseStudies: Array.isArray(raw.caseStudies) ? raw.caseStudies : [],
    partnerships: Array.isArray(raw.partnerships) ? raw.partnerships : [],
    teamInfo: raw.teamInfo || null,
    redFlags: Array.isArray(raw.redFlags) ? raw.redFlags : [],
    acquisitionNotes: raw.acquisitionNotes || null,
    scrapedAt: new Date().toISOString(),
  };

  console.log(`Agency profile generated for ${domain}: ${profile.services.length} services, ${profile.clients.length} clients`);
  return profile;
}

// ============================================
// Personalized Message Generation (profile → LinkedIn Step 2 message)
// Two variants: rapport (soft) and direct (hard pitch)
// ============================================

const MESSAGE_RAPPORT_PROMPT = `You write personalized LinkedIn messages for agency deal sourcing. The sender works with a portfolio of marketing agencies.

This message is Step 2 in a LinkedIn sequence — the founder already accepted a blank connection request. This is the first real message. The goal is pure rapport-building, NOT pitching or selling anything.

Formula:
1. Greet by first name, mention their agency name, and how you came across them (e.g., "during some searches for [their niche] agencies")
2. Reference ONE specific capability, niche, or strength from their profile (a service, partnership, industry focus, or case study result)
3. Briefly tie it to relevance across "our portfolio of agencies" — showing you work in the space, not that you're selling something
4. End with a lightweight industry question that shows genuine curiosity about a trend or challenge in their niche

Rules:
- Tone: peer-to-peer, casual, one agency person to another. NOT salesy, NOT corporate.
- NO call to action. NO "let's chat." NO "would love to connect." Just end with the question.
- Do NOT introduce yourself, your company, or your role. Do NOT mention acquisitions.
- Keep it under 300 characters if possible, never exceed 500 characters.
- Don't use emojis.
- Don't use "I hope this message finds you well" or any generic opener.
- Sound like a real person texting a peer, not a template.

Example (for reference only — do NOT copy this, write something unique each time):
"Hey Diell, came across SpaceRanker during some searches for SEO agencies (especially those working in SaaS). I see you've been able to integrate AI SEO; it's a hot topic across our portfolio of agencies. Are you finding that your customers are asking more and more about GEO/AEO?"

Return ONLY the message text, no quotes, no explanation.`;

const MESSAGE_DIRECT_PROMPT = `You write personalized LinkedIn messages for agency acquisition outreach. The sender runs Aragon Holdings, a holding company that acquires and grows founder-led marketing agencies.

This message is Step 2 in a LinkedIn sequence — the founder already accepted a blank connection request. This is the first real message. The goal is a direct but respectful pitch — this agency is a strong fit and you want them to know you're actively looking for agencies like theirs.

Formula:
1. Greet by first name, mention their agency name, and how you came across them
2. Reference ONE specific thing about their agency that makes them a strong fit (a service, niche, client base, or growth signal)
3. Be direct: you run Aragon Holdings, you acquire and grow founder-led marketing agencies, and their agency caught your eye
4. Light ask: have they ever thought about what a transition or next phase could look like?
5. Keep it low-pressure — "no pressure either way" or "just curious" tone

Rules:
- Tone: direct but human. Confident, not pushy.
- Reference something SPECIFIC about their agency — don't be generic.
- Keep it under 400 characters if possible, never exceed 500 characters.
- Don't use emojis.
- Don't use "I hope this message finds you well" or any generic opener.
- Sound like a real person, not a template.

Return ONLY the message text, no quotes, no explanation.`;

function buildProfileSummary(agencyProfile: AgencyProfile): string {
  return [
    agencyProfile.positioning ? `Positioning: ${agencyProfile.positioning}` : null,
    agencyProfile.services.length > 0 ? `Services: ${agencyProfile.services.join(", ")}` : null,
    agencyProfile.industries.length > 0 ? `Industries: ${agencyProfile.industries.join(", ")}` : null,
    agencyProfile.clients.length > 0 ? `Clients: ${agencyProfile.clients.join(", ")}` : null,
    agencyProfile.caseStudies.length > 0 ? `Case studies: ${agencyProfile.caseStudies.join("; ")}` : null,
    agencyProfile.partnerships.length > 0 ? `Partnerships: ${agencyProfile.partnerships.join(", ")}` : null,
    agencyProfile.teamInfo ? `Team: ${agencyProfile.teamInfo}` : null,
  ].filter(Boolean).join("\n");
}

async function generateSingleMessage(
  systemPrompt: string,
  contactName: string,
  agencyProfile: AgencyProfile,
  companyName: string,
  domain: string
): Promise<string> {
  const client = getClient();
  const profileSummary = buildProfileSummary(agencyProfile);

  const userContent = `Contact first name: ${contactName.split(" ")[0]}
Agency: ${companyName} (${domain})

Agency profile:
${profileSummary}

Write the personalized LinkedIn message.`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 300,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude for personalized message");
  }

  return textBlock.text.trim();
}

/**
 * Generate both rapport and direct pitch messages for an agency contact.
 * Returns { rapport, direct } so the user can choose which to send.
 */
export async function generatePersonalizedMessages(
  contactName: string,
  agencyProfile: AgencyProfile,
  companyName: string,
  domain: string
): Promise<{ rapport: string; direct: string }> {
  console.log(`Generating personalized messages (both variants) for ${contactName} at ${companyName}`);

  const [rapport, direct] = await Promise.all([
    generateSingleMessage(MESSAGE_RAPPORT_PROMPT, contactName, agencyProfile, companyName, domain),
    generateSingleMessage(MESSAGE_DIRECT_PROMPT, contactName, agencyProfile, companyName, domain),
  ]);

  console.log(`Generated messages for ${contactName}: rapport=${rapport.length} chars, direct=${direct.length} chars`);
  return { rapport, direct };
}
