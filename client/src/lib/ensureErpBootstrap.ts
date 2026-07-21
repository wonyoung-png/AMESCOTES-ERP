/**
 * 로그인 직후 — Supabase 동기화 + 데모/패킹 데이터 보장
 */
import { syncFromSupabase } from './syncFromSupabase';
import { seedDemoIntegrationData, DEMO_SEED_FLAG } from './seedDemoData';
import { seedLumenPackingData, PACK_SEED_FLAG, hasPackageKitItems } from './seedLumenPacking';
import { fillMissingItemColorsForTest, ITEM_COLOR_FILL_FLAG, ordersNeedColorFix } from './fillItemColorsForTest';
import { seedLumen27ssRrp, LUMEN_27SS_SEED_FLAG, lumen27ssMissingImages } from './seedLumen27ssRrp';
import { store } from './store';

export async function ensureErpBootstrap(): Promise<{ seeded: boolean; message: string }> {
  try {
    await syncFromSupabase();
  } catch {
    /* Supabase 미연결 시 localStorage만 사용 */
  }

  const hasData =
    store.getVendors().length > 0 ||
    store.getOrders().length > 0 ||
    store.getItems().length > 0;

  const seedCurrent = !!localStorage.getItem(DEMO_SEED_FLAG);

  if (!hasData || !seedCurrent) {
    const result = await seedDemoIntegrationData();
    try {
      await syncFromSupabase();
    } catch { /* ignore */ }

    if (!hasPackageKitItems()) {
      await seedLumenPackingData();
    }

    localStorage.removeItem(ITEM_COLOR_FILL_FLAG);
    const fill = fillMissingItemColorsForTest(true);
    const lumen = await seedLumen27ssRrp(false);
    const lumenMsg = lumen.created + lumen.updated > 0
      ? ` · LUMEN 27SS ${lumen.created + lumen.updated}건`
      : '';
    return {
      seeded: true,
      message: result.errors.length
        ? '데모 데이터 생성됨 (일부 Supabase 동기화 실패 — localStorage에는 저장됨)'
        : `연동 데모·PACKAGE 키트 생성 · 컬러 ${fill.itemsUpdated}품목/${fill.ordersUpdated}발주${lumenMsg}`,
    };
  }

  // 핸드백 박스 패키지 없거나 구 시드만 있으면 재시드 (v4)
  const hasV4 = !!localStorage.getItem(PACK_SEED_FLAG);
  const hasV2Legacy = !!localStorage.getItem('ames_lumen_pack_seed_v2');
  const hasV3Legacy = !!localStorage.getItem('ames_lumen_pack_seed_v3');
  const hasBoxKits = store.getItems().some(i => (i.styleNo || '').startsWith('BOX-'));
  if (!hasBoxKits || ((hasV2Legacy || hasV3Legacy) && !hasV4)) {
    localStorage.removeItem(PACK_SEED_FLAG);
    localStorage.removeItem('ames_lumen_pack_seed_v2');
    localStorage.removeItem('ames_lumen_pack_seed_v3');
    const pack = await seedLumenPackingData();
    return {
      seeded: true,
      message: `핸드백 패키지 ${pack.itemCount}건 · 포장재 ${pack.materialCount}건`,
    };
  }

  // LUMEN 27SS RRP (+ 이미지 누락 시 재적용)
  if (!localStorage.getItem(LUMEN_27SS_SEED_FLAG) || lumen27ssMissingImages(store.getItems())) {
    const r = await seedLumen27ssRrp(false);
    if (r.total > 0 || r.created > 0 || r.updated > 0) {
      return {
        seeded: true,
        message: `LUMEN 27SS RRP 품목 ${r.created + r.updated}/${r.total}건 등록`,
      };
    }
  }

  const needsColorFill = store.getItems().some(i => {
    if (i.erpCategory === 'PACK' || (i.styleNo || '').startsWith('LPKG-') || (i.styleNo || '').startsWith('PACKAGE-')) return false;
    return (!i.colors || i.colors.length === 0) && (
      i.itemStatus === 'TEMP' ||
      (i.styleNo || '').startsWith('TEMP') ||
      (i.styleNo || '').startsWith('LLL') ||
      i.erpCategory === 'HB'
    );
  }) || ordersNeedColorFix();
  if (needsColorFill) localStorage.removeItem(ITEM_COLOR_FILL_FLAG);

  const fill = fillMissingItemColorsForTest(false);
  if (!fill.skipped && (fill.itemsUpdated > 0 || fill.ordersUpdated > 0)) {
    return {
      seeded: true,
      message: `테스트 컬러 반영: 품목 ${fill.itemsUpdated} · 발주 ${fill.ordersUpdated}`,
    };
  }

  return { seeded: false, message: '' };
}
