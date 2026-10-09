/**
 * LUMEN 27SS RRP 엑셀 → 바이어(LUMEN) + 품목 일괄 등록
 * 사용: node scripts/seed-lumen-27ss.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const XLSX_PATH = path.join(process.env.USERPROFILE || '', 'Downloads', '[ATLM] 27SS RRP.xlsx');

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

const NAME_COLOR_RE = /^(.+?)\s*[\(（]\s*([^\)）]+)\s*[\)）]\s*(.*)$/s;

/** 괄호 없는 국문(슈즈 등)용 — 긴 것 우선 */
const KO_COLOR_SUFFIXES = [
  '세이지 그린', '탄브라운', '탄 브라운', '소프트 블랙', '다크 브라운',
  '빈티지 브라운', '오프 화이트', '아이보리', '블랙', '레드', '화이트',
];

function cleanSpaces(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function splitNameColor(enRaw, koRaw) {
  let en = cleanSpaces(enRaw).replace(/\bBAG BAG\b/gi, 'BAG');
  let ko = cleanSpaces(koRaw).split(/\n/)[0]; // 벨트 규격 줄 제거

  let enName = en;
  let koName = ko;
  let colorEn = '';
  let colorKo = '';
  let leftover = '';

  const em = en.match(NAME_COLOR_RE);
  if (em) {
    enName = cleanSpaces(em[1]);
    colorEn = cleanSpaces(em[2]);
    leftover = cleanSpaces(em[3]);
  }
  const km = ko.match(NAME_COLOR_RE);
  if (km) {
    koName = cleanSpaces(km[1]);
    colorKo = cleanSpaces(km[2]);
  } else if (ko) {
    for (const suf of KO_COLOR_SUFFIXES) {
      if (ko.endsWith(suf) && ko.length > suf.length + 1) {
        koName = cleanSpaces(ko.slice(0, -suf.length));
        colorKo = suf;
        break;
      }
    }
  }

  // 영문 없을 때 국문만 (슈즈)
  if (!enName && koName) enName = koName;
  if (!koName && enName) koName = enName;

  return {
    enName,
    koName,
    colorEn: colorEn || colorKo,
    colorKo: colorKo || colorEn,
    leftover,
  };
}

function inferCats(enName, rawCat) {
  const u = enName.toUpperCase();
  const rc = String(rawCat || '').toLowerCase();
  if (rc.includes('shoe') || /FLAT|SANDAL|PUMP|HEEL|로퍼|샌들|힐|슬링|펌프|쪼리|발렛|플랫/.test(u + enName)) {
    let category = '기타';
    if (/SANDAL|샌들|쪼리/.test(u + enName)) category = '샌들';
    else if (/HEEL|힐|펌프|PUMP|슬링/.test(u + enName)) category = '힐';
    else if (/FLAT|발렛|플랫/.test(u + enName)) category = '로퍼';
    return { erpCategory: 'SHOES', category };
  }
  if (rc === 'acc' || /WALLET|CASE|CHARM|BELT|FAN|CARD|LIP/.test(u)) {
    let category = '기타';
    if (/WALLET|CARD|CASE/.test(u)) category = '지갑';
    if (/CHARM|KEY|FAN/.test(u)) category = '키링';
    return { erpCategory: 'ACC', category };
  }
  // bag / default HB
  let category = '숄더백';
  if (/TOTE/.test(u)) category = '토트백';
  else if (/CROSS/.test(u)) category = '크로스백';
  else if (/CLUTCH/.test(u)) category = '클러치';
  else if (/BACKPACK|백팩/.test(u)) category = '백팩';
  return { erpCategory: 'HB', category };
}

function typeCode(erpCategory, category) {
  if (erpCategory === 'ACC') return 'AC';
  if (erpCategory === 'SHOES') return 'SH';
  if (category === '백팩') return 'BP';
  return 'HB';
}

function slug(enName) {
  return enName.toLowerCase().replace(/[^a-z0-9가-힣]+/gi, '-').replace(/^-|-$/g, '') || 'item';
}

function parseWorkbook(filePath) {
  const wb = XLSX.readFile(filePath);
  const data = XLSX.utils.sheet_to_json(wb.Sheets['27SS RRP'], { header: 1, defval: '' });
  const rows = data.slice(5).filter(r => cleanSpaces(r[8]) || cleanSpaces(r[9]));
  const map = new Map();

  for (const r of rows) {
    const season = cleanSpaces(r[3]) || '27SS';
    const rawCat = cleanSpaces(r[6]);
    const { enName, koName, colorEn, colorKo, leftover } = splitNameColor(r[8], r[9]);
    if (!enName && !koName) continue;
    const key = enName.toUpperCase();
    const price = Number(r[19]) || 0;
    if (!map.has(key)) {
      const cats = inferCats(enName, rawCat);
      map.set(key, {
        enName,
        koName,
        season,
        ...cats,
        colors: [],
        prices: [],
        memoExtra: leftover || '',
      });
    }
    const g = map.get(key);
    if (colorEn) {
      const exists = g.colors.some(c => c.name.toUpperCase() === colorEn.toUpperCase());
      if (!exists) {
        g.colors.push({
          name: colorEn,
          leatherColor: colorKo && colorKo !== colorEn ? colorKo : undefined,
        });
      }
    }
    if (price > 0) g.prices.push(price);
    if (leftover && !g.memoExtra.includes(leftover)) {
      g.memoExtra = [g.memoExtra, leftover].filter(Boolean).join(' · ');
    }
  }

  return [...map.values()].map(g => ({
    ...g,
    kmsrp: g.prices.length ? Math.round(g.prices.sort((a, b) => a - b)[Math.floor(g.prices.length / 2)]) : 0,
  }));
}

async function main() {
  if (!fs.existsSync(XLSX_PATH)) throw new Error(`엑셀 없음: ${XLSX_PATH}`);
  const env = loadEnv();
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('VITE_SUPABASE_URL / ANON_KEY 필요');
  const supabase = createClient(url, key);

  const products = parseWorkbook(XLSX_PATH);
  console.log(`파싱 완료: ${products.length}개 품목 (컬러 합산)`);
  for (const p of products) {
    console.log(` - ${p.enName} / ${p.koName} | ${p.colors.map(c => c.name).join(', ') || '-'} | KMSRP ${p.kmsrp || 0} | ${p.erpCategory}/${p.category}`);
  }

  // 1) 바이어 LUMEN
  const BUYER_ID = 'vendor-lumen-buyer';
  const { data: existingVendors } = await supabase.from('vendors').select('id,code,name,type');
  let buyer = (existingVendors || []).find(v =>
    v.code === 'LLL' || String(v.name).toUpperCase() === 'LUMEN' || String(v.name).includes('루멘'),
  );
  if (!buyer) {
    const row = {
      id: BUYER_ID,
      code: 'LLL',
      name: 'LUMEN',
      company_name: 'LUMEN',
      type: '바이어',
      country: '한국',
      currency: 'KRW',
      memo: 'LUMEN 브랜드 (27SS RRP 자동등록)',
    };
    const { error } = await supabase.from('vendors').upsert(row);
    if (error) throw new Error('vendor: ' + error.message);
    buyer = { id: BUYER_ID, code: 'LLL', name: 'LUMEN' };
    console.log('✓ 바이어 생성: LUMEN (LLL)');
  } else {
    // 이름만 LUMEN으로 맞춤 (코드 유지)
    await supabase.from('vendors').update({
      name: 'LUMEN',
      code: buyer.code || 'LLL',
      type: '바이어',
      company_name: 'LUMEN',
    }).eq('id', buyer.id);
    console.log(`✓ 바이어 사용: ${buyer.name} → LUMEN (${buyer.id})`);
    buyer = { ...buyer, name: 'LUMEN', code: buyer.code || 'LLL' };
  }

  const buyerId = buyer.id;
  const brandCode = (buyer.code || 'LLL').toUpperCase();

  // 2) 기존 LUMEN 27SS 스타일번호·품목 조회 (중복 방지)
  const { data: existingItems } = await supabase
    .from('items')
    .select('id, style_no, name_en, name, season, buyer_id');

  const byEn = new Map();
  for (const it of existingItems || []) {
    if (it.season === '27SS' && (it.buyer_id === buyerId || String(it.name_en || '').toUpperCase())) {
      const k = String(it.name_en || it.name || '').toUpperCase();
      if (k) byEn.set(k, it);
    }
  }

  // 스타일번호 시퀀스: LLL2607 + type + seq
  const regist = new Date(2026, 6, 15); // 2026-07
  const yy = String(regist.getFullYear()).slice(2);
  const mm = String(regist.getMonth() + 1).padStart(2, '0');
  const seqMap = { HB: 0, AC: 0, SH: 0, BP: 0 };
  for (const it of existingItems || []) {
    const sn = it.style_no || '';
    for (const tc of Object.keys(seqMap)) {
      const prefix = `${brandCode}${yy}${mm}${tc}`;
      if (sn.startsWith(prefix)) {
        const n = parseInt(sn.slice(prefix.length), 10);
        if (!isNaN(n) && n > seqMap[tc]) seqMap[tc] = n;
      }
    }
  }

  const now = new Date().toISOString();
  let created = 0;
  let updated = 0;

  for (const p of products) {
    const tc = typeCode(p.erpCategory, p.category);
    const key = p.enName.toUpperCase();
    const existing = byEn.get(key);
    let styleNo;
    let id;
    if (existing) {
      id = existing.id;
      styleNo = existing.style_no;
      updated++;
    } else {
      seqMap[tc] = (seqMap[tc] || 0) + 1;
      styleNo = `${brandCode}${yy}${mm}${tc}${String(seqMap[tc]).padStart(2, '0')}`;
      id = `lumen-27ss-${slug(p.enName)}`;
      // id 충돌 시 style 기반
      if ((existingItems || []).some(x => x.id === id)) id = `lumen-27ss-${styleNo.toLowerCase()}`;
      created++;
    }

    const row = {
      id,
      style_no: styleNo,
      name: p.koName,
      name_en: p.enName,
      season: '27SS',
      erp_category: p.erpCategory,
      sub_category: p.category,
      buyer_id: buyerId,
      material: '',
      delivery_price: null,
      confirmed_sale_price: p.kmsrp > 0 ? p.kmsrp : null,
      has_bom: false,
      base_cost_krw: 0,
      colors: p.colors,
      memo: [
        'LUMEN 27SS RRP 자동등록',
        p.kmsrp ? `KMSRP ${p.kmsrp.toLocaleString()}KRW` : null,
        p.memoExtra || null,
      ].filter(Boolean).join(' · '),
      updated_at: now,
      created_at: existing?.created_at || now,
    };

    const { error } = await supabase.from('items').upsert(row, { onConflict: 'id' });
    if (error) {
      console.error(`✗ ${p.enName}:`, error.message);
      // confirmed_sale_price 없으면 재시도
      if (String(error.message).includes('confirmed_sale_price')) {
        const { confirmed_sale_price, ...rest } = row;
        const r2 = await supabase.from('items').upsert(rest, { onConflict: 'id' });
        if (r2.error) console.error('  retry fail', r2.error.message);
        else {
          await supabase.from('items').update({ confirmed_sale_price }).eq('id', id);
          console.log(`  → fallback OK ${styleNo}`);
        }
      }
    } else {
      console.log(`✓ ${styleNo}  ${p.enName}  colors=${p.colors.length}  KMSRP=${p.kmsrp}`);
    }
  }

  console.log(`\n완료: 신규 ${created} · 갱신 ${updated} · 합계 ${products.length}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
