// 스타일번호 생성 — 품목마스터·샘플관리가 같은 규칙을 쓴다
// 형식: [브랜드코드][YY][MM][타입코드][일련2자리]  예) AT2608HB01
import type { Category, ErpCategory, Item } from './store';

export const CATEGORY_CODE_MAP: Partial<Record<Category, string>> = {
  '숄더백': 'HB', '토트백': 'HB', '크로스백': 'HB', '클러치': 'HB', '백팩': 'BP',
  '파우치': 'SL', '키링': 'SL', '지갑': 'SL',
  '스니커즈': 'SH', '힐': 'SH', '로퍼': 'SH', '부츠': 'SH', '샌들': 'SH',
  '택배박스': 'PK', '내부박스': 'PK', '더스트백': 'PK', '쇼핑백': 'PK', '노루지': 'PK', '소모품': 'PK',
  '기타': 'ETC',
};

export function generateStyleNo(
  brandCode: string,
  registDate: Date,
  category: Category,
  existingItems: Item[],
  currentItemId?: string,
  erpCategory?: ErpCategory,
): string {
  const yy = String(registDate.getFullYear()).slice(2);
  const mm = String(registDate.getMonth() + 1).padStart(2, '0');
  let typeCode = CATEGORY_CODE_MAP[category] || 'HB';
  if (erpCategory === 'ACC') typeCode = 'AC';
  else if (erpCategory === 'SHOES') typeCode = 'SH';
  else if (erpCategory === 'PACK') typeCode = 'PK';
  else if (erpCategory === 'HB') typeCode = CATEGORY_CODE_MAP[category] || 'HB';
  const prefix = `${brandCode.toUpperCase()}${yy}${mm}${typeCode}`;
  const existing = existingItems.filter(it => it.styleNo?.startsWith(prefix) && it.id !== currentItemId);
  let maxSeq = 0;
  for (const it of existing) {
    const seq = parseInt(it.styleNo.slice(prefix.length), 10);
    if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
  }
  return `${prefix}${String(maxSeq + 1).padStart(2, '0')}`;
}
