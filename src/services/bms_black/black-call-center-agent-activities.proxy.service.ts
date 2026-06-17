import { blackCallCenterFetch } from "./black-call-center.proxy.util.js";

const BLACK_AGENT_ACTIVITIES_PATH = "/api/call-center/agent-activities";

type StreamingRequestInit = RequestInit & {
  duplex?: "half";
  tenantId?: string;
};

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

/**
 * Multipart variant for activity payloads that include a call recording file.
 * The incoming multipart body is streamed through unchanged; only auth/tenant
 * headers are replaced for the Black API.
 */
export async function proxyBlackCallCenterAgentActivitiesMultipart(
  firebaseIdToken: string,
  body: NodeJS.ReadableStream,
  contentType: string,
  contentLength?: string,
  tenantId?: string
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": contentType,
  };
  if (contentLength?.trim()) {
    headers["Content-Length"] = contentLength.trim();
  }

  const init: StreamingRequestInit = {
    method: "POST",
    headers,
    body: body as unknown as BodyInit,
    duplex: "half",
  };
  if (tenantId?.trim()) init.tenantId = tenantId;

  return blackCallCenterFetch(BLACK_AGENT_ACTIVITIES_PATH, firebaseIdToken, init);
}
