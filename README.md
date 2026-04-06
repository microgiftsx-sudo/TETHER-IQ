# TETHER IQ

منصة OTC لبيع وشراء USDT مقابل الدينار العراقي — واجهة **React (Vite)** وخادم **Node.js** (Express)، مع تكامل تيليغرام للطلبات والدعم.

## التشغيل المحلي

يتطلب Node.js 18+.

```bash
npm install
npm run dev:all
```

- الواجهة: حسب إعداد Vite (عادة `http://localhost:5173`)
- الـ API: `http://localhost:3000` (أو المنفذ في `.env`)

راجع متغيرات البيئة في `.env.example` إن وُجدت، واضبط `TELEGRAM_*` وقاعدة البيانات/المسارات حسب الاستضافة.
