/**
 * صلاحيات بوت التيليغرام — مفاتيح إنجليزية للكود، تسميات عربية للعرض.
 *
 * payment   — الدفع، سعر الصرف، إدارة QR، وقت انتهاء الدفع
 * profiles  — البروفايلات، تفعيل الطرق، تعديل بيانات الدفع
 * orders    — الطلبات، فئات الطلبات، أزرار حالة الطلب، أكواد البطاقة
 * crm       — CRM، التصدير، التقارير، الزيارات
 * site      — إعدادات الموقع: الأسئلة، الهيرو، الروابط، الصيانة
 * blocked   — المحظورون (IP، بصمة، دردشة) وأزرار الإشراف mod:
 * marketing — التقييمات والإحصائيات
 * ai        — تحسين النص، الصياغة، Gemini
 * system    — عرض Chat ID، المساعدة، /help
 * all       — كل ما سبق (للمفوضين من سوبر أدمن)
 */

export const BOT_PERMISSION_KEYS = [
  'payment',
  'profiles',
  'orders',
  'crm',
  'site',
  'blocked',
  'marketing',
  'ai',
  'system',
  'all',
];

export const BOT_PERMISSION_LABELS_AR = {
  payment: 'الدفع، سعر الصرف، QR، وقت الانتهاء',
  profiles: 'البروفايلات وتعديل بيانات الدفع',
  orders: 'الطلبات وتحديث الحالات',
  crm: 'CRM والتقارير والتصدير',
  site: 'إعدادات الموقع (FAQ، الهيرو، الصيانة، الروابط)',
  blocked: 'إدارة المحظورين والإشراف على المحادثات',
  marketing: 'التقييمات والإحصائيات',
  ai: 'الذكاء الاصطناعي (تحسين النص، Gemini)',
  system: 'Chat ID والمساعدة',
  all: 'كل الصلاحيات',
};

export function formatPermissionsHelpAr() {
  const lines = BOT_PERMISSION_KEYS.filter((k) => k !== 'all').map(
    (k) => `• <code>${k}</code>\n  ${BOT_PERMISSION_LABELS_AR[k] || k}`
  );
  return ['📋 <b>قائمة الصلاحيات</b> (أرسلها مفصولة بفواصل أو استخدم <code>all</code>):', '', ...lines].join('\n');
}

/**
 * @returns {string|null} اسم الصلاحية أو null = أي مستخدم مسموح له استخدام البوت
 */
export function getRequiredPermissionForCallback(data) {
  const d = String(data || '');

  if (d === 'menu_main' || d === 'cancel_input' || d === 'menu_nop') return null;

  if (
    d === 'menu_pay'
    || d === 'menu_rate'
    || d === 'menu_qr'
    || d === 'menu_timer'
    || d.startsWith('rate_')
    || d.startsWith('qr_')
    || d.startsWith('timer_')
    || d.startsWith('ef_')
  ) {
    return 'payment';
  }

  if (
    d === 'menu_profiles'
    || d === 'menu_edit'
    || d === 'prof_add'
    || d.startsWith('prof_sum_')
    || d.startsWith('prof_edit_go_')
    || d.startsWith('prof_methods_')
    || d.startsWith('prof_mten_')
    || d.startsWith('prof_platform_')
    || d.startsWith('prof_del_')
    || d.startsWith('edit_')
  ) {
    return 'profiles';
  }

  if (
    d === 'menu_orders'
    || d.startsWith('ordf:')
    || d.startsWith('ordp:')
    || d.startsWith('ordv:')
    || /^o[dacr]:/.test(d)
    || d.startsWith('ord:')
    || d.startsWith('ccotp:')
  ) {
    return 'orders';
  }

  if (d === 'menu_crm' || d.startsWith('crm_')) return 'crm';

  if (
    d === 'menu_site'
    || d.startsWith('site_')
    || d.startsWith('sf_')
    || d.startsWith('maint_')
    || d.startsWith('faq_')
  ) {
    return 'site';
  }

  if (d === 'menu_blocked' || d.startsWith('blocked_') || d.startsWith('mod:')) return 'blocked';

  if (d === 'menu_testimonials' || d.startsWith('rev_')) return 'marketing';

  if (d === 'menu_stats' || d.startsWith('stat_')) return 'marketing';

  if (d === 'menu_chatid' || d === 'menu_help') return 'system';

  return 'system';
}

/**
 * @returns {string|null}
 */
export function getRequiredPermissionForCommand(trimmed, _raw) {
  const t = String(trimmed || '').toLowerCase();

  if (t === '/start') return null;

  if (t.startsWith('/admin_')) return null;

  if (t === '/help') return null;

  if (
    t.startsWith('/pay')
    || t.startsWith('/rate')
    || t.startsWith('/ratefloat')
    || t.startsWith('/timer')
    || t.startsWith('/setgemini')
  ) {
    return t.startsWith('/setgemini') ? 'ai' : 'payment';
  }

  if (t.startsWith('/order') || t.startsWith('/طلب')) return 'orders';

  if (t.startsWith('/reply')) return 'orders';

  if (t.startsWith('/banip')
    || t.startsWith('/unbanip')
    || t.startsWith('/blockedips')
    || t.startsWith('/banfp')
    || t.startsWith('/unbanfp')
    || t.startsWith('/blockedfp')) {
    return 'blocked';
  }

  if (t.startsWith('/improve') || t.startsWith('/formal') || t.startsWith('/short')) return 'ai';

  if (t.startsWith('/set ')) return 'profiles';

  if (t.startsWith('/crm')) return 'crm';

  return null;
}
