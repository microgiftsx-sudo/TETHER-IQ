import { readFile, writeFile } from 'node:fs/promises';

export function normalizeBotAdmins(data) {
  const d = data && typeof data === 'object' ? data : {};
  const delegates = {};
  const raw = d.delegates && typeof d.delegates === 'object' ? d.delegates : {};
  for (const [k, v] of Object.entries(raw)) {
    const id = String(k).trim();
    if (!/^\d+$/.test(id)) continue;
    delegates[id] = {
      addedAt: String(v?.addedAt || '').slice(0, 40) || new Date().toISOString(),
      addedBy: String(v?.addedBy || '').trim(),
      note: String(v?.note || '').slice(0, 200),
      permissions: Array.isArray(v?.permissions)
        ? v.permissions.map((p) => String(p).trim().toLowerCase()).filter(Boolean)
        : [],
    };
  }
  return { version: 1, delegates };
}

export async function loadBotAdmins(filePath) {
  try {
    const raw = JSON.parse(await readFile(filePath, 'utf8'));
    return normalizeBotAdmins(raw);
  } catch {
    return { version: 1, delegates: {} };
  }
}

export async function saveBotAdmins(filePath, data) {
  await writeFile(filePath, JSON.stringify(normalizeBotAdmins(data), null, 2), 'utf8');
}

export function getDelegatePermissions(delegates, userId) {
  const row = delegates?.[String(userId)];
  if (!row || !Array.isArray(row.permissions)) return [];
  return row.permissions;
}
