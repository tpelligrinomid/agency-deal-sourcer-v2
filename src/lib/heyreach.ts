/**
 * HeyReach API integration.
 * Adds leads to a campaign with custom fields for personalized messaging.
 *
 * Campaign sequence (pre-built in HeyReach):
 *   Step 1: Blank connection request
 *   Step 2 (Day 2): {personalized_message} — Claude-generated, per-lead
 *   Step 3 (Day 5): Generic nudge (podcast invite — static template in HeyReach)
 *   Step 4 (Day 11): Direct + respectful close (static template in HeyReach)
 *
 * HeyReach webhook (Connection Request Accepted) → triggers Pipedrive push via edge function.
 */

const HEYREACH_BASE_URL = "https://api.heyreach.io/api/public";

function getApiKey(): string {
  const key = process.env.HEYREACH_API_KEY;
  if (!key) throw new Error("HEYREACH_API_KEY not configured");
  return key;
}

function getCampaignId(): string {
  const id = process.env.HEYREACH_CAMPAIGN_ID;
  if (!id) throw new Error("HEYREACH_CAMPAIGN_ID not configured");
  return id;
}

function getLinkedInAccountId(): string {
  const id = process.env.HEYREACH_LINKEDIN_ACCOUNT_ID;
  if (!id) throw new Error("HEYREACH_LINKEDIN_ACCOUNT_ID not configured");
  return id;
}

export interface HeyReachLead {
  firstName: string | null;
  lastName: string | null;
  linkedinUrl: string;
  companyName: string | null;
  position: string | null;
  email: string | null;
  personalizedMessage: string;
}

/**
 * Add a single lead to the HeyReach campaign with a personalized message.
 * Called when user clicks "Approve" in the review UI.
 */
export async function addLeadToCampaign(lead: HeyReachLead): Promise<string | null> {
  const apiKey = getApiKey();
  const campaignId = getCampaignId();
  const linkedInAccountId = getLinkedInAccountId();

  console.log(`HeyReach: adding ${lead.linkedinUrl} to campaign ${campaignId}`);

  const payload = {
    campaignId,
    accountLeadPairs: [
      {
        linkedInAccountId,
        lead: {
          firstName: lead.firstName || "",
          lastName: lead.lastName || "",
          profileUrl: lead.linkedinUrl,
          companyName: lead.companyName || "",
          position: lead.position || "",
          emailAddress: lead.email || "",
          customUserFields: [
            {
              name: "personalized_message",
              value: lead.personalizedMessage,
            },
          ],
        },
      },
    ],
  };

  const response = await fetch(`${HEYREACH_BASE_URL}/v1/campaign/add-leads`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`HeyReach API failed: ${response.status} ${errorText}`);
    throw new Error(`HeyReach API failed: ${response.status} ${errorText}`);
  }

  const result = await response.json();
  console.log(`HeyReach: lead added to campaign ${campaignId}`);

  // Return lead ID if available
  return result?.data?.[0]?.id || null;
}

/**
 * Get all LinkedIn accounts connected to HeyReach.
 * Use this to find your HEYREACH_LINKEDIN_ACCOUNT_ID.
 */
export async function getLinkedInAccounts(): Promise<any[]> {
  const apiKey = getApiKey();

  const response = await fetch(`${HEYREACH_BASE_URL}/li_account/GetAll`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
    body: JSON.stringify({ offset: 0, limit: 50 }),
  });

  if (!response.ok) {
    throw new Error(`HeyReach GetAll accounts failed: ${response.status}`);
  }

  const result = await response.json();
  return result?.items || result?.data || [];
}
