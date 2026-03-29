/**
 * يطبع روابط جاهزة لاختبار تيليغرام من قيم ملف .env المحلي (لا يُرفع التوكن إلى git).
 * الاستخدام: npm run telegram:test-urls
 */
import 'dotenv/config';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env');
if (!existsSync(envPath)) {
  console.error('لا يوجد ملف .env في جذر المشروع. انسخ من .env.example واملأ القيم.\n');
  process.exit(1);
}

const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const orders = String(process.env.TELEGRAM_ORDERS_CHAT_ID || '').trim();
const support = String(process.env.TELEGRAM_SUPPORT_CHAT_ID || '').trim();
const settings = String(process.env.TELEGRAM_SETTINGS_CHAT_ID || '').trim();

if (!token || token === 'YOUR_BOT_TOKEN' || token.includes('REPLACE')) {
  console.error('اضبط TELEGRAM_BOT_TOKEN في ملف .env ثم أعد التشغيل.\n');
  process.exit(1);
}

// توكن البوت القياسي آمن في مسار URL (لا نرمّز : كي يبقى الرابط مقروءاً كـ bot123:ABC...)
const b = `https://api.telegram.org/bot${token}`;

const missing = [];
if (!orders) missing.push('TELEGRAM_ORDERS_CHAT_ID');
if (!support) missing.push('TELEGRAM_SUPPORT_CHAT_ID');
if (!settings) missing.push('TELEGRAM_SETTINGS_CHAT_ID');

console.log('\n════════ روابط الاختبار (من .env المحلي فقط) ════════\n');
if (missing.length) {
  console.log('⚠️  أضف إلى ملف .env نفس القيم الموجودة في Railway ثم أعد تشغيل هذا الأمر:');
  console.log(`   ${missing.join(', ')}\n`);
}

console.log('① التحقق من التوكن:\n');
console.log(`${b}/getMe\n`);
console.log('② مجموعة الطلبات:\n');
console.log(
  orders
    ? `${b}/getChat?chat_id=${encodeURIComponent(orders)}\n`
    : '(لم يُضبط TELEGRAM_ORDERS_CHAT_ID)\n',
);
console.log('③ الدعم:\n');
console.log(
  support
    ? `${b}/getChat?chat_id=${encodeURIComponent(support)}\n`
    : '(لم يُضبط TELEGRAM_SUPPORT_CHAT_ID)\n',
);
console.log('④ الإعدادات:\n');
console.log(
  settings
    ? `${b}/getChat?chat_id=${encodeURIComponent(settings)}\n`
    : '(لم يُضبط TELEGRAM_SETTINGS_CHAT_ID)\n',
);
console.log('══════════════════════════════════════════════════════');
console.log('افتح كل رابط في المتصفح. getMe يجب أن يعطي ok:true.');
console.log('getChat يعطي ok:true إذا كان البوت عضواً في تلك المحادثة.');
console.log('لا تشارك مخرجات هذه الشاشة (تحتوي على التوكن).\n');
