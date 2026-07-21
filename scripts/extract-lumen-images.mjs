import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import XLSX from 'xlsx';

const src = path.join(process.env.USERPROFILE, 'Downloads', '[ATLM] 27SS RRP.xlsx');
const out = path.join(process.env.TEMP, 'atlm-27ss-xlsx');
const repoMedia = path.join(process.cwd(), 'client', 'public', 'lumen-27ss');
const productsPath = path.join(process.cwd(), 'client', 'src', 'lib', 'data', 'lumen-27ss-products.json');
const mapPath = path.join(process.cwd(), 'client', 'src', 'lib', 'data', 'lumen-27ss-images.json');

const products = JSON.parse(fs.readFileSync(productsPath, 'utf8'));
const productByEn = new Map(products.map((p) => [p.enName.toUpperCase(), p]));
const productByKo = new Map(products.map((p) => [p.koName, p]));

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(src, path.join(out, 'src.zip'));
execSync('tar -xf src.zip', { cwd: out });

if (fs.existsSync(repoMedia)) fs.rmSync(repoMedia, { recursive: true, force: true });
fs.mkdirSync(repoMedia, { recursive: true });

const relsXml = fs.readFileSync(path.join(out, 'xl/drawings/_rels/drawing1.xml.rels'), 'utf8');
const ridToFile = {};
for (const m of relsXml.matchAll(/Id="(rId\d+)"[^>]*Target="([^"]+)"/g)) {
  ridToFile[m[1]] = path.basename(m[2]);
}

const drawing = fs.readFileSync(path.join(out, 'xl/drawings/drawing1.xml'), 'utf8');
const anchors = [];
for (const p of drawing.split(/<(?:xdr:)?(?:twoCellAnchor|oneCellAnchor)/).slice(1)) {
  const rowFrom = (p.match(/<xdr:from>[\s\S]*?<xdr:row>(\d+)/) || [])[1];
  const emb = (p.match(/r:embed="(rId\d+)"/) || [])[1];
  if (rowFrom != null && emb) {
    anchors.push({ excelRow0: Number(rowFrom), file: ridToFile[emb] });
  }
}

const wb = XLSX.readFile(src);
const data = XLSX.utils.sheet_to_json(wb.Sheets['27SS RRP'], { header: 1, defval: '' });

function parseEn(en) {
  const m = String(en || '').match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (m) return { base: m[1].trim(), color: m[2].trim() };
  return { base: String(en || '').trim(), color: '' };
}

function normalizeBase(base) {
  // Excel typo: CURVE HOBO BAG BAG
  if (/^CURVE HOBO BAG BAG$/i.test(base)) return 'CURVE HOBO BAG';
  return base;
}

function resolveProduct(en, ko) {
  const { base } = parseEn(en);
  const norm = normalizeBase(base);
  if (norm && productByEn.has(norm.toUpperCase())) return productByEn.get(norm.toUpperCase());

  const koClean = String(ko || '').replace(/\r?\n.*/g, '').trim();
  // Exact
  if (productByKo.has(koClean)) return productByKo.get(koClean);
  // Prefix match longest first (쪼리 샌들 before 쪼리힐)
  const kos = [...productByKo.keys()].sort((a, b) => b.length - a.length);
  for (const k of kos) {
    if (koClean.startsWith(k)) return productByKo.get(k);
  }
  // Korean color suffix strip common patterns
  for (const k of kos) {
    if (koClean.includes(k)) return productByKo.get(k);
  }
  return null;
}

const KO_SLUG = {
  '쪼리 샌들': 'jjori-sandal',
  '쪼리힐': 'jjori-heel',
  '슬링백': 'slingback',
  '펌프스': 'pumps',
};

function slug(name) {
  if (KO_SLUG[name]) return KO_SLUG[name];
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '') || 'item';
}

/** media file -> first product enName */
const byMedia = new Map();
const byProduct = new Map();

for (const a of anchors) {
  const row = data[a.excelRow0] || [];
  const en = String(row[8] || '').trim();
  const ko = String(row[9] || '').trim();
  if (!a.file) continue;
  const mediaPath = path.join(out, 'xl', 'media', a.file);
  if (!fs.existsSync(mediaPath)) continue;
  if (fs.statSync(mediaPath).size < 50000) continue;

  const prod = resolveProduct(en, ko);
  if (!prod) {
    console.warn('unmatched', a.excelRow0, en || ko, a.file);
    continue;
  }

  if (byProduct.has(prod.enName)) continue; // first image wins (same for all colors)
  byProduct.set(prod.enName, { enName: prod.enName, media: a.file, mediaPath });
}

const mapping = {};
for (const [enName, info] of byProduct) {
  const destName = `${slug(enName)}.png`;
  const dest = path.join(repoMedia, destName);
  if (!byMedia.has(info.media)) {
    fs.copyFileSync(info.mediaPath, dest);
    byMedia.set(info.media, destName);
  } else {
    // hardlink / copy same file under product name for clear URLs
    fs.copyFileSync(path.join(repoMedia, byMedia.get(info.media)), dest);
  }
  mapping[enName] = `/lumen-27ss/${destName}`;
}

fs.writeFileSync(mapPath, JSON.stringify(mapping, null, 2), 'utf8');
console.log('products with images', Object.keys(mapping).length, '/', products.length);
for (const p of products) {
  console.log(p.enName, '->', mapping[p.enName] || 'MISSING');
}
