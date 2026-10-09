/**
 * 핸드백 패키지/자재마스터 Supabase 등록
 * 사용: node scripts/seed-hb-packing.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) throw new Error('.env 없음');
  const out = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    out[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const MATERIALS = [
  { id: 'hb-mat-man', itemCode: 'HB-MAN', name: '품질보증서', unitCostKrw: 80, vendorName: '에이스패키지', spec: '44*84' },
  { id: 'hb-mat-env', itemCode: 'HB-ENV', name: '형태봉투', unitCostKrw: 140, vendorName: '에이스패키지', spec: '46*92' },
  { id: 'hb-mat-label', itemCode: 'HB-LABEL', name: '라벨스티커', unitCostKrw: 94, vendorName: '레드프린팅', spec: '43*23' },
  { id: 'hb-mat-tape', itemCode: 'HB-TAPE', name: '박스테이프', unitCostKrw: 20, vendorName: '지오테이프', spec: '48mm' },
  { id: 'hb-mat-belt', itemCode: 'HB-BELT', name: '띠지', unitCostKrw: 225, vendorName: '에이스패키지', spec: '122*22.8' },
  { id: 'hb-mat-nz-st', itemCode: 'HB-NZ-ST', name: '노루지 스티커', unitCostKrw: 50, vendorName: '에이스패키지' },
  { id: 'hb-mat-dust-ss', itemCode: 'HB-DUST-SS', name: '더스트백SS', unitCostKrw: 600, vendorName: 'LUMEN패키지' },
  { id: 'hb-mat-dust-s', itemCode: 'HB-DUST-S', name: '더스트백S', unitCostKrw: 1190, vendorName: 'LUMEN패키지' },
  { id: 'hb-mat-dust-m', itemCode: 'HB-DUST-M', name: '더스트백M', unitCostKrw: 1290, vendorName: 'LUMEN패키지' },
  { id: 'hb-mat-nz-ss', itemCode: 'HB-NZ-SS', name: '노루지SS', unitCostKrw: 23, vendorName: '에이스패키지' },
  { id: 'hb-mat-nz-s', itemCode: 'HB-NZ-S', name: '노루지S', unitCostKrw: 200, vendorName: '에이스패키지' },
  { id: 'hb-mat-nz-m', itemCode: 'HB-NZ-M', name: '노루지M', unitCostKrw: 200, vendorName: '에이스패키지' },
  { id: 'hb-mat-nz-l', itemCode: 'HB-NZ-L', name: '노루지L', unitCostKrw: 200, vendorName: '에이스패키지' },
  { id: 'hb-mat-in-ss', itemCode: 'HB-IN-SS', name: '내부박스SS', unitCostKrw: 800, vendorName: '대화박스', spec: '164*154*50' },
  { id: 'hb-mat-in-s', itemCode: 'HB-IN-S', name: '내부박스S', unitCostKrw: 1780, vendorName: '대화박스', spec: '305*290*130' },
  { id: 'hb-mat-in-m', itemCode: 'HB-IN-M', name: '내부박스M', unitCostKrw: 2584, vendorName: '대화박스', spec: '265*310*185' },
  { id: 'hb-mat-in-l', itemCode: 'HB-IN-L', name: '내부박스L', unitCostKrw: 2584, vendorName: '대화박스', spec: '379*354*144' },
  { id: 'hb-mat-in-xl', itemCode: 'HB-IN-XL', name: '내부박스XL', unitCostKrw: 2584, vendorName: '대화박스', spec: '489*389*184' },
  { id: 'hb-mat-out-ss', itemCode: 'HB-OUT-SS', name: '택배박스SS', unitCostKrw: 265, vendorName: '동명포장' },
  { id: 'hb-mat-out-s', itemCode: 'HB-OUT-S', name: '택배박스S', unitCostKrw: 470, vendorName: '동명포장' },
  { id: 'hb-mat-out-m', itemCode: 'HB-OUT-M', name: '택배박스M', unitCostKrw: 540, vendorName: '동명포장' },
  { id: 'hb-mat-out-l', itemCode: 'HB-OUT-L', name: '택배박스L', unitCostKrw: 800, vendorName: '동명포장' },
];

const COMMON = ['HB-MAN', 'HB-ENV', 'HB-LABEL', 'HB-TAPE', 'HB-BELT'];

const KITS = [
  { styleNo: 'BOX-SS', name: '박스SS', itemId: 'hb-box-ss', bomId: 'hb-bom-ss', size: 'SS', boxSpec: '164*154*50',
    sizeCodes: ['HB-DUST-SS', 'HB-NZ-SS', 'HB-NZ-ST', 'HB-IN-SS', 'HB-OUT-SS'] },
  { styleNo: 'BOX-S', name: '박스S', itemId: 'hb-box-s', bomId: 'hb-bom-s', size: 'S', boxSpec: '305*290*130',
    sizeCodes: ['HB-DUST-S', 'HB-NZ-S', 'HB-IN-S', 'HB-OUT-S'] },
  { styleNo: 'BOX-M', name: '박스M', itemId: 'hb-box-m', bomId: 'hb-bom-m', size: 'M', boxSpec: '265*310*185',
    sizeCodes: ['HB-DUST-M', 'HB-NZ-M', 'HB-IN-M', 'HB-OUT-M'] },
  { styleNo: 'BOX-L', name: '박스L', itemId: 'hb-box-l', bomId: 'hb-bom-l', size: 'L', boxSpec: '379*354*144',
    sizeCodes: ['HB-DUST-M', 'HB-NZ-L', 'HB-IN-L', 'HB-OUT-L'] },
  { styleNo: 'BOX-XL-HB', name: '박스XL-HB', itemId: 'hb-box-xl-hb', bomId: 'hb-bom-xl-hb', size: 'XL', boxSpec: '489*389*184',
    sizeCodes: ['HB-DUST-M', 'HB-NZ-L', 'HB-IN-XL', 'HB-OUT-L'] },
];

function mat(code) {
  const m = MATERIALS.find(x => x.itemCode === code);
  if (!m) throw new Error(`자재 없음: ${code}`);
  return m;
}

function kitLines(sizeCodes) {
  return [...COMMON, ...sizeCodes].map(code => {
    const m = mat(code);
    return {
      id: randomUUID(),
      category: '포장재',
      itemName: m.name,
      spec: m.spec || null,
      unit: 'EA',
      unitPriceCny: m.unitCostKrw,
      netQty: 1,
      lossRate: 0,
      isHqProvided: true,
      vendorName: m.vendorName,
      memo: m.itemCode,
      materialId: m.id,
      itemCode: m.itemCode,
    };
  });
}

async function main() {
  const env = loadEnv();
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 필요');
  const sb = createClient(url, key);
  const ts = new Date().toISOString();

  console.log('── 자재마스터 등록 ──');
  for (const m of MATERIALS) {
    const { error } = await sb.from('materials').upsert({
      id: m.id,
      item_code: m.itemCode,
      name: m.name,
      category: '포장재',
      spec: m.spec || null,
      unit: 'EA',
      unit_price_krw: m.unitCostKrw,
      memo: `[HB PACK] ${m.vendorName}`,
      updated_at: ts,
      created_at: ts,
    }, { onConflict: 'id' });
    if (error) console.error(' material fail', m.itemCode, error.message);
    else console.log(`  ✓ ${m.itemCode} ${m.name} ₩${m.unitCostKrw}`);
  }

  console.log('── 패키지 품목 + BOM ──');
  for (const pkg of KITS) {
    const lines = kitLines(pkg.sizeCodes);
    const total = lines.reduce((s, l) => s + l.unitPriceCny * l.netQty, 0);
    const colorBom = { color: '기본', lines, postProcessLines: [], processingFee: 0 };

    const itemRow = {
      id: pkg.itemId,
      style_no: pkg.styleNo,
      name: pkg.name,
      name_en: pkg.styleNo,
      season: '26SS',
      category: '기타',
      custom_category: '패키지키트',
      erp_category: 'ACC', // DB enum 호환 — 클라에서 PACK 정규화
      material_type: '완제품',
      item_status: 'ACTIVE',
      material: `핸드백용 ${pkg.name} (${pkg.boxSpec})`,
      packing_size: pkg.size,
      delivery_price: total,
      base_cost_krw: total,
      has_bom: true,
      designer: 'PACK-HB',
      memo: `[PACK][HB] ${pkg.boxSpec} · 택배운임 제외`,
      colors: [{ name: '기본' }],
      updated_at: ts,
      created_at: ts,
    };
    const { error: ie } = await sb.from('items').upsert(itemRow, { onConflict: 'id' });
    if (ie) console.error(' item fail', pkg.styleNo, ie.message);
    else console.log(`  ✓ item ${pkg.styleNo} ${pkg.name} ₩${total.toLocaleString('ko-KR')}`);

    const bomRow = {
      id: pkg.bomId,
      style_id: pkg.itemId,
      style_no: pkg.styleNo,
      style_name: pkg.name,
      season: '26SS',
      erp_category: 'ACC',
      currency: 'KRW',
      exchange_rate_cny: 1,
      pre_materials: lines,
      post_materials: lines,
      color_boms: [colorBom],
      post_color_boms: [colorBom],
      post_processing_fee: 0,
      post_process_lines: [],
      post_subtotal_krw: total,
      post_total_cost_krw: total,
      packing_cost_krw: total,
      packaging_cost_krw: 0,
      logistics_cost_krw: 0,
      production_margin_rate: 0,
      manufacturing_country: '한국',
      memo: JSON.stringify({ isPackBom: true, isSimpleCost: true, simplePostCostKrw: total }),
      updated_at: ts,
      created_at: ts,
    };
    const { error: be } = await sb.from('boms').upsert(bomRow, { onConflict: 'id' });
    if (be) console.error(' bom fail', pkg.styleNo, be.message);
    else console.log(`  ✓ bom  ${pkg.styleNo} (${lines.length} lines)`);
  }

  console.log('완료');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
