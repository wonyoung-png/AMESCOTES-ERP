/**
 * 형제 서비스 주소를 지금 보고 있는 주소에서 계산한다.
 *
 * 전에는 'https://daily.54-116-241-64.sslip.io' 처럼 코드에 주소가 박혀 있었다.
 * 서버를 옮기자 IP 가 바뀌었고, 그때마다 다섯 파일 아홉 군데를 손으로 고쳐야 했다.
 * 한 군데라도 빠뜨리면 그 링크만 조용히 옛 서버를 가리킨다 — 옛 서버가 살아 있으면
 * 눈치채지도 못한다.
 *
 * 기준 도메인은 빌드할 때 박는 게 먼저다 (VITE_ROOT_DOMAIN).
 * 없으면 지금 주소에서 짐작한다 — erp.ameserp.kr 이면 ameserp.kr.
 */

/** 두 조각짜리 최상위 도메인. amescotes.co.kr 에서 'co.kr' 을 떼면 안 된다 (코덱스 지적) */
const TWO_PART_TLD =
  /\.(co|or|ne|go|re|pe|ac|hs|ms|es|sc|kg|mil|seoul|busan|daegu|incheon|gwangju|daejeon|ulsan|gyeonggi|gangwon|chungbuk|chungnam|jeonbuk|jeonnam|gyeongbuk|gyeongnam|jeju)\.kr$|\.(co|ne|or|go|ac|ad|ed|gr|lg)\.jp$|\.(co|ac|gov|org|net|me|ltd|plc|sch)\.uk$|\.(com|net|org|gov|edu)\.(au|nz|za|cn|hk|sg|tw|in|br|mx)$/;

function rootDomain(): string {
  const fromBuild = (import.meta as any).env?.VITE_ROOT_DOMAIN as string | undefined;
  if (fromBuild) return fromBuild;

  const h = typeof location !== 'undefined' ? location.hostname : '';
  // localhost·IP 직접 접속에서는 형제 주소를 만들 수 없다
  if (!h || h === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(h)) return '';

  const parts = h.split('.');
  // ameserp.kr 처럼 이미 뿌리면 그대로
  if (parts.length <= 2) return h;
  // amescotes.co.kr 은 세 조각이지만 뿌리 자체다 — 앞을 떼면 co.kr 이 되어 버린다
  if (TWO_PART_TLD.test(h) && parts.length === 3) return h;
  return parts.slice(1).join('.');
}

/**
 * 예: sibling('daily') -> https://daily.ameserp.kr
 * 계산할 수 없으면 빈 문자열이다. 빈 문자열을 href 나 fetch 에 그냥 넣으면
 * 지금 페이지·지금 서버를 가리켜 조용히 엉뚱하게 동작한다 — 쓰는 쪽에서 반드시 확인한다.
 */
export function sibling(sub: string): string {
  const root = rootDomain();
  return root ? `https://${sub}.${root}` : '';
}

/** 주소를 못 만들면 링크를 죽인다 (눌러도 아무 일 없게) */
export function linkOr(url: string): { href?: string; 'aria-disabled'?: boolean } {
  return url ? { href: url } : { 'aria-disabled': true };
}

const slash = (u: string, tail = '/') => (u ? `${u}${tail}` : '');

export const PMS_URL = () => slash(sibling('daily'), '/app/');
export const OS_URL = () => slash(sibling('os'));
export const CEO_URL = () => slash(sibling('ceo'));

/** PMS API 바탕 주소. 못 만들면 빈 문자열 — 부르는 쪽이 먼저 확인해야 한다 */
export const PMS_API = () => sibling('daily');
