// 회사 조직도 (10/8 대표 제공) — 대표 직속 팀 에이전트의 단위.
// 각 팀 members[0] 이 팀장. ERP 계정과는 이름으로 맞춘다 (계정은 나중에 일괄 등록).
// ponytail: 코드 상수. 조직 개편이 잦아지면 DB 테이블 + 대표 콘솔 편집으로.

export type OrgTeam = { key: string; division: string; focus: string; members: Array<{ name: string; rank: string }> };

const m = (s: string) => s.split(',').map(x => { const [name, rank] = x.trim().split(' '); return { name, rank }; });

export const DIVISIONS = ['브랜드', '머천다이징', '생산', '대표 직속'] as const;

export const ORG: OrgTeam[] = [
  { key: '루멘 디자인', division: '브랜드', focus: 'LUMEN 신상품 디자인·샘플 일정', members: m('박지영 대리, 강수연 대리, 송예진 주임') },
  { key: '에탈루프 디자인', division: '브랜드', focus: 'AETALOOF 디자인·샘플 일정', members: m('김건우 대리') },
  { key: '비주얼·콘텐츠', division: '브랜드', focus: '촬영·상세페이지·SNS 콘텐츠 일정', members: m('이유나 과장, 최지혜 대리, 한숙연 주임') },
  { key: '국내 MD', division: '머천다이징', focus: '국내 채널 기획전·리오더·재고', members: m('박지현 대리, 김유진 사원') },
  { key: '글로벌 MD', division: '머천다이징', focus: '해외몰·해외 채널 기획전·재고', members: m('양리라 과장, 서미연 대리, 원채은 대리') },
  { key: '리테일', division: '머천다이징', focus: '한남쇼룸 등 오프라인 매장 운영·매출', members: m('박혜지 과장, 김나리 대리, 서영훈 사원, 허예진 사원') },
  { key: '제품개발', division: '생산', focus: '샘플 개발·원가·BOM', members: m('최세용 차장, 김길성 실장, 이상형 과장, 정상철 주임, 강동환 사원') },
  { key: '생산관리', division: '생산', focus: '생산 발주·납기·자재', members: m('한현석 과장, 임남일 부장, 김병제 부장, 유연재 주임, 한윤상 사원') },
  { key: '물류·CS', division: '생산', focus: '출고·반품·고객 문의', members: m('최재민 과장, 강한구 대리') },
  { key: '일본법인', division: '대표 직속', focus: '일본 법인 영업·수주', members: m('인치성 법인장') },
  { key: '중국법인', division: '대표 직속', focus: '중국 법인·티몰·샤홍슈', members: m('오소연 법인장') },
  { key: '경영지원', division: '대표 직속', focus: '회계·인사·총무', members: m('강재구 과장') },
  { key: '영업', division: '대표 직속', focus: 'OEM·B2B 영업', members: m('황진현 과장') },
  { key: '마케팅', division: '대표 직속', focus: '광고·캠페인·인플루언서', members: m('백형준 과장, 박혜정 대리') },
];

/** 팀별 감시 기준 기본값 — 대표가 콘솔에서 고치면 team_watch 에 저장되고 그게 우선한다 */
export const DEFAULT_RULES: Record<string, string> = {
  '루멘 디자인': '기획전 준비 항목 중 디자인 몫이 마감 전에 끝나는지. 막힌 일이 3일 넘게 그대로면 보고.',
  '에탈루프 디자인': '기획전 준비 항목 중 디자인 몫이 마감 전에 끝나는지. 혼자인 팀이라 일이 몰리면 보고.',
  '비주얼·콘텐츠': '기획전 시작 7일 전까지 촬영·상세·SNS 준비가 끝났는지. 안 끝났으면 무엇이 남았는지 보고.',
  '국내 MD': '이번 달 매출이 목표 속도보다 느린지, 리오더 "지금 발주" 품목이 실제로 발주됐는지, 입고 늦은 리오더, 품절. 기획전 상품 준비.',
  '글로벌 MD': '해외몰 매출이 지난주보다 꺾였는지, 해외 판매 상품 품절. 기획전 준비.',
  '리테일': '한남쇼룸(매장) 매출이 지난주보다 떨어졌는지. 매장 기획전 준비.',
  '제품개발': '샘플이 예정일을 넘겼는지(누가 맡았는지), 공장 단가 없는 발주. 원가 미확정으로 발주가 막히면 보고.',
  '생산관리': '납기 지난 발주와 7일 안 납기 발주, 공장에 안 보낸 발주, 공장 답이 없는 발주, 본사 제공 자재 미구매. 납기 7일 전인데 자재 미구매면 바로 보고.',
  '물류·CS': '7일 안 입고 예정 물량에 맞춰 출고 준비가 되는지. 기획전 물류 준비.',
  '일본법인': '올라온 업무에서 수주·출고 약속이 지켜지는지.',
  '중국법인': '올라온 업무에서 티몰·샤홍슈 운영 이슈와 약속 이행.',
  '경영지원': '거래명세표 미청구, 청구 후 60일 넘은 미수금, 미청구 샘플비.',
  '영업': 'OEM 오더 진행 단계, 입고됐는데 명세표 안 끊은 오더, 미청구·미수.',
  '마케팅': '30일 안 기획전마다 마케팅 준비가 됐는지, 시작 7일 전 미준비 항목.',
};

/** 본부장 (팀장과 별개) */
export const DIVISION_HEADS: Record<string, string> = { '브랜드': '이원영', '머천다이징': '양리라', '생산': '이원영' };

/** 운영 경보가 여러 팀의 공동 판단을 요구할 때 쓰는 고정 매핑. AI가 참가 팀을 넓히지 않는다. */
export const RELATED_TEAMS: Record<string, string[]> = {
  inventory: ['국내 MD', '글로벌 MD', '마케팅', '물류·CS'],
  production: ['생산관리', '국내 MD'],
  campaign: ['마케팅', '국내 MD', '물류·CS'],
  sample: ['제품개발', '루멘 디자인', '에탈루프 디자인'],
  finance: ['경영지원', '영업'],
};

const byName = new Map<string, string>();
for (const t of ORG) for (const p of t.members) if (!byName.has(p.name)) byName.set(p.name, t.key); // 겸직은 첫 팀(=팀장 팀)
/** 사람 이름 → 조직 팀 */
export const orgTeamOfName = (name?: string | null) => (name ? byName.get(name.trim()) : undefined);
export const orgTeam = (key: string) => ORG.find(t => t.key === key);
