import { LISTING_EDITABLE_FIELDS, type Listing } from '@shared/product-registration';

export type Field = { key: keyof Listing; label: string; type?: 'number' | 'list' | 'numbers' | 'textarea' | 'date' | 'boolean' | 'shipping'; hint?: string; required?: boolean };
export const sections: { id: string; title: string; description?: string; fields: Field[] }[] = [
  { id: 'basic', title: '기본 · 가격', description: '품목 사실은 마스터를 참조합니다. 여기서는 채널별 판매 정보를 입력합니다.', fields: [
    { key: 'barcode', label: '바코드' }, { key: 'season', label: '시즌 태그', required: true, hint: '기능값 26FW · 고객 문구는 26AW' },
    { key: 'name_ko', label: '상품명 · 카페24', required: true }, { key: 'name_en', label: '상품명 · Shopify', required: true, hint: '동일한 MODEL NAME (COLOR) 대문자 형식' },
    { key: 'price_krw', label: '판매가 KRW', type: 'number', required: true }, { key: 'retail_krw', label: '소비자가 KRW', type: 'number' },
    { key: 'price_usd', label: '판매가 USD', type: 'number', required: true }, { key: 'sister_listing_ids', label: '자매 컬러 등록 ID', type: 'list' }, { key: 'is_test', label: '테스트 상품', type: 'boolean' },
  ] },
  { id: 'description', title: '설명 · 번역', description: '일본어는 본문·제품정보만 입력합니다. 제목·SEO는 영문을 유지합니다.', fields: [
    { key: 'summary_ko', label: '한줄 요약 KO', required: true }, { key: 'simple_ko', label: '간단 설명 KO', type: 'textarea', required: true },
    { key: 'detail_html_ko', label: '상세 HTML KO', type: 'textarea', required: true }, { key: 'mobile_detail_html_ko', label: '모바일 상세 HTML KO', type: 'textarea', hint: '비우면 PC 상세와 동일' },
    { key: 'desc_en', label: '상세 설명 EN', type: 'textarea', required: true }, { key: 'desc_ja', label: '상세 설명 JA', type: 'textarea', required: true },
    { key: 'details_ko', label: '제품정보 · 사이즈 KO', type: 'textarea' }, { key: 'details_en', label: '제품정보 · 사이즈 EN', type: 'textarea', required: true },
    { key: 'details_ja', label: '제품정보 · 사이즈 JA', type: 'textarea', required: true }, { key: 'care_ko', label: '소재 · 관리 KO', type: 'textarea', required: true, hint: 'MADE IN 문구 제외' },
    { key: 'part_description_refs', label: '부위 설명 참조 ID', type: 'list' }, { key: 'payment_delivery_ref', label: '결제 · 배송 메타오브젝트 참조' }, { key: 'exchange_refund_ref', label: '교환 · 환불 메타오브젝트 참조' },
  ] },
  { id: 'category', title: '분류 · 필터', fields: [
    { key: 'cafe24_category_nos', label: '카페24 분류 번호', type: 'numbers', required: true }, { key: 'shopify_collection_ids', label: 'Shopify 수동 컬렉션 ID', type: 'list', required: true },
    { key: 'classification_code', label: '카페24 상품 분류 코드' }, { key: 'taxonomy_category_id', label: 'Shopify 택소노미 ID', required: true },
    { key: 'google_category', label: 'Google 상품 카테고리', required: true }, { key: 'category_name_ko', label: '카테고리명 KO · SEO' }, { key: 'category_name_en', label: '카테고리명 EN · SEO' },
    { key: 'color_chip_ref', label: '컬러칩 메타오브젝트 참조' }, { key: 'list_image_ref', label: '목록 이미지 참조' },
  ] },
  { id: 'seo', title: '검색어 · SEO', fields: [
    { key: 'tags_ko', label: '검색 태그 KO', type: 'list', required: true }, { key: 'tags_en', label: '검색 태그 EN', type: 'list', required: true },
    { key: 'meta_title_ko', label: 'SEO 제목 KO', hint: '비우면 상품명 | 카테고리 | 아뜰리에 드 루멘' }, { key: 'meta_title_en', label: 'SEO 제목 EN', hint: '비우면 상품명 | Category EN' },
    { key: 'meta_desc_ko', label: 'SEO 설명 KO', type: 'textarea', required: true }, { key: 'meta_desc_en', label: 'SEO 설명 EN', type: 'textarea', required: true },
    { key: 'meta_keywords', label: '메타 키워드', required: true }, { key: 'handle', label: 'Shopify URL 핸들', required: true, hint: '소문자·숫자·하이픈' },
  ] },
  { id: 'logistics', title: '물류 · 재고 · 판매', description: '채널 재고와 원산지는 독립 운영합니다. 자동으로 맞추지 않습니다.', fields: [
    { key: 'weight_g', label: '무게 g', type: 'number', required: true }, { key: 'origin_cafe24', label: '원산지 · 카페24', required: true },
    { key: 'origin_shopify', label: '원산지 · Shopify', required: true }, { key: 'hscode', label: 'HS 코드', required: true }, { key: 'made_date', label: '제조일', type: 'date' },
    { key: 'cafe24_shipping', label: '카페24 배송 설정 JSON', type: 'shipping', required: true, hint: 'shipping_* API 필드 객체' },
    { key: 'cafe24_qty', label: '카페24 초기 재고', type: 'number', required: true }, { key: 'shopify_qty', label: 'Shopify 초기 재고', type: 'number', required: true },
    { key: 'naverpay', label: '네이버페이 사용', type: 'boolean' }, { key: 'market_sync', label: '카페24 마켓 연동', type: 'boolean' },
  ] },
  { id: 'preorder', title: '프리오더', fields: [
    { key: 'preorder_enabled', label: '품절 시 예약 발송', type: 'boolean' }, { key: 'preorder_ship_date', label: '예약 발송일', type: 'date' },
    { key: 'preorder_label_ko', label: '예약배송 라벨 KO' }, { key: 'preorder_label_en', label: '예약배송 라벨 EN' },
    { key: 'preorder_limit', label: '판매 한도 수량 · 선택', type: 'number' }, { key: 'preorder_end_date', label: '프리오더 종료일', type: 'date' },
  ] },
];

// Item-master facts cannot be posted back as editable listing overrides.
export const ITEM_FACT_FIELDS = ['sku', 'style_name', 'color_en', 'supply_price'] as const;
export function editablePayload(listing: Listing): Record<string, unknown> {
  const keys = LISTING_EDITABLE_FIELDS.filter(key => !ITEM_FACT_FIELDS.includes(key as typeof ITEM_FACT_FIELDS[number]));
  return Object.fromEntries(keys.map(key => [key, listing[key as keyof Listing]]));
}
export function kstInput(instant: string | null): string {
  if (!instant || !Number.isFinite(Date.parse(instant))) return '';
  return new Date(Date.parse(instant) + 9 * 60 * 60 * 1000).toISOString().slice(0, 16);
}
export function kstInstant(value: string, now = Date.now()): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('공개 시각을 확인해 주세요.');
  const instant = `${value}:00+09:00`;
  if (!Number.isFinite(Date.parse(instant)) || kstInput(instant) !== value || Date.parse(instant) <= now) throw new Error('미래의 유효한 공개 시각(KST)을 선택해 주세요.');
  return instant;
}
export function preorderGateWarning(reason: unknown): string | undefined {
  switch (reason) {
    case 'preorder_end_staging_required': return '프리오더 자동 종료 보류: 채널별 상품 반영이 완료되어야 종료할 수 있습니다. 채널 반영 결과를 확인해 주세요.';
    case 'preorder_end_adapter_unconnected': return '프리오더 자동 종료 보류: 채널 종료 기능이 연결되지 않았습니다. 관리자에게 연결 상태 확인을 요청해 주세요.';
    case 'authoritative_commerce_receipt_unsupported': return '프리오더 자동 종료 보류: 실제 입고를 확인하는 연결이 없어 입고 기준으로 자동 해제할 수 없습니다. 재고 증가만으로는 해제되지 않습니다.';
    default: return undefined;
  }
}
export function preorderLabels(date: string) {
  const instant = new Date(`${date}T00:00:00+09:00`);
  if (!Number.isFinite(instant.getTime())) return { ko: '', en: '' };
  return {
    ko: `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}(${new Intl.DateTimeFormat('ko-KR', { weekday: 'short', timeZone: 'Asia/Seoul' }).format(instant)}) 예약배송`,
    en: `PRE ORDER SHIP FROM ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'Asia/Seoul' }).format(instant).toUpperCase()}`,
  };
}
export async function registrationApi<T>(path = '', init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('X-Workspace', 'LUMEN');
  const token = localStorage.getItem('erp_token');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api/product-registration${path}`, { ...init, headers, credentials: 'include' });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || data?.message || (response.status === 404 || response.status === 503 ? '상품 등록 서버 또는 저장소가 아직 준비되지 않았습니다.' : `요청 실패 (${response.status})`));
  if (!data || typeof data !== 'object') throw new Error('상품 등록 서버 응답을 확인할 수 없습니다.');
  return data as T;
}
