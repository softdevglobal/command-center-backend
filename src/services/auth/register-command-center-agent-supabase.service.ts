import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseClient } from "../../db/supabase/supabase.client.js";

import type { AgentType, CreateAgentRequestBody } from "../../types/agent-registration.types.js";
import { ensureFirebaseBlackAuthUser } from "./ensure-firebase-black-auth-user.service.js";

const ALLOWED_WORKSHOP_ROLES = ["owner", "branch_admin", "staff"] as const;

export type RegisterCommandCenterAgentSupabaseResult = {
  agentId: string;
  userId: string;
  firebaseBlackUid: string;
};

/**
 * Creates Supabase Auth user + `user_roles` (agent) + `agents` row + Firebase Black user.
 * Used when registering via `x-setup-secret` (no super-admin Bearer).
 */
export async function registerCommandCenterAgentInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  body: CreateAgentRequestBody;
}): Promise<RegisterCommandCenterAgentSupabaseResult> {
  const { supabaseUrl, serviceRoleKey, body } = input;

  const supabaseAdmin: SupabaseClient = createSupabaseClient(
    supabaseUrl,
    serviceRoleKey
  );

  const {
    name,
    email,
    phone,
    password,
    extension = "",
    notes = "",
    agentType: agentTypeRaw = "workshop",
    tenantId: tenantIdRaw = "",
    workshopOwnerUid: workshopOwnerUidRaw = "",
    workshopBranchId: workshopBranchIdRaw = "",
    workshopUserRole: workshopUserRoleRaw = "",
  } = body;

  if (!name || !email || !password) {
    throw new Error("name, email, and password are required");
  }

  const tenantId = String(tenantIdRaw ?? "").trim();
  const agentType: AgentType =
    String(agentTypeRaw ?? "").trim() === "command-centre"
      ? "command-centre"
      : "workshop";
  const workshopOwnerUid = String(workshopOwnerUidRaw ?? "").trim();
  const workshopBranchId = String(workshopBranchIdRaw ?? "").trim();
  const workshopUserRole = String(workshopUserRoleRaw ?? "").trim();

  if (!String(extension ?? "").trim()) {
    throw new Error(
      "extension is required — use the Yeastar extension number for this agent."
    );
  }
  if (agentType === "workshop" && !workshopOwnerUid) {
    throw new Error(
      "workshopOwnerUid is required — choose a workshop from BMS."
    );
  }
  if (agentType === "workshop" && !workshopBranchId) {
    throw new Error(
      "workshopBranchId is required — choose a workshop branch."
    );
  }
  if (
    agentType === "workshop" &&
    !ALLOWED_WORKSHOP_ROLES.includes(
      workshopUserRole as (typeof ALLOWED_WORKSHOP_ROLES)[number]
    )
  ) {
    throw new Error(
      "workshopUserRole is required for workshop agents — use owner, branch_admin, or staff."
    );
  }

  if (tenantId) {
    const { data: tenantRow, error: tenantErr } = await supabaseAdmin
      .from("tenants")
      .select("id")
      .eq("id", tenantId)
      .maybeSingle();
    if (tenantErr || !tenantRow?.id) {
      throw new Error("Invalid tenantId — tenant not found.");
    }
  }

  const { data: newUser, error: userErr } =
    await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: name,
        agent_type: agentType,
      },
    });
  if (userErr) {
    throw new Error(userErr.message);
  }

  const userId = newUser.user.id;

  const { error: roleErr } = await supabaseAdmin.from("user_roles").insert({
    user_id: userId,
    role: "agent",
  });
  if (roleErr) {
    throw new Error(`Failed to assign role: ${roleErr.message}`);
  }

  const agentId = `agent-${Date.now()}`;
  const normalizedPhone = String(phone ?? "").trim();
  const nowIso = new Date().toISOString();

  const agentsRow: Record<string, unknown> = {
    id: agentId,
    tenant_id: tenantId || null,
    queue_ids: [],
    allowed_queue_ids: [],
    name,
    extension: String(extension).trim(),
    role: "agent",
    status: "offline",
    email,
    notes: notes ?? "",
    phone_number: normalizedPhone,
    group_ids: null,
    user_id: userId,
    bms_owner_uid:
      agentType === "workshop" ? workshopOwnerUid || null : null,
    bms_branch_id:
      agentType === "workshop" ? workshopBranchId || null : null,
    workshop_user_role:
      agentType === "workshop" ? workshopUserRole || null : null,
    current_caller: null,
    call_start_time: null,
    created_at: nowIso,
    updated_at: nowIso,
  };

  const { error: agentErr } = await supabaseAdmin
    .from("agents")
    .insert(agentsRow);

  if (agentErr) {
    throw new Error(
      `Failed to create agent record: ${agentErr.message}. ` +
        `Check enum labels agent_role / agent_status match your DB (e.g. role=agent, status=offline).`
    );
  }

  const firebaseBlackUid = await ensureFirebaseBlackAuthUser({
    email: String(email).trim().toLowerCase(),
    password,
    displayName: name,
  });

  await supabaseAdmin
    .from("agents")
    .update({
      firebase_black_uid: firebaseBlackUid,
      updated_at: new Date().toISOString(),
    })
    .eq("id", agentId);

  return { agentId, userId, firebaseBlackUid };
}
