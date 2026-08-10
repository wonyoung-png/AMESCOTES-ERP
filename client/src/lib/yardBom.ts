// 소요량 계산 표 → BOM 자재 줄. 화면과 떼어 두어 그대로 돌려볼 수 있게 한다.

/** 소요량 계산 — 자재 종류. 종류마다 표가 따로 있고 단위가 다르다 */
export const YARD_KINDS = ['가죽', '원단', '안감', '보강재'] as const;
export type YardKind = typeof YARD_KINDS[number];
/** 부위 — 종류 안에서 다시 갈린다. 가죽 바디 / 가죽 트림1 … 각각 소요량이 따로 나온다.
 *  보강재는 부위를 쓰지 않는다. */
export const YARD_PARTS = ['바디', '트림1', '트림2'];
/** 종류별 계산 단위 */
export const YARD_UNIT: Record<YardKind, string> = { '가죽': 'SF', '원단': 'YD', '안감': 'YD', '보강재': 'M' };
/** 보강재 롤 폭 — 52인치 */
export const ROLL_52IN = 132;
/** 소요량 계산 표의 한 줄 — 폭·로스는 줄이 아니라 종류에 달린다 */
export type YardRow = {
  id: string;
  kind: YardKind;
  part: string;      // 보강재는 빈 값
  패턴부위: string;  // CAD 조각 이름 (예: 가락지 겉감 420D)
  가로: number;      // cm
  세로: number;      // cm
  수량: number;
};
/** 종류별 설정 — 폭(가죽 제외)과 로스율은 종류마다 하나씩 */
export type YardCfg = Record<YardKind, { 폭: number; 로스: number }>;
export const DEFAULT_YARD_CFG: YardCfg = {
  '가죽': { 폭: 0, 로스: 15 },
  '원단': { 폭: 0, 로스: 10 },
  '안감': { 폭: 0, 로스: 10 },
  '보강재': { 폭: ROLL_52IN, 로스: 10 },
};

/** 한 줄의 순소요량 — 가죽 SF / 원단·안감 YD / 보강재 M */
export function yardRowNet(r: YardRow, cfg: YardCfg): number {
  if (r.kind === '가죽') return (r.가로 + 0.5) * (r.세로 + 0.5) * r.수량 / 10000 * 10.764;
  const w = cfg[r.kind]?.폭 || 0;
  if (!w) return 0;
  const cm2 = r.가로 * r.세로 * r.수량;
  return r.kind === '보강재' ? cm2 / w / 100 : cm2 / w / 91.44;
}

/** 부위를 쓰는 종류 — 가죽·원단만. 안감·보강재는 부위가 없다 */
export const usesPart = (k: YardKind) => k === '가죽' || k === '원단';

export type YardBucket = {
  key: string;          // 같은 줄을 다시 찾는 열쇠 (부위 또는 패턴부위)
  subPart?: string;     // BOM 부위
  itemName: string;     // 보강재만 자동으로 채운다
  net: number;
};

/** BOM 에 만들 줄 목록.
 *  · 가죽·원단 : 부위(바디/트림1/트림2)마다 한 줄 — 부위별로 자재가 다르다
 *  · 안감      : 한 줄 (부위 없음)
 *  · 보강재    : 자재가 제각각이라 패턴부위마다 한 줄 */
export function buildYardBuckets(k: YardKind, rows: YardRow[], cfg: YardCfg): YardBucket[] {
  const mine = rows.filter(r => r.kind === k);
  if (!mine.length) return [];

  if (k === '보강재') {
    return mine.map(r => ({
      key: r.패턴부위 || r.id,
      itemName: r.패턴부위 || '',
      net: yardRowNet(r, cfg),
    }));
  }
  if (!usesPart(k)) {
    return [{ key: k, subPart: '안감', itemName: '', net: mine.reduce((s, r) => s + yardRowNet(r, cfg), 0) }];
  }
  return YARD_PARTS
    .filter(p => mine.some(r => (r.part || '바디') === p))
    .map(p => ({
      key: p,
      subPart: p,
      itemName: '',
      net: mine.filter(r => (r.part || '바디') === p).reduce((s, r) => s + yardRowNet(r, cfg), 0),
    }));
}
