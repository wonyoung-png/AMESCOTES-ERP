import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

const basic = [
  ['shipping_method', '배송 방법 코드'], ['shipping_scope', '배송 범위 코드'],
  ['shipping_fee_type', '배송비 유형 코드'], ['shipping_fee', '배송비 KRW'],
  ['shipping_area', '배송 지역'], ['shipping_payment', '배송비 결제 코드'],
] as const;

export function ShippingFields({ value, disabled, invalid, onChange }: { value: string; disabled: boolean; invalid: boolean; onChange: (value: string) => void }) {
  let parsed: Record<string, unknown> = {};
  let parseError = false;
  try { const data = JSON.parse(value || '{}'); if (!data || Array.isArray(data) || typeof data !== 'object') parseError = true; else parsed = data; } catch { parseError = true; }
  function change(key: string, input: string) {
    if (parseError) return;
    const next = { ...parsed };
    if (input === '') delete next[key];
    else next[key] = key === 'shipping_fee' ? Number(input) : input;
    onChange(JSON.stringify(next, null, 2));
  }
  return <fieldset id="field-cafe24_shipping" tabIndex={-1} className="space-y-3 scroll-mt-24">
    <legend className="text-sm font-medium">카페24 배송 설정 <span className="text-destructive">*</span></legend>
    <p className="text-xs text-muted-foreground">관리자에서 확인한 배송 옵션만 입력하세요. 빈 값은 보내지 않으며 미확인 기본값을 만들지 않습니다.</p>
    <div className="grid gap-4 md:grid-cols-2">{basic.map(([key, label]) => <div key={key} className="space-y-2"><Label htmlFor={`shipping-${key}`}>{label}</Label><Input id={`shipping-${key}`} type={key === 'shipping_fee' ? 'number' : 'text'} min={key === 'shipping_fee' ? 0 : undefined} disabled={disabled || parseError || (key in parsed && typeof parsed[key] === 'object')} value={typeof parsed[key] === 'object' ? '' : String(parsed[key] ?? '')} onChange={e => change(key, e.target.value)} /></div>)}</div>
    <details open={parseError}><summary className="cursor-pointer text-xs text-muted-foreground">고급 설정 · 구간 배송비 등 JSON</summary><Label className="sr-only" htmlFor="shipping-json">배송 설정 JSON</Label><Textarea id="shipping-json" className="mt-3" rows={5} value={value} disabled={disabled} aria-invalid={invalid || parseError} onChange={e => onChange(e.target.value)} />{parseError && <p role="alert" className="mt-2 text-xs text-destructive">올바른 JSON 객체로 수정하면 기본 입력을 사용할 수 있습니다.</p>}</details>
  </fieldset>;
}
