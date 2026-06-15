import { blackCallCenterFetch } from "./black-call-center.proxy.util.js";

const BLACK_AGENT_ACTIVITIES_PATH = "/api/call-center/agent-activities";

/**
 * POST /api/call-center/agent-activities
 * Upstream: https://black.bmspros.com.au/api/call-center/agent-activities
 * (or BLACK_API_BASE_URL override for local/staging)
 */
export async function proxyBlackCallCenterAgentActivities(
  firebaseIdToken: string,
  body: unknown,
  tenantId?: string
): Promise<Response> {
  const init: RequestInit & { tenantId?: string } = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  };
  if (tenantId?.trim()) init.tenantId = tenantId;
  return blackCallCenterFetch(BLACK_AGENT_ACTIVITIES_PATH, firebaseIdToken, init);
}
