/**
 * 로그인 직후 — Supabase 동기화 + 데모/패킹 데이터 보장
 */
import { syncFromSupabase } from './syncFromSupabase';
import { seedDemoIntegrationData, DEMO_SEED_FLAG } from './seedDemoData';
import { seedLumenPackingData, PACK_SEED_FLAG, hasPackageKitItems } from './seedLumenPacking';
import { seedLumen27ssRrp, LUMEN_27SS_SEED_FLAG, lumen27ssMissingImages } from './seedLumen27ssRrp';
import { store } from './store';

const SYNC_STAMP_KEY = 'erp_last_full_sync';
const SYNC_TTL_MS = 5 * 60 * 1000; // 5분 내 재부팅/새로고침은 전체 동기화 생략 (개별 화면 쿼리는 정상 동작)

export async function ensureErpBootstrap(): Promise<{ seeded: boolean; message: string }> {
  const last = Number(localStorage.getItem(SYNC_STAMP_KEY) || 0);
  if (Date.now() - last > SYNC_TTL_MS) {
    try {
      await syncFromSupabase();
      localStorage.setItem(SYNC_STAMP_KEY, String(Date.now()));
    } catch {
      /* DB 미연결 시 localStorage만 사용 */
    }
  }

  const hasData =
    store.getVendors().length > 0 ||
    store.getOrders().length > 0 ||
    store.getItems().length > 0;

  const seedCurrent = !!localStorage.getItem(DEMO_SEED_FLAG);

  // DB에 데이터가 있는데 이 브라우저에 플래그만 없는 경우 = 새 기기/새 도메인 접속.
  // 플래그 기준으로 재시드하면 접속 기기마다 데모가 중복 생성되므로(운영 27SS 2세트 원인),
  // 시드 완료로 간주하고 플래그만 채운다.
  if (hasData && !seedCurrent) {
    localStorage.setItem(DEMO_SEED_FLAG, new Date().toISOString());
  }

  // 운영 서버에서는 자동 시드(데모·패킹·RRP·컬러 보정) 전면 비활성.
  // 접속하는 브라우저마다 운영 DB에 데모 행을 추가하는 부작용 방지.
  // 개발 환경에서 필요하면 빌드 시 VITE_ENABLE_DEMO_SEED=true 로 활성화.
  if (import.meta.env.VITE_ENABLE_DEMO_SEED !== 'true') {
    return { seeded: false, message: '' };
  }

  if (!hasData) {
    const result = await seedDemoIntegrationData();
    try {
      await syncFromSupabase();
    } catch { /* ignore */ }

    if (!hasPackageKitItems()) {
      await seedLumenPackingData();
    }

    const lumen = await seedLumen27ssRrp(false);
    const lumenMsg = lumen.created + lumen.updated > 0
      ? ` · LUMEN 27SS ${lumen.created + lumen.updated}건`
      : '';
    return {
      seeded: true,
      message: result.errors.length
        ? '데모 데이터 생성됨 (일부 Supabase 동기화 실패 — localStorage에는 저장됨)'
        : `연동 데모·PACKAGE 키트 생성${lumenMsg}`,
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
  // 데이터가 온전하면(이미지 누락 없음) 새 브라우저에서도 재시드하지 않음 — 플래그만 채움
  if (!localStorage.getItem(LUMEN_27SS_SEED_FLAG) && !lumen27ssMissingImages(store.getItems())) {
    localStorage.setItem(LUMEN_27SS_SEED_FLAG, new Date().toISOString());
  }
  if (!localStorage.getItem(LUMEN_27SS_SEED_FLAG) || lumen27ssMissingImages(store.getItems())) {
    const r = await seedLumen27ssRrp(false);
    if (r.total > 0 || r.created > 0 || r.updated > 0) {
      return {
        seeded: true,
        message: `LUMEN 27SS RRP 품목 ${r.created + r.updated}/${r.total}건 등록`,
      };
    }
  }

  return { seeded: false, message: '' };
}
