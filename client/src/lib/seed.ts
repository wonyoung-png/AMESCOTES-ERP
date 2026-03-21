// AMESCOTES ERP — Seed Data v3 (TEST 50품목)
import {
  store,
  type Item, type Sample, type Vendor,
} from './store';

export function seedData() {
  // 이미 TEST 품목 10개 이상이면 스킵
  const currentItems = store.getItems();
  if (currentItems.length >= 10 && currentItems.some(i => i.styleNo.startsWith('TEST'))) return;

  // 기존 데이터 전부 초기화
  store.setVendors([]);
  store.setItems([]);
  store.setSamples([]);

  const now = new Date().toISOString();

  // ─── 바이어 3개 ───
  const vendors: Vendor[] = [
    {
      id: 'v1',
      name: '아뜰리에드루멘',
      code: 'AT',
      companyName: '(주)아뜰리에드루멘',
      type: '바이어',
      country: '한국',
      currency: 'KRW',
      contactName: '이원영',
      contactEmail: 'wonyoung@atlm.kr',
      contactHistory: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'v2',
      name: '오에스브랜드',
      code: 'OS',
      companyName: '(주)오에스브랜드',
      type: '바이어',
      country: '한국',
      currency: 'KRW',
      contactHistory: [],
      createdAt: '2026-01-02T00:00:00.000Z',
    },
    {
      id: 'v3',
      name: '라노브랜드',
      code: 'LN',
      companyName: '(주)라노브랜드',
      type: '바이어',
      country: '한국',
      currency: 'KRW',
      contactHistory: [],
      createdAt: '2026-01-03T00:00:00.000Z',
    },
  ];
  store.setVendors(vendors);

  // ─── 품목 50개 (TEST01~TEST50) ───
  const categories: Item['category'][] = ['숄더백', '토트백', '크로스백'];
  const buyerIds = ['v1', 'v2', 'v3'];

  // 가격: 10개씩 75000원 단위 증가 (150000 ~ 450000)
  const priceGroups = [150000, 225000, 300000, 375000, 450000];

  const items: Item[] = Array.from({ length: 50 }, (_, i) => {
    const n = i + 1; // 1~50
    const no = String(n).padStart(2, '0');
    const priceIndex = Math.floor(i / 10); // 0~4
    return {
      id: `item${no}`,
      styleNo: `TEST${no}`,
      name: `테스트상품${no}`,
      season: '26SS' as const,
      category: categories[i % 3],
      erpCategory: 'HB' as const,
      materialType: '완제품' as const,
      itemStatus: 'ACTIVE' as const,
      material: '소가죽',
      salePriceKrw: priceGroups[priceIndex],
      buyerId: buyerIds[i % 3],
      hasBom: false,
      colors: [],
      createdAt: `2026-01-${String(n).padStart(2, '0')}T00:00:00.000Z`,
    };
  });
  store.setItems(items);

  // ─── 샘플 10개 (TEST01~TEST10 연결) ───
  const stages: Sample['stage'][] = ['1차', '2차', '3차', '최종승인', '반려'];

  const samples: Sample[] = Array.from({ length: 10 }, (_, i) => {
    const n = i + 1;
    const no = String(n).padStart(2, '0');
    const reqDay = `2026-02-${String(n).padStart(2, '0')}`;
    const expMonth = n + 10 <= 30 ? '03' : '04';
    const expDay = String((n + 10 > 30 ? (n + 10 - 30) : n + 10)).padStart(2, '0');
    const expectedDate = `2026-${expMonth}-${expDay}`;
    return {
      id: `smp${no}`,
      styleId: `item${no}`,
      styleNo: `TEST${no}`,
      styleName: `테스트상품${no}`,
      buyerId: buyerIds[i % 3],
      season: '26SS' as const,
      stage: stages[i % 5],
      requestDate: reqDay,
      expectedDate,
      costCny: 0,
      imageUrls: [],
      revisionHistory: [],
      materialChecklist: [],
      billingStatus: '미청구' as const,
      createdAt: `2026-02-${String(n).padStart(2, '0')}T00:00:00.000Z`,
    };
  });
  store.setSamples(samples);

  // seed 완료 마킹
  localStorage.setItem('ames_seed_v1', '1');
  console.log('[seed] TEST01~TEST50 시드 완료');
}
