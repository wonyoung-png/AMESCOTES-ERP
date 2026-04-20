// 공장 BOM 원가표 Excel 파싱 유틸
// BomManagement 와 ItemMaster 에서 공유

const SECTION_MAP: Record<string, string> = {
  '원': '원자재',
  '지퍼': '지퍼',
  '장식': '장식',
  '보강': '보강재',
  '봉사': '봉사·접착제',
  '포장': '포장재',
  '철형': '철형',
};

function detectCategory(cellVal: string): string | null {
  for (const [key, cat] of Object.entries(SECTION_MAP)) {
    if (cellVal.includes(key)) return cat;
  }
  return null;
}

export interface ParsedBomSheet {
  materials: any[];
  parsedProcessingFee: number;
  parsedRate: number;
  postProcessLines: any[];
}

/**
 * 공장 원가표 Excel 시트 파싱
 * 컬럼 구조 (고정):
 *   A(0):구분  B(1):부위/품목  C(2):자재명  D(3):규격  E(4):단위
 *   F(5):단가  G(6):NET  H(7):LOSS  I(8):소요량  J(9):제조금액
 *   K(10):본사제공  M(12):구매업체
 * 후가공 섹션: B열=작업명, C열=수량, D열=단가
 * 임가공비: '임가공' 키워드 행의 I열(8)
 * 환율: row[8]의 I열(8)
 */
export function parseExcelBomSheet(
  raw: (string | number | null)[][],
  fallbackRate: number
): ParsedBomSheet {
  const getString = (row: (string | number | null)[], col: number) =>
    String(row?.[col] ?? '').trim();
  const getNum = (row: (string | number | null)[], col: number) => {
    const v = Number(row?.[col]);
    return isNaN(v) ? 0 : v;
  };

  // 1. 환율: row index 8의 I열(8)
  let parsedRate = 0;
  if (raw[8]) parsedRate = getNum(raw[8], 8);
  if (!parsedRate) {
    for (let r = 0; r < Math.min(20, raw.length); r++) {
      const row = raw[r];
      if (!row) continue;
      const rowStr = row.map(c => String(c ?? '')).join(' ');
      if (rowStr.includes('환율') || rowStr.includes('汇率') || rowStr.includes('Exchange')) {
        for (let c = row.length - 1; c >= 0; c--) {
          const v = Number(row[c]);
          if (v > 100 && v < 300) { parsedRate = v; break; }
        }
      }
    }
  }
  if (!parsedRate) parsedRate = fallbackRate;

  // 2. 헤더 행 찾기 (구분/품목 + 단가 포함)
  let dataStart = 10;
  for (let r = 0; r < Math.min(30, raw.length); r++) {
    const row = raw[r];
    if (!row) continue;
    const rowStr = row.map(c => String(c ?? '')).join(' ');
    if ((rowStr.includes('구분') || rowStr.includes('품목')) && rowStr.includes('단가')) {
      dataStart = r + 1;
      break;
    }
  }

  const materials: any[] = [];
  const postProcessLines: any[] = [];
  let parsedProcessingFee = 0;
  let currentCategory = '원자재';
  let inPostProcess = false;

  for (let r = dataStart; r < raw.length; r++) {
    const row = raw[r];
    if (!row) continue;

    const cellA = getString(row, 0);
    const cellB = getString(row, 1);
    const cellC = getString(row, 2);
    const cellK = getString(row, 10);
    const rowStr = row.map(c => String(c ?? '')).join(' ');

    // 후가공 섹션 시작 감지
    if (!inPostProcess && (rowStr.includes('부·소모재') || rowStr.includes('부소모재') || cellA.includes('후가공'))) {
      inPostProcess = true;
      continue;
    }

    // 구분(A열)으로 섹션 갱신
    if (cellA && !inPostProcess) {
      const detected = detectCategory(cellA);
      if (detected) currentCategory = detected;
      if (cellA.includes('소계') || cellA.includes('합계') || cellA.includes('총계')) continue;
    }

    // 임가공비 행 감지: G열(6)='임가공', 값은 I열(8)
    const cellG = row[6] ? String(row[6]).trim() : '';
    if (cellG.includes('임가공')) {
      const fee = getNum(row, 8);
      if (fee > 0) parsedProcessingFee = fee;
      continue;
    }
    if (cellG.includes('공장단가') || cellG.includes('제품원가')) continue;
    if (rowStr.includes('공장단가') || rowStr.includes('제품원가')) continue;

    // 후가공 섹션 처리
    if (inPostProcess) {
      const workName = cellB;
      if (!workName || workName === '소계' || workName === '공임비' || workName === 'NET') continue;
      const netQtyPost = getNum(row, 2);
      const unitPrice = getNum(row, 3);
      if (workName && unitPrice > 0) {
        postProcessLines.push({
          id: Math.random().toString(36).slice(2),
          name: workName.trim(),
          netQty: netQtyPost || 1,
          unitPrice,
          memo: '',
        });
      }
      continue;
    }

    // 자재명: C열 우선, 없으면 B열
    const itemName = cellC || cellB;
    if (!itemName) continue;
    if (itemName.includes('소계') || itemName.includes('합계') || itemName.includes('총계')) continue;

    const subPart = cellC ? cellB : undefined;
    const spec = getString(row, 3);
    const unit = getString(row, 4) || 'EA';
    const unitPriceRaw = getNum(row, 5);
    const netQty = getNum(row, 6);
    const lossRate = getNum(row, 7);
    const qtyDirect = getNum(row, 8);
    const amountDirect = getNum(row, 9);

    const effectiveNet = netQty || qtyDirect;
    if (!effectiveNet && !amountDirect) continue;

    let unitPrice = unitPriceRaw;
    if (!unitPrice && amountDirect > 0 && qtyDirect > 0) {
      unitPrice = amountDirect / qtyDirect;
    }

    const isHqProvided = cellK.length > 0 && cellK !== '0';
    const vendorName = getString(row, 12);

    materials.push({
      id: Math.random().toString(36).slice(2),
      category: currentCategory,
      subPart: subPart || undefined,
      itemName,
      spec,
      unit,
      unitPriceCny: unitPrice,
      netQty: netQty || qtyDirect,
      lossRate: lossRate || 0,
      isHqProvided,
      vendorName,
      memo: '',
    });
  }

  return { materials, parsedProcessingFee, parsedRate, postProcessLines };
}
