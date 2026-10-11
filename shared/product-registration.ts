/** Channel-only data; immutable item facts are supplied by the server from items. */
export type Channel = 'cafe24' | 'shopify';
export type ListingStatus = '작성중' | '검증통과' | '승인대기' | '승인' | '예약됨' | '공개됨' | '오류' | '삭제대기' | '삭제됨';
export interface ListingImage {
  id: string; listing_id: string; position: number; role: 'main' | 'list' | 'extra' | 'detail_view';
  source_url: string; width: number; height: number; alt_en: string; alt_ko: string;
  shopify_file_id?: string; shopify_media_id?: string; cafe24_paths?: Record<string, string>;
  mime_type?: string; byte_size?: number;
}
export interface Listing {
  id: string; item_id: string; status: ListingStatus; revision: number; created_by: string;
  edited_by?: string; approval_evidence?: string;
  approved_by?: string | null; approved_revision?: number | null;
  sku: string; barcode: string; style_name: string; color_en: string; season: string;
  name_ko: string; name_en: string; sister_listing_ids: string[]; is_test: boolean;
  price_krw: number; retail_krw: number; price_usd: number; supply_price: number;
  summary_ko: string; simple_ko: string; detail_html_ko: string; mobile_detail_html_ko: string;
  desc_en: string; desc_ja: string; details_ko: string; details_en: string; details_ja: string; care_ko: string;
  part_description_refs: string[]; payment_delivery_ref: string; exchange_refund_ref: string;
  cafe24_category_nos: number[]; shopify_collection_ids: string[]; taxonomy_category_id: string; google_category: string;
  classification_code: string; category_name_ko: string; category_name_en: string;
  material: string; color: string; size: string; design: string;
  color_chip_ref: string; list_image_ref: string;
  tags_ko: string[]; tags_en: string[];
  meta_title_ko: string; meta_title_en: string; meta_desc_ko: string; meta_desc_en: string; meta_keywords: string; handle: string;
  weight_g: number; origin_cafe24: string; origin_shopify: string; hscode: string; made_date: string;
  cafe24_shipping: Record<string, unknown>; cafe24_qty: number; shopify_qty: number;
  naverpay: boolean; market_sync: boolean; shopify_channels: string[];
  preorder_enabled: boolean; preorder_ship_date: string; preorder_label_ko: string; preorder_label_en: string;
  preorder_limit: number | null; preorder_end_condition: 'receipt' | 'date'; preorder_end_date: string;
  publish_at: string | null; publish_channels: Channel[];
  cafe24_product_no?: number | null; shopify_product_id?: string | null;
  step_keys: Record<string, unknown>; last_sync_at?: string | null; last_sync_result?: Record<string, unknown>;
  validation?: unknown; updated_at?: string; lease_owner?: string | null; lease_until?: string | null;
  item?: Record<string, unknown>; item_snapshot_hash?: string; item_changed?: boolean;
}
export interface ValidationIssue { field: string; message: string; severity: 'error' | 'warning'; }
export interface FilterCode { label: string; cafe24: string; shopify_ref?: string; }
// Candidate codes, not a verified store inventory. Approval requires CEO-confirmed mappings.
// Shopify references are configured
// by the CEO after reading the store's existing metaobjects; never invent a production GID.
export const FILTER_CODES: Record<'material' | 'color' | 'size' | 'design', Record<string, FilterCode>> = {
  material: {
    COW_LEATHER: { label: '소가죽', cafe24: 'COWLEATHER' }, SHEEP_LEATHER: { label: '양가죽', cafe24: 'SHEEPLEATHER' },
    VEGAN_LEATHER: { label: '비건 레더', cafe24: 'VEGANLEATHER' }, SUEDE: { label: '스웨이드', cafe24: 'SUEDE' },
    FABRIC: { label: '패브릭', cafe24: 'FABRIC' }, NYLON: { label: '나일론', cafe24: 'NYLON' },
  },
  color: Object.fromEntries(['BLACK', 'WHITE', 'IVORY', 'BEIGE', 'BROWN', 'RED', 'PINK', 'ORANGE', 'YELLOW', 'GREEN', 'BLUE', 'NAVY', 'PURPLE', 'GREY', 'SILVER', 'GOLD'].map(x => [x, { label: x, cafe24: x }])),
  size: { MINI: { label: '미니', cafe24: 'MINI' }, SMALL: { label: '스몰', cafe24: 'SMALL' }, MEDIUM: { label: '미디엄', cafe24: 'MEDIUM' }, LARGE: { label: '라지', cafe24: 'LARGE' } },
  design: { DESIGN_ALL: { label: '전체 디자인', cafe24: 'DESIGNALL' }, SHOULDER: { label: '숄더백', cafe24: 'SHOULDER' }, TOTE: { label: '토트백', cafe24: 'TOTE' }, CROSSBODY: { label: '크로스백', cafe24: 'CROSSBODY' }, BACKPACK: { label: '백팩', cafe24: 'BACKPACK' }, CLUTCH: { label: '클러치', cafe24: 'CLUTCH' }, WALLET: { label: '지갑', cafe24: 'WALLET' } },
};
export const cafe24FilterTags = (listing: Pick<Listing, 'material' | 'color' | 'size' | 'design'>) =>
  [...new Set((['material', 'color', 'size', 'design'] as const).flatMap(key => [FILTER_CODES[key][listing[key]]?.cafe24 || '', `${key.toUpperCase()}ALL`]).filter(Boolean))];
export function emptyListing(itemId = ''): Listing {
  return {
    id: '', item_id: itemId, status: '작성중', revision: 1, created_by: '', sku: '', barcode: '', style_name: '', color_en: '', season: '',
    name_ko: '', name_en: '', sister_listing_ids: [], is_test: false, price_krw: 0, retail_krw: 0, price_usd: 0, supply_price: 0,
    summary_ko: '', simple_ko: '', detail_html_ko: '', mobile_detail_html_ko: '', desc_en: '', desc_ja: '', details_ko: '', details_en: '', details_ja: '', care_ko: '',
    part_description_refs: [], payment_delivery_ref: '', exchange_refund_ref: '', cafe24_category_nos: [], shopify_collection_ids: [], taxonomy_category_id: '', google_category: '3032',
    classification_code: '', category_name_ko: '', category_name_en: '', material: '', color: '', size: '', design: '', color_chip_ref: '', list_image_ref: '',
    tags_ko: [], tags_en: [], meta_title_ko: '', meta_title_en: '', meta_desc_ko: '', meta_desc_en: '', meta_keywords: '', handle: '',
    weight_g: 0, origin_cafe24: '', origin_shopify: '', hscode: '', made_date: '', cafe24_shipping: {}, cafe24_qty: 0, shopify_qty: 0,
    naverpay: true, market_sync: false, shopify_channels: ['online_store'], preorder_enabled: false, preorder_ship_date: '', preorder_label_ko: '', preorder_label_en: '',
    preorder_limit: null, preorder_end_condition: 'receipt', preorder_end_date: '', publish_at: null, publish_channels: ['cafe24', 'shopify'], step_keys: {},
  };
}
export const LISTING_EDITABLE_FIELDS = Object.keys(emptyListing()).filter(key => !['id', 'status', 'revision', 'created_by', 'step_keys'].includes(key));
export function validateListing(listing: Listing, images: ListingImage[], sizeMaster: Record<string, { size: string }> = {}, now = new Date()): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const error = (field: string, message: string) => issues.push({ field, message, severity: 'error' });
  const required: (keyof Listing)[] = ['item_id', 'sku', 'style_name', 'color_en', 'name_ko', 'name_en', 'summary_ko', 'simple_ko', 'detail_html_ko', 'desc_en', 'desc_ja', 'details_en', 'details_ja', 'care_ko', 'taxonomy_category_id', 'google_category', 'meta_desc_ko', 'meta_desc_en', 'meta_keywords', 'handle', 'origin_cafe24', 'origin_shopify', 'hscode', 'season'];
  for (const field of required) if (!String(listing[field] ?? '').trim()) error(field, '필수 항목을 입력해 주세요.');
  for (const field of ['price_krw', 'price_usd', 'supply_price', 'weight_g'] as const) if (!Number.isFinite(listing[field]) || listing[field] <= 0) error(field, '0보다 큰 값을 입력해 주세요.');
  for (const field of ['cafe24_qty', 'shopify_qty'] as const) if (!Number.isInteger(listing[field]) || listing[field] < 0) error(field, '재고는 0 이상의 정수여야 합니다.');
  if (!listing.cafe24_category_nos.length) error('cafe24_category_nos', '카페24 분류를 선택해 주세요.');
  if (!listing.shopify_collection_ids.length) error('shopify_collection_ids', '수동 컬렉션을 선택해 주세요.');
  if (!listing.tags_ko.length || !listing.tags_en.length) error('tags_ko', '두 채널의 검색 태그를 입력해 주세요.');
  if (!Object.keys(listing.cafe24_shipping).length) error('cafe24_shipping', '카페24 배송 설정을 입력해 주세요.');
  if (listing.name_ko !== listing.name_en || !/^[A-Z0-9][A-Z0-9 .&'/-]* \([A-Z0-9 .&'/-]+\)$/.test(listing.name_en)) error('name_en', '두 채널 상품명은 동일한 MODEL NAME (COLOR) 대문자 형식이어야 합니다.');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(listing.handle)) error('handle', '핸들은 소문자·숫자·하이픈으로 입력해 주세요.');
  for (const key of ['material', 'color', 'size', 'design'] as const) if (!FILTER_CODES[key][listing[key]]) error(key, '등록된 필터 코드에서 선택해 주세요.');
  const normalizedModel = listing.style_name.trim().toUpperCase().replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+/g, ' ');
  const nameModel = listing.name_en.trim().toUpperCase().replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+/g, ' ');
  const sizeEntry = sizeMaster[normalizedModel] ?? sizeMaster[`${normalizedModel} BAG`] ?? sizeMaster[nameModel] ?? sizeMaster[`${nameModel} BAG`];
  const expectedSize = sizeEntry?.size;
  if (Object.keys(sizeMaster).length && (!sizeEntry || !expectedSize?.trim())) error('size', '사이즈 기준표에 확정된 값이 없습니다. 대표 지정이 필요합니다.');
  if (expectedSize && FILTER_CODES.size[listing.size]?.label !== expectedSize) error('size', `사이즈 기준표와 다릅니다: ${expectedSize}`);
  const visibleFields = ['name_ko', 'name_en', 'summary_ko', 'simple_ko', 'detail_html_ko', 'mobile_detail_html_ko', 'desc_en', 'desc_ja', 'details_ko', 'details_en', 'details_ja', 'care_ko', 'meta_title_ko', 'meta_title_en', 'meta_desc_ko', 'meta_desc_en'] as const;
  if (listing.tags_ko.some(t => ['빠니에', '통근백', '데일리백', 'A4가방'].includes(t.replace(/\s+/g, '')))) error('tags_ko', '대표 확정 재추가 금지 검색어가 포함되어 있습니다.');
  for (const field of visibleFields) {
    const value = listing[field];
    if (/26FW/i.test(value)) error(field, '고객에게 보이는 시즌 표기는 26AW를 사용해 주세요.');
    if (/최저가|세일|\bSALE\b/i.test(value)) error(field, '가격 중심 문구는 사용하지 않습니다.');
    if (/MADE\s+IN/i.test(value)) error(field, 'MADE IN 문구는 사용하지 않습니다.');
    if (/<\s*(script|iframe|object|embed)|\bon\w+\s*=|javascript\s*:/i.test(value)) error(field, '실행 가능한 HTML은 입력할 수 없습니다.');
  }
  if (images.length < 3) error('images', '이미지를 3장 이상 등록해 주세요.');
  if (images.filter(i => i.role === 'main').length !== 1) error('images', '대표 이미지는 1장이어야 합니다.');
  for (const image of images) {
    if (!image.alt_en.trim() || !image.alt_ko.trim()) error('images', '이미지 설명을 입력해 주세요.');
    if (image.width <= 0 || image.height <= 0) error('images', '이미지 크기를 확인할 수 없습니다.');
    else if (Math.abs(image.width / image.height - .75) > .01) issues.push({ field: 'images', message: '권장 가로:세로 3:4 비율이 아닙니다.', severity: 'warning' });
    if ((image.byte_size || 0) > 10 * 1024 * 1024) error('images', '이미지는 10MB 이하만 가능합니다.');
  }
  if (listing.publish_at && !Number.isFinite(Date.parse(listing.publish_at))) error('publish_at', '유효한 공개 시각을 선택해 주세요.');
  if (listing.preorder_enabled) {
    const validDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
    if (!validDay(listing.preorder_ship_date)) error('preorder_ship_date', '유효한 예약 발송일을 입력해 주세요.');
    if (listing.preorder_limit != null && (!Number.isInteger(listing.preorder_limit) || listing.preorder_limit <= 0)) error('preorder_limit', '판매 한도는 양의 정수여야 합니다.');
    if (!['receipt', 'date'].includes(listing.preorder_end_condition)) error('preorder_end_condition', '프리오더 종료 조건을 선택해 주세요.');
    if (listing.preorder_end_condition === 'date' && !validDay(listing.preorder_end_date)) error('preorder_end_date', '유효한 프리오더 종료일을 입력해 주세요.');
  }
  return issues;
}
