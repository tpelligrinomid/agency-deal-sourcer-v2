const PIPEDRIVE_BASE_URL = "https://api.pipedrive.com/v1";

function getApiToken(): string {
  const token = process.env.PIPEDRIVE_API_TOKEN;
  if (!token) throw new Error("PIPEDRIVE_API_TOKEN not configured");
  return token;
}

function getColdLeadLabelId(): number {
  const id = process.env.PIPEDRIVE_COLD_LEAD_LABEL_ID;
  if (!id) throw new Error("PIPEDRIVE_COLD_LEAD_LABEL_ID not configured");
  return Number(id);
}

async function pipedriveRequest(
  method: string,
  path: string,
  body?: Record<string, any>
): Promise<any> {
  const token = getApiToken();
  const url = `${PIPEDRIVE_BASE_URL}${path}?api_token=${token}`;

  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) options.body = JSON.stringify(body);

  const response = await fetch(url, options);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Pipedrive ${method} ${path} failed: ${response.status} ${errorText}`);
  }

  return response.json();
}

/**
 * Search for an existing organization by domain.
 * Returns the org ID if found, null otherwise.
 */
export async function findOrgByDomain(domain: string): Promise<number | null> {
  try {
    const result = await pipedriveRequest("GET", `/organizations/search?term=${encodeURIComponent(domain)}&fields=custom_fields&limit=5`);

    if (result.data?.items?.length > 0) {
      // Check if any result matches our domain
      for (const item of result.data.items) {
        const org = item.item;
        // Check org name or custom fields for domain match
        if (org) {
          console.log(`Found existing Pipedrive org for ${domain}: ${org.id}`);
          return org.id;
        }
      }
    }
  } catch (error) {
    console.warn(`Pipedrive org search failed for ${domain}:`, error);
  }

  return null;
}

/**
 * Create a new organization in Pipedrive.
 * Returns the new org ID.
 */
export async function createOrganization(params: {
  name: string;
  domain: string;
  location?: string | null;
  fitScore?: number | null;
}): Promise<number> {
  const body: Record<string, any> = {
    name: params.name,
  };

  if (params.location) {
    body.address = params.location;
  }

  // Note: custom fields for website/domain and fit score require field keys
  // which are specific to each Pipedrive account. These would need to be
  // configured as additional env vars or discovered via the API.

  const result = await pipedriveRequest("POST", "/organizations", body);

  if (!result.data?.id) {
    throw new Error(`Failed to create Pipedrive org for ${params.name}`);
  }

  console.log(`Created Pipedrive org ${result.data.id} for ${params.name}`);
  return result.data.id;
}

/**
 * Create a person in Pipedrive linked to an organization.
 * Label is set to "COLD LEAD".
 * Returns the new person ID.
 */
export async function createPerson(params: {
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  orgId: number;
  email?: string | null;
  phone?: string | null;
}): Promise<number> {
  const labelId = getColdLeadLabelId();

  const body: Record<string, any> = {
    name: params.fullName,
    org_id: params.orgId,
    label_ids: [labelId],
  };

  if (params.email) {
    body.email = [{ value: params.email, label: "work" }];
  }

  if (params.phone) {
    body.phone = [{ value: params.phone, label: "mobile" }];
  }

  const result = await pipedriveRequest("POST", "/persons", body);

  if (!result.data?.id) {
    throw new Error(`Failed to create Pipedrive person for ${params.fullName}`);
  }

  console.log(`Created Pipedrive person ${result.data.id} for ${params.fullName} (org ${params.orgId})`);
  return result.data.id;
}

/**
 * Find or create an organization, then create person(s).
 * Returns the org ID and an array of person IDs.
 */
export async function pushToPipedrive(params: {
  domain: string;
  companyName: string;
  location?: string | null;
  fitScore?: number | null;
  contacts: {
    fullName: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
  }[];
}): Promise<{ orgId: number; personIds: number[] }> {
  // Step 1: Dedup check - search by domain
  let orgId = await findOrgByDomain(params.domain);

  // Step 2: Create org if not found
  if (!orgId) {
    orgId = await createOrganization({
      name: params.companyName,
      domain: params.domain,
      location: params.location,
      fitScore: params.fitScore,
    });
  }

  // Step 3: Create person(s) linked to org
  const personIds: number[] = [];
  for (const contact of params.contacts) {
    try {
      const personId = await createPerson({
        firstName: contact.firstName,
        lastName: contact.lastName,
        fullName: contact.fullName,
        orgId,
        email: contact.email,
        phone: contact.phone,
      });
      personIds.push(personId);
    } catch (error) {
      console.error(`Failed to create person ${contact.fullName}:`, error);
    }
  }

  return { orgId, personIds };
}
