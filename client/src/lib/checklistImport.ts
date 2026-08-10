// 대표가 쓰던 마크다운 체크리스트를 프로젝트 항목으로 쪼갠다.
//
// 옮겨적는 비용이 있으면 아무도 안 쓴다. 형식을 바꾸라고 하지 않고 쓰던 형식을 읽는다.
// 실제 문서(한남 플래그십 오픈 체크리스트 71항목)로 검증한 규칙만 넣었다.
//
//   ## 1. 8월 (D-125 ~ D-100) — 발주·계약 착수      → 페이즈
//   ### 생산 발주 (리드타임 최장, 가장 급함)          → 구역
//   - [ ] 참 금형 필요 여부 확인 / 마감 **8/31** / 확인처: 생산팀
//         ↑완료   ↑제목                  ↑기한      ↑담당
//   마감 날짜를 굵게 쓴 것 = 급하다고 표시한 것

import type { ProjectItem } from './projectQueries';

const PHASE_RE = /^##\s+(?!#)(.*)$/;
const AREA_RE = /^###\s+(.*)$/;
const ITEM_RE = /^\s*[-*]\s*\[([ xX])\]\s*(.*)$/;
const DUE_RE = /마감\s*\*{0,2}(\d{1,2})\/(\d{1,2})\*{0,2}/;
const OWNER_RE = /확인처\s*[:：]\s*([^/]+)/;
const MONEY_RE = /금액\s*([0-9,]+|_+)/;
const URGENT_RE = /마감\s*\*\*\d{1,2}\/\d{1,2}\*\*/;

const clean = (s: string) => s.replace(/\*\*|`|\[\[|\]\]/g, '').replace(/^[\s·\-—]+|[\s·\-—]+$/g, '');

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export interface ParsedChecklist {
  items: Omit<ProjectItem, 'projectId'>[];
  phases: string[];
  areas: string[];
  /** 연도가 안 적힌 '8/31' 같은 날짜를 어느 해로 읽었는지 */
  year: number;
}

/**
 * @param text 붙여넣은 마크다운
 * @param year '8/31'처럼 연도 없는 날짜에 붙일 해. 보통 프로젝트 앵커 연도.
 */
export function parseChecklist(text: string, year: number): ParsedChecklist {
  let phase = '';
  let area = '';
  const items: Omit<ProjectItem, 'projectId'>[] = [];
  const phases: string[] = [];
  const areas: string[] = [];

  text.split(/\r?\n/).forEach(line => {
    const ph = PHASE_RE.exec(line);
    if (ph) {
      phase = clean(ph[1]);
      area = '';
      if (phase && !phases.includes(phase)) phases.push(phase);
      return;
    }
    const ar = AREA_RE.exec(line);
    if (ar) {
      area = clean(ar[1]);
      if (area && !areas.includes(area)) areas.push(area);
      return;
    }
    const it = ITEM_RE.exec(line);
    if (!it) return;

    const done = it[1].toLowerCase() === 'x';
    const body = it[2];

    const d = DUE_RE.exec(body);
    const due = d
      ? `${year}-${String(+d[1]).padStart(2, '0')}-${String(+d[2]).padStart(2, '0')}`
      : undefined;

    const o = OWNER_RE.exec(body);
    const owner = o ? clean(o[1]) : undefined;

    const m = MONEY_RE.exec(body);
    const budget = m && !m[1].startsWith('_') ? Number(m[1].replace(/,/g, '')) : undefined;

    // 제목은 첫 ' / ' 앞. 그 안에서 ' — ' 뒤는 설명으로 뗀다
    const head = body.split(' / ')[0];
    const [rawTitle, ...restDetail] = head.split(' — ');
    const title = clean(rawTitle);
    if (!title) return;

    items.push({
      id: uid(),
      phase,
      area,
      title,
      detail: restDetail.length ? clean(restDetail.join(' — ')) : undefined,
      due,
      owner,
      budget,
      urgent: URGENT_RE.test(body),
      // '선결 결정' 같은 0번 블록은 뒤를 막는 항목이다
      blocker: /^0[.\s]|선결|블로커/.test(phase),
      done,
      sortNo: items.length,
    });
  });

  return { items, phases, areas, year };
}
