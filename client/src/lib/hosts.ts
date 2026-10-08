/**
 * 형제 서비스 주소를 지금 보고 있는 주소에서 계산한다.
 *
 * 전에는 'https://daily.54-116-241-64.sslip.io' 처럼 코드에 주소가 박혀 있었다.
 * 서버를 옮기자 IP 가 바뀌었고, 그때마다 다섯 파일 아홉 군데를 손으로 고쳐야 했다.
 * 한 군데라도 빠뜨리면 그 링크만 조용히 옛 서버를 가리킨다 — 옛 서버가 살아 있으면
 * 눈치채지도 못한다.
 *
 * erp.ameserp.kr 에서 보고 있으면 daily 는 daily.ameserp.kr 이다. 앞 한 조각만 갈아끼운다.
 */
function rootDomain(): string {
  const h = typeof location !== 'undefined' ? location.hostname : '';
  // localhost·IP 직접 접속은 형제 주소를 만들 수 없다
  if (!h || h === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(h)) return '';
  const parts = h.split('.');
  // erp.ameserp.kr -> ameserp.kr / ameserp.kr -> ameserp.kr
  return parts.length > 2 ? parts.slice(1).join('.') : h;
}

/** 예: sibling('daily') -> https://daily.ameserp.kr (못 만들면 빈 문자열) */
export function sibling(sub: string): string {
  const root = rootDomain();
  return root ? `https://${sub}.${root}` : '';
}

export const PMS_URL = () => {
  const b = sibling('daily');
  return b ? `${b}/app/` : '';
};
export const PMS_API = () => sibling('daily');
export const OS_URL = () => {
  const b = sibling('os');
  return b ? `${b}/` : '';
};
export const CEO_URL = () => {
  const b = sibling('ceo');
  return b ? `${b}/` : '';
};
