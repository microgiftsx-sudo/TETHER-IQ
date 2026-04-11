/**
 * يصغّر ويضغط الصور الثابتة (شعار الموقع + شعارات الدفع) لتحسين Lighthouse.
 * تشغيل: npm run optimize-images
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const MAX_PAYMENT = 240;
const MAX_LOGO = 320;

async function optimizeLogo() {
  const logoPath = path.join(root, 'public', 'logo.png');
  if (!fs.existsSync(logoPath)) {
    console.warn('[optimize-images] skip: public/logo.png missing');
    return;
  }
  const base = sharp(logoPath).rotate().resize(MAX_LOGO, MAX_LOGO, {
    fit: 'inside',
    withoutEnlargement: true,
  });

  const pngBuf = await base.clone().png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
  const webpBuf = await base.clone().webp({ quality: 86 }).toBuffer();

  fs.writeFileSync(logoPath, pngBuf);
  fs.writeFileSync(path.join(root, 'public', 'logo.webp'), webpBuf);
  console.log(`[optimize-images] public/logo.png → ${(pngBuf.length / 1024).toFixed(1)} KiB, logo.webp → ${(webpBuf.length / 1024).toFixed(1)} KiB`);
}

async function optimizePaymentLogos() {
  const dir = path.join(root, 'src', 'assets', 'payment-logos');
  const files = fs.readdirSync(dir).filter((f) => /\.(png|jpe?g)$/i.test(f));
  for (const name of files) {
    const full = path.join(dir, name);
    const ext = path.extname(name).toLowerCase();
    const baseName = path.basename(name, ext);
    const outWebp = path.join(dir, `${baseName}.webp`);

    const resized = sharp(full)
      .rotate()
      .resize(MAX_PAYMENT, MAX_PAYMENT, { fit: 'inside', withoutEnlargement: true });

    let mainBuf;
    if (ext === '.png') {
      mainBuf = await resized.clone().png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
    } else {
      mainBuf = await resized.clone().jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    }
    const tmpMain = `${full}.tmp`;
    fs.writeFileSync(tmpMain, mainBuf);
    fs.renameSync(tmpMain, full);

    const webpBuf = await sharp(mainBuf).webp({ quality: 85 }).toBuffer();
    fs.writeFileSync(outWebp, webpBuf);
    console.log(`[optimize-images] payment-logos/${name} → ${(mainBuf.length / 1024).toFixed(1)} KiB, ${baseName}.webp → ${(webpBuf.length / 1024).toFixed(1)} KiB`);
  }
}

await optimizeLogo();
await optimizePaymentLogos();
console.log('[optimize-images] done');
