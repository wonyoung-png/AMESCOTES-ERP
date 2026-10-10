import { restAsServer } from './auth.js';

/** Failure leaves the DB-committed intent pending; retry never rewrites work. */
export async function deliverWorkNotifications(cardId: string | null = null, write = restAsServer): Promise<boolean> {
  try {
    const response = await write('rpc/deliver_work_notifications', {
      method: 'POST', body: JSON.stringify({ p_card_id: cardId }), signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`delivery_http_${response.status}`);
    const result = await response.json();
    if (!Number.isInteger(result?.delivered) || result.delivered < 0 || typeof result.pending !== 'boolean') {
      throw new Error('invalid_delivery_result');
    }
    return !result.pending;
  } catch (error) {
    console.error('[work] 알림 전달 대기:', error instanceof Error ? error.message : 'unknown');
    return false;
  }
}

let started = false;
export function startWorkNotificationDelivery() {
  if (started) return;
  started = true;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await deliverWorkNotifications(); } finally { running = false; }
  };
  void tick();
  setInterval(() => void tick(), 60_000).unref();
}
