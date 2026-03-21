// 매일 자동으로 환율을 가져오는 훅
// open.er-api.com 무료 API 사용 (API 키 불필요, CORS 허용)
import { useEffect } from 'react';
import { store, genId } from '@/lib/store';
import { toast } from 'sonner';

const LAST_DATE_KEY = 'erp_exchange_last_date';

// USD 기준 환율에서 USD/KRW, CNY/KRW 계산
async function fetchLatestRates(): Promise<{ usdKrw: number; cnyKrw: number }> {
  const res = await fetch('https://open.er-api.com/v6/latest/USD');
  if (!res.ok) throw new Error('환율 API 응답 오류');
  const data = await res.json();
  const usdKrw = Math.round(data.rates.KRW);
  const cnyKrw = Math.round((data.rates.KRW / data.rates.CNY) * 10) / 10;
  return { usdKrw, cnyKrw };
}

export function useAutoExchangeRate() {
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    const lastDate = localStorage.getItem(LAST_DATE_KEY);

    // 오늘 이미 업데이트했으면 건너뜀
    if (lastDate === today) return;

    fetchLatestRates()
      .then(({ usdKrw, cnyKrw }) => {
        const settings = store.getSettings();
        const newHistory = [
          ...settings.exchangeHistory,
          { id: genId(), date: today, usdKrw, cnyKrw, memo: '자동업데이트' },
        ];
        store.setSettings({ ...settings, usdKrw, cnyKrw, exchangeHistory: newHistory });
        localStorage.setItem(LAST_DATE_KEY, today);
        toast.success(`환율 자동 업데이트 — USD ${usdKrw.toLocaleString()} / CNY ${cnyKrw.toLocaleString()}`);
      })
      .catch(() => {
        // 네트워크 오류 시 조용히 실패 (기존 환율 유지)
      });
  }, []);
}

// 수동 새로고침용 함수 (ExchangeSettings 페이지에서 사용)
export async function manualFetchExchangeRate(): Promise<void> {
  const { usdKrw, cnyKrw } = await fetchLatestRates();
  const today = new Date().toISOString().split('T')[0];
  const settings = store.getSettings();
  const newHistory = [
    ...settings.exchangeHistory,
    { id: genId(), date: today, usdKrw, cnyKrw, memo: '수동새로고침' },
  ];
  store.setSettings({ ...settings, usdKrw, cnyKrw, exchangeHistory: newHistory });
  localStorage.setItem(LAST_DATE_KEY, today);
}
