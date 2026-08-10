// 파서 자체 점검 — 붙여넣기가 깨지면 아무도 안 쓴다.
// 실제 '한남 플래그십 오픈 실행 체크리스트' 문서에서 발췌한 줄로 검증한다.
//
//   npx tsx client/src/lib/checklistImport.test.ts
import { parseChecklist } from './checklistImport';

const SAMPLE = `# 2026-08-10 플래그십 오픈 실행 체크리스트

기준일 2026-08-10 (월) · 프레스데이 12/14 = **D-125**

## 0. 선결 결정 — 이게 안 정해지면 아래가 다 막힘 (마감 8/17)

- [ ] **DIY 다이어리 유료/무료 결정** — 무료=순수비용, 유료=가격·POS 등록·정산 필요 / 마감 8/17 / 확인처: 대표
- [x] **총 예산 상한 확정** — 금액: ____ / 마감 8/17 / 확인처: 대표

## 1. 8월 (D-125 ~ D-100) — 발주·계약 착수

### 생산 발주 (리드타임 최장, 가장 급함)
- [ ] 한정 참(Charm) 디자인 확정 → 중국 공장 견적 / 마감 **8/20** / 금액 ____
- [ ] 인테리어 업체 선정 + 4개 층 설계 발주 / 마감 8/24 / 금액 3,000,000

### 법규·안전 (착수만 해도 8월 안에)
- [ ] 다중이용업소 해당 여부·인원 상한 확인 / 마감 8/24 / 확인처: 용산구청·관할 소방서

⚠️ 회전율 계산: DIY 1건 20분 — 이 줄은 항목이 아니다
`;

function main() {
  const r = parseChecklist(SAMPLE, 2026);
  const t = (n: number) => r.items[n];

  console.assert(r.items.length === 5, `항목 5개여야 하는데 ${r.items.length}`);
  console.assert(r.phases.length === 2, `페이즈 2개여야 하는데 ${r.phases.length}`);
  console.assert(r.areas.length === 2, `구역 2개여야 하는데 ${r.areas.length}`);

  // 선결 결정 = 뒤를 막는 항목
  console.assert(t(0).blocker, '선결 결정이 블로커로 안 잡혔다');
  console.assert(t(0).due === '2026-08-17', `마감일 ${t(0).due}`);
  console.assert(t(0).owner === '대표', `담당 ${t(0).owner}`);
  console.assert(t(0).title === 'DIY 다이어리 유료/무료 결정', `제목 "${t(0).title}"`);
  console.assert(t(0).detail?.startsWith('무료=순수비용'), `설명 "${t(0).detail}"`);

  // 체크된 항목
  console.assert(t(1).done, '완료 표시를 못 읽었다');

  // 마감일을 굵게 = 급함
  console.assert(t(2).urgent, '굵은 마감을 급함으로 안 봤다');
  console.assert(!t(3).urgent, '안 굵은 마감을 급함으로 봤다');
  console.assert(t(2).budget === undefined, '빈 금액칸(____)을 숫자로 읽었다');
  console.assert(t(3).budget === 3000000, `금액 ${t(3).budget}`);

  // 사외 확인처도 담당이다
  console.assert(t(4).owner === '용산구청·관할 소방서', `사외 담당 "${t(4).owner}"`);
  console.assert(t(4).area === '법규·안전 (착수만 해도 8월 안에)', `구역 "${t(4).area}"`);
  console.assert(!t(4).blocker, '1번 페이즈가 블로커로 잡혔다');

  // ⚠️ 메모 줄은 항목이 아니다
  console.assert(!r.items.some(i => i.title.includes('회전율')), '메모 줄이 항목으로 들어왔다');

  console.log('checklistImport OK —', r.items.length, '항목');
}

main();
