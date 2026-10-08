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

/** 본부장 (팀장과 별개) */
export const DIVISION_HEADS: Record<string, string> = { '브랜드': '이원영', '머천다이징': '양리라', '생산': '이원영' };

const byName = new Map<string, string>();
for (const t of ORG) for (const p of t.members) if (!byName.has(p.name)) byName.set(p.name, t.key); // 겸직은 첫 팀(=팀장 팀)
/** 사람 이름 → 조직 팀 */
export const orgTeamOfName = (name?: string | null) => (name ? byName.get(name.trim()) : undefined);
export const orgTeam = (key: string) => ORG.find(t => t.key === key);
