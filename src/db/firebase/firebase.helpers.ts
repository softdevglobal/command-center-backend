export function parsePrivateKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let s = raw.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1);
  }
  return s.replaceAll("\\n", "\n");
}

export function parseServiceAccountJson(
  raw: string | undefined
): { projectId: string; clientEmail: string; privateKey: string } | null {
  if (!raw?.trim()) return null;
  try {
    const j = JSON.parse(raw) as {
      project_id?: string;
      client_email?: string;
      private_key?: string;
    };
    if (j.project_id && j.client_email && j.private_key) {
      return {
        projectId: j.project_id,
        clientEmail: j.client_email,
        privateKey: j.private_key,
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}
