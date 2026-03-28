/**
 * Multi-admin payment profiles: each profile owns methods + per-method visibility on the public site.
 * The site shows `currentProfileId`; only methods with methodEnabled[key] !== false are exposed in the API.
 */

export const METHOD_KEYS = ['fastPay', 'zainCash', 'asiaHawala', 'fib', 'mastercard'];

export function defaultMethodEnabled() {
  return {
    zainCash: true,
    fastPay: true,
    asiaHawala: true,
    fib: true,
    mastercard: true,
  };
}

export function defaultEmptyMethods() {
  return {
    zainCash: { number: '', qrImage: '' },
    fastPay: { number: '', qrImage: '' },
    asiaHawala: { number: '', qrImage: '' },
    fib: { accountNumber: '', accountName: '', qrImage: '' },
    mastercard: { cardNumber: '', cardHolder: '', qrImage: '' },
  };
}

export function migratePaymentDetails(raw) {
  if (raw && Array.isArray(raw.profiles) && raw.profiles.length > 0) {
    return { details: normalizeAllProfiles(raw), migrated: false };
  }

  const id = 'profile_default';
  const profile = normalizeProfile({
    id,
    nameAr: 'البروفايل الافتراضي',
    nameEn: 'Default profile',
    methodEnabled: defaultMethodEnabled(),
    methods: raw?.methods && typeof raw.methods === 'object'
      ? JSON.parse(JSON.stringify(raw.methods))
      : defaultEmptyMethods(),
  });

  const details = {
    paymentExpiryMinutes: raw?.paymentExpiryMinutes ?? 15,
    rateConfig: raw?.rateConfig && typeof raw.rateConfig === 'object' ? { ...raw.rateConfig } : {},
    currentProfileId: id,
    profiles: [profile],
    updatedAt: raw?.updatedAt,
  };

  return { details, migrated: true };
}

function normalizeAllProfiles(raw) {
  const next = { ...raw };
  next.profiles = (raw.profiles || []).map((p) => normalizeProfile(p));
  if (!next.currentProfileId && next.profiles[0]) {
    next.currentProfileId = next.profiles[0].id;
  }
  return next;
}

export function normalizeProfile(p) {
  const methods = { ...defaultEmptyMethods(), ...(p.methods || {}) };
  for (const k of METHOD_KEYS) {
    methods[k] = { ...defaultEmptyMethods()[k], ...(p.methods?.[k] || {}) };
  }
  const methodEnabled = { ...defaultMethodEnabled(), ...(p.methodEnabled || {}) };
  return {
    id: p.id || `profile_${Date.now().toString(36)}`,
    nameAr: p.nameAr || '',
    nameEn: p.nameEn || '',
    methodEnabled,
    methods,
  };
}

export function getProfileById(details, profileId) {
  if (!details?.profiles?.length) return null;
  const id = profileId || details.currentProfileId;
  return details.profiles.find((p) => p.id === id) || details.profiles[0];
}

export function getActiveProfile(details) {
  return getProfileById(details, details.currentProfileId);
}

export function profileIndex(details, profileId) {
  return details.profiles.findIndex((p) => p.id === profileId);
}

/**
 * Payload for the public website: only active profile + enabled methods.
 */
export function buildPublicPaymentPayload(details, rate) {
  const profile = getActiveProfile(details);
  if (!profile) {
    return {
      paymentExpiryMinutes: details.paymentExpiryMinutes ?? 15,
      rateConfig: details.rateConfig || {},
      methods: {},
      activeProfile: null,
      methodEnabled: {},
      rate,
    };
  }

  const methods = {};
  for (const key of METHOD_KEYS) {
    if (profile.methodEnabled?.[key] === false) continue;
    if (profile.methods?.[key]) {
      methods[key] = { ...profile.methods[key] };
    }
  }

  return {
    paymentExpiryMinutes: details.paymentExpiryMinutes,
    rateConfig: details.rateConfig,
    methods,
    activeProfile: {
      id: profile.id,
      nameAr: profile.nameAr,
      nameEn: profile.nameEn,
    },
    methodEnabled: { ...profile.methodEnabled },
    rate,
  };
}

export function newProfileId() {
  return `profile_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}
