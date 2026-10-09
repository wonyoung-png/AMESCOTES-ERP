export const SCHEDULE_CHANNELS = ['자사몰', '센텀', '29CM', 'W컨셉', '쇼룸', '해외'];
export const validDate = (value: unknown): value is string => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString().slice(0, 10) === value;

/** 사람이 확인한 값을 임의 보정하지 않는다. 잘못된 값이면 저장 전에 되돌린다. */
export function schedulePayload(input: Record<string, any>): Record<string, any> {
  const title = String(input.title || '').trim();
  if (!title) throw new Error('기획전 이름을 넣어주세요');
  if (!validDate(input.startDate)) throw new Error('올바른 시작일을 넣어주세요');
  const endDate = input.endDate || input.startDate;
  if (!validDate(endDate) || endDate < input.startDate) throw new Error('종료일은 시작일 이후 날짜여야 합니다');
  if (!['LUMEN', 'AETALOOF'].includes(input.workspace)) throw new Error('브랜드를 선택해주세요');
  if (!SCHEDULE_CHANNELS.includes(input.channel)) throw new Error('채널을 선택해주세요');
  const discountRate = input.discountRate == null || input.discountRate === '' ? null : Number(input.discountRate);
  if (discountRate !== null && (!Number.isFinite(discountRate) || discountRate < 0 || discountRate > 100)) throw new Error('할인율은 0~100%여야 합니다');
  return { ...input, title, endDate, discountRate };
}
