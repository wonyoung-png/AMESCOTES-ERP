import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, Check, ChevronDown, Loader2, Plus, RefreshCw, Save, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { FILTER_CODES, cafe24FilterTags, emptyListing, validateListing, type Listing, type ListingImage, type ValidationIssue } from '@shared/product-registration';
import { editablePayload, kstInput, kstInstant, preorderGateWarning, preorderLabels, registrationApi, sections, type Field } from '@/components/product-registration/form';
import { ListingImages, imageDimensions } from '@/components/product-registration/Images';
import { ShippingFields } from '@/components/product-registration/Shipping';

type Item = Record<string, unknown> & { id: string };
type Permissions = { allowed: boolean; can_edit: boolean; can_approve: boolean; can_manage_settings: boolean; user_id: string };
type Result = { listing: Listing; images?: ListingImage[]; issues?: ValidationIssue[]; suggestions?: unknown; queued?: boolean };
type IndexResult = { listings: Listing[]; items?: Item[]; permissions?: Permissions; connections?: Record<string, unknown>; settings?: Record<string, unknown> };
type FilterMappings = Partial<Record<'material' | 'color' | 'size' | 'design', Record<string, { cafe24?: string; shopify_ref?: string; verified?: boolean }>>>;
const NO_ACCESS: Permissions = { allowed: false, can_edit: false, can_approve: false, can_manage_settings: false, user_id: '' };
const selectClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-ring';
const statuses = ['작성중', '검증통과', '승인대기', '승인', '예약됨', '공개됨', '오류', '삭제대기', '삭제됨'];
const formatTime = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(new Date(value)) : '—';
const itemLabel = (item: Item) => [item.style_no || item.styleNo || item.name || item.style_name, item.color || item.color_en, item.sku || item.code].filter(Boolean).join(' · ') || item.id;
function itemColors(item?: Record<string, unknown>): string[] {
  if (!item) return [];
  if (item.color_en || item.color) return [String(item.color_en || item.color)];
  if (!Array.isArray(item.colors)) return [];
  return item.colors.map((color: unknown) => typeof color === 'string' ? color : color && typeof color === 'object' ? String((color as Record<string, unknown>).color_en || (color as Record<string, unknown>).name || (color as Record<string, unknown>).color || '') : '').filter(Boolean);
}
const message = (error: unknown) => error instanceof Error ? error.message : '요청을 처리하지 못했습니다.';

export default function ProductRegistration() {
  const { workspace } = useWorkspace();
  const [listings, setListings] = useState<Listing[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [permissions, setPermissions] = useState(NO_ACCESS);
  const [connections, setConnections] = useState<Record<string, unknown>>({});
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [seasonFilter, setSeasonFilter] = useState('');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Listing | null>(null);
  const [saved, setSaved] = useState('');
  const [raw, setRaw] = useState<Record<string, string>>({});
  const [images, setImages] = useState<ListingImage[]>([]);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [validationChecked, setValidationChecked] = useState(false);
  const [suggestions, setSuggestions] = useState<unknown>(null);
  const [sister, setSister] = useState('');
  const [scheduleInput, setScheduleInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const requestVersion = useRef(0);
  const initialLinkHandled = useRef(false);
  const createRequestId = useRef('');
  const mutationLock = useRef(false);
  const mutationVersion = useRef(0);
  const dirty = !!draft && (JSON.stringify(draft) !== saved || Object.keys(raw).length > 0);
  const queued = !!(draft?.validation as { queued?: boolean } | undefined)?.queued;
  const unsaved = dirty || (!!draft && scheduleInput !== kstInput(draft.publish_at));
  const editable = permissions.can_edit && !busy && !['삭제됨', '삭제대기'].includes(draft?.status || '');

  const accept = useCallback((result: Result) => {
    if (mutationLock.current && mutationVersion.current !== requestVersion.current) return;
    if (!result.listing?.id) throw new Error('저장 결과에 상품 정보가 없습니다. 새로고침 후 확인해 주세요.');
    setDraft(result.listing); setSaved(JSON.stringify(result.listing)); setRaw({});
    setScheduleInput(kstInput(result.listing.publish_at));
    if (result.images) setImages(result.images);
    const persisted = result.listing.validation as { issues?: ValidationIssue[] } | undefined;
    setIssues(result.issues || persisted?.issues || []);
    setValidationChecked(!!result.issues || !!persisted?.issues);
    setSuggestions(result.suggestions || null);
    setListings(previous => [result.listing, ...previous.filter(row => row.id !== result.listing.id)]);
  }, []);

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true); setError('');
    try {
      const [index, access, itemResponse] = await Promise.all([
        registrationApi<IndexResult>(), registrationApi<Permissions>('/access'), registrationApi<{ items: Item[] }>('/items'),
      ]);
      if (version !== requestVersion.current) return;
      setListings(index.listings); setItems(itemResponse.items); setPermissions(index.permissions || access); setConnections(index.connections || {}); setSettings(index.settings || {});
      const linkedId = new URLSearchParams(window.location.search).get('listing');
      if (linkedId && !initialLinkHandled.current && (index.permissions || access).allowed) {
        const result = await registrationApi<Result>(`/${encodeURIComponent(linkedId)}`);
        if (version !== requestVersion.current) return;
        accept(result); setImages(result.images || []); initialLinkHandled.current = true;
      }
    } catch (e) { if (version === requestVersion.current) { setError(message(e)); setPermissions(NO_ACCESS); } }
    finally { if (version === requestVersion.current) setLoading(false); }
  }, [accept]);
  useEffect(() => {
    setDraft(null); setImages([]); setRaw({}); setPermissions(NO_ACCESS);
    if (workspace === 'LUMEN') void load(); else setLoading(false);
    return () => { requestVersion.current++; };
  }, [workspace, load]);
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);
  useEffect(() => {
    if (workspace !== 'LUMEN' || !draft?.id || !queued || unsaved || busy) return;
    const id = draft.id, version = requestVersion.current;
    let active = true, inFlight = false;
    const timer = window.setInterval(async () => {
      if (inFlight || mutationLock.current || version !== requestVersion.current) return;
      inFlight = true;
      try {
        const result = await registrationApi<Result>(`/${encodeURIComponent(id)}`);
        if (active && !mutationLock.current && version === requestVersion.current) accept(result);
      } catch (e) { if (active && version === requestVersion.current) setError(message(e)); }
      finally { inFlight = false; }
    }, 7500);
    return () => { active = false; window.clearInterval(timer); };
  }, [workspace, draft?.id, queued, unsaved, busy, accept]);

  const leaveDraft = () => !unsaved || window.confirm('저장하지 않은 변경·예약 시각을 버릴까요?');
  const selectListing = async (id: string) => {
    if (busy || !leaveDraft()) return;
    const version = ++requestVersion.current;
    setBusy('불러오는 중'); setError('');
    try { const result = await registrationApi<Result>(`/${encodeURIComponent(id)}`); if (version === requestVersion.current) { accept(result); setImages(result.images || []); } }
    catch (e) { if (version === requestVersion.current) setError(message(e)); }
    finally { if (version === requestVersion.current) setBusy(''); }
  };
  const newListing = () => {
    if (!leaveDraft()) return;
    createRequestId.current = `pl_${crypto.randomUUID()}`;
    const next = emptyListing(); setDraft(next); setSaved(JSON.stringify(next)); setRaw({}); setImages([]); setIssues([]); setValidationChecked(false); setSuggestions(null); setSister(''); setScheduleInput(''); setError('');
  };
  const change = (key: keyof Listing, value: unknown) => setDraft(previous => previous ? { ...previous, [key]: value } : previous);
  function materialize(): Listing {
    if (!draft) throw new Error('상품을 선택해 주세요.');
    const next = { ...draft };
    for (const section of sections) for (const field of section.fields) {
      if (!(field.key in raw)) continue;
      const value = raw[field.key];
      let parsed: unknown = value;
      if (field.type === 'list' || field.type === 'numbers') {
        const parts = value.split(/[,\n]/).map(part => part.trim()).filter(Boolean);
        parsed = field.type === 'numbers' ? parts.map(Number) : parts;
        if (field.type === 'numbers' && (parsed as number[]).some(n => !Number.isInteger(n) || n <= 0)) throw new Error(`${field.label}: 양의 정수 번호를 쉼표로 구분해 주세요.`);
      } else if (field.type === 'number') {
        parsed = !value && field.key === 'preorder_limit' ? null : Number(value);
        if (parsed !== null && (!Number.isFinite(parsed as number) || (parsed as number) < 0)) throw new Error(`${field.label}: 0 이상의 숫자를 입력해 주세요.`);
      } else if (field.type === 'shipping') {
        try { parsed = JSON.parse(value || '{}'); } catch { throw new Error('배송 설정은 올바른 JSON 객체여야 합니다.'); }
        if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('배송 설정은 JSON 객체여야 합니다.');
      }
      Object.assign(next, { [field.key]: parsed });
    }
    return next;
  }
  async function run(label: string, operation: () => Promise<void>) {
    if (mutationLock.current) return;
    mutationLock.current = true; mutationVersion.current = requestVersion.current; setBusy(label); setError('');
    try { await operation(); }
    catch (e) { if (mutationVersion.current === requestVersion.current) { setError(message(e)); toast.error(message(e)); } }
    finally { mutationLock.current = false; setBusy(''); }
  }
  const save = () => run('저장 중', async () => {
    const next = materialize();
    if (!next.item_id) throw new Error('실제 품목을 먼저 선택해 주세요.');
    const payload = editablePayload(next);
    if (next.id) delete payload.item_id;
    delete payload.publish_at;
    delete payload.season;
    const item = items.find(row => row.id === next.item_id) || next.item;
    const colors = itemColors(item);
    if (colors.length > 1) {
      if (!colors.includes(next.color_en)) throw new Error('품목에 등록된 컬러를 선택해 주세요.');
      payload.color_en = next.color_en;
    }
    if (!next.id && !createRequestId.current) createRequestId.current = `pl_${crypto.randomUUID()}`;
    const result = await registrationApi<Result>(next.id ? `/${encodeURIComponent(next.id)}` : '', {
      method: next.id ? 'PATCH' : 'POST', body: JSON.stringify(next.id ? { revision: next.revision, ...payload } : { id: createRequestId.current, ...payload }),
    });
    accept(result); toast.success('임시저장했습니다. 공개된 상품의 변경은 다시 승인이 필요합니다.');
  });
  const action = (name: string, label: string, extra: Record<string, unknown> = {}) => run(label, async () => {
    if (!draft?.id || dirty) throw new Error('변경 내용을 먼저 임시저장해 주세요.');
    const result = await registrationApi<Result>(`/${encodeURIComponent(draft.id)}/${name}`, { method: 'POST', body: JSON.stringify({ revision: draft.revision, ...extra }) });
    accept(result); toast.success(result.queued ? '채널 작업이 접수되었습니다. 반영 완료 여부는 결과를 새로 불러 확인해 주세요.' : `${label} 처리 결과를 확인해 주세요.`);
  });
  const upload = (files: File[]) => run('이미지 업로드 중', async () => {
    if (!draft?.id || dirty) throw new Error('변경 내용을 먼저 임시저장해 주세요.');
    // Preflight all files before the first upload; an oversize file never reaches the API.
    const checked = await Promise.all(files.map(async file => ({ file, ...await imageDimensions(file) })));
    let current = draft;
    for (const [index, image] of checked.entries()) {
      if (mutationVersion.current !== requestVersion.current) return;
      if (Math.abs(image.width / image.height - .75) > .01) toast.warning(`${image.file.name}: 권장 3:4 비율이 아닙니다. 이미지 구성을 확인해 주세요.`);
      const data = new FormData(); data.append('image', image.file); data.append('revision', String(current.revision));
      data.append('role', images.length === 0 && index === 0 ? 'main' : 'extra');
      data.append('width', String(image.width)); data.append('height', String(image.height));
      data.append('alt_ko', `${current.name_ko || current.name_en} - Atelier de LUMEN`); data.append('alt_en', `${current.name_en || current.name_ko} - Atelier de LUMEN`);
      const result = await registrationApi<Result>(`/${encodeURIComponent(current.id)}/images`, { method: 'POST', body: data });
      accept(result); current = result.listing;
      if (!result.images) { const detail = await registrationApi<Result>(`/${encodeURIComponent(current.id)}`); setImages(detail.images || []); }
    }
  });
  const imageMutation = (id: string, metadata?: unknown) => run('이미지 저장 중', async () => {
    if (!draft?.id || dirty) throw new Error('변경 내용을 먼저 임시저장해 주세요.');
    const path = `/${encodeURIComponent(draft.id)}/images/${encodeURIComponent(id)}`;
    const result = await registrationApi<Result>(metadata ? path : `${path}?revision=${draft.revision}`, {
      method: metadata ? 'PATCH' : 'DELETE', ...(metadata ? { body: JSON.stringify({ revision: draft.revision, ...metadata as object }) } : {}),
    });
    accept(result);
    if (!result.images) { const detail = await registrationApi<Result>(`/${encodeURIComponent(draft.id)}`); setImages(detail.images || []); }
  });
  function focusIssue(field: string) {
    const element = document.getElementById(`field-${field}`);
    if (!element) return;
    const disclosure = element.closest('details'); if (disclosure) disclosure.open = true;
    element.scrollIntoView({ behavior: 'smooth', block: 'center' }); element.focus({ preventScroll: true });
  }
  function localValidation() {
    try { setIssues(validateListing(materialize(), images)); setValidationChecked(true); setSuggestions(null); }
    catch (e) { setError(message(e)); }
  }

  if (workspace !== 'LUMEN') return <div className="p-6 text-sm text-muted-foreground">상품 등록은 LUMEN 워크스페이스에서 이용할 수 있습니다.</div>;
  const visible = listings.filter(row => (!statusFilter || row.status === statusFilter) && (!seasonFilter || row.season === seasonFilter) && (!search || `${row.name_en} ${row.name_ko} ${row.sku}`.toLowerCase().includes(search.toLowerCase())));
  const selectedItem = draft ? items.find(item => item.id === draft.item_id) : undefined;
  const masterColors = itemColors(draft?.item || selectedItem);
  const contributors = (draft?.validation as { editor_ids?: string[] } | undefined)?.editor_ids;
  const canApprove = permissions.can_approve && !!draft && draft.created_by !== permissions.user_id && draft.edited_by !== permissions.user_id && !(Array.isArray(contributors) && contributors.includes(permissions.user_id));
  const approved = !!draft && draft.approved_revision === draft.revision;
  const lifecycleBlocked = busy !== '' || dirty || !draft?.id;
  const preorderWarning = preorderGateWarning((draft?.validation as { preorder_gate?: unknown } | undefined)?.preorder_gate);

  return <div className="mx-auto max-w-[1440px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-2xl font-semibold tracking-tight">상품 등록</h1><p className="mt-1 text-sm text-muted-foreground">LUMEN · 하나의 원본으로 카페24와 Shopify 등록·검증·승인을 이어갑니다.</p></div>
      <div className="flex gap-2">
        {permissions.can_manage_settings && <Button variant="outline" disabled={!!busy} onClick={() => setShowSettings(v => !v)}><Settings2 className="mr-2 size-4" />설정</Button>}
        {!draft && <Button disabled={!permissions.can_edit || loading || !!busy} onClick={newListing}><Plus className="mr-2 size-4" />새 등록</Button>}
      </div>
    </header>
    {error && <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"><AlertCircle className="size-4 shrink-0" /><span className="flex-1">{error}</span><Button size="sm" variant="outline" disabled={!!busy} onClick={() => { if (!draft) void load(); else void selectListing(draft.id); }}>다시 불러오기</Button></div>}
    {loading ? <p role="status" className="flex items-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />상품 등록 정보를 불러오는 중입니다.</p> : <>
      {!permissions.allowed && !error && <p role="alert" className="text-sm text-muted-foreground">이 화면을 사용할 권한이 없습니다. 담당자에게 권한을 확인해 주세요.</p>}
      {permissions.allowed && <>
        <div className="flex flex-wrap gap-x-6 gap-y-2 border-y border-border py-3 text-xs text-muted-foreground">
          {(['cafe24', 'shopify'] as const).map(channel => <span key={channel}>{channel === 'cafe24' ? '카페24' : 'Shopify'} · {connectionLabel(connections[channel])}</span>)}
          <span>실제 채널 반영은 서버 연결·쓰기 허용·독립 승인 후 가능합니다.</span>
        </div>
        {showSettings && permissions.can_manage_settings && <RegistrationSettings busy={!!busy} run={run} onSaved={setSettings} />}
        {!draft ? <section aria-label="등록 상품 목록" className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(200px,1fr)_180px_160px_auto]">
            <div><Label htmlFor="listing-search">상품명 · SKU 검색</Label><Input id="listing-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="등록한 상품 검색" /></div>
            <div><Label htmlFor="status-filter">상태</Label><select id="status-filter" className={selectClass} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="">전체 상태</option>{statuses.map(status => <option key={status}>{status}</option>)}</select></div>
            <div><Label htmlFor="season-filter">시즌</Label><select id="season-filter" className={selectClass} value={seasonFilter} onChange={e => setSeasonFilter(e.target.value)}><option value="">전체 시즌</option>{[...new Set(listings.map(row => row.season).filter(Boolean))].sort().map(season => <option key={season}>{season}</option>)}</select></div>
            <Button className="self-end" variant="outline" onClick={() => void load()} aria-label="목록 새로고침"><RefreshCw className="size-4" /></Button>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-muted/40 text-muted-foreground"><tr>{['상품', '상태', '시즌', '공개 예정 · KST', '채널 반영', '마지막 결과'].map(label => <th key={label} className="p-3 font-medium">{label}</th>)}</tr></thead><tbody>
            {visible.map(row => <tr key={row.id} className="border-t border-border hover:bg-muted/30"><td className="p-3"><button className="text-left font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring" disabled={!!busy} onClick={() => void selectListing(row.id)}>{row.name_en || row.name_ko || '이름 없는 초안'}<span className="mt-1 block text-xs font-normal text-muted-foreground">{row.sku || row.item_id}{row.item_changed ? ' · 품목 변경: 반영 필요' : ''}</span></button></td><td className="p-3"><Badge variant="secondary">{row.status}</Badge></td><td className="p-3">{row.season || '—'}</td><td className="p-3 tabular-nums">{formatTime(row.publish_at)}</td><td className="p-3 text-xs">C24 {row.cafe24_product_no || '—'}<br />Shopify {row.shopify_product_id || '—'}</td><td className="max-w-64 break-words p-3 text-xs text-muted-foreground">{row.last_sync_result ? JSON.stringify(row.last_sync_result) : '아직 반영하지 않음'}</td></tr>)}
          </tbody></table>{!visible.length && <div className="p-10 text-center"><p className="font-medium">{listings.length ? '조건에 맞는 상품이 없습니다.' : '아직 등록한 상품이 없습니다.'}</p><p className="mt-2 text-sm text-muted-foreground">{listings.length ? '검색어나 상태·시즌 조건을 변경해 주세요.' : '새 등록에서 실제 품목을 선택해 초안을 시작하세요.'}</p></div>}</div>
        </section> : <>
          <div className="flex flex-wrap items-center gap-3"><Button variant="ghost" disabled={!!busy} onClick={() => { if (leaveDraft()) setDraft(null); }}><ArrowLeft className="mr-2 size-4" />목록</Button><Badge variant="secondary">{draft.status}</Badge><span className="text-xs text-muted-foreground">수정본 {draft.revision}{!draft.id ? ' · 저장 전' : dirty ? ' · 저장하지 않은 변경' : ' · 저장됨'}</span>{draft.item_changed && <span className="text-xs text-amber-600 dark:text-amber-400">품목이 변경되었습니다. 반영 전 검증이 필요합니다.</span>}</div>
          <div className="sticky top-0 z-20 flex flex-wrap gap-2 border-y border-border bg-background py-3 xl:hidden" aria-label="모바일 등록 작업">
            {permissions.can_edit && <Button size="sm" disabled={!editable} onClick={() => void save()}><Save className="mr-1 size-4" />임시저장</Button>}
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => { if (dirty || !draft.id || !permissions.can_edit) localValidation(); else void action('validate', '서버 검증'); }}>검증</Button>
            {permissions.can_edit && <Button size="sm" variant="outline" disabled={lifecycleBlocked || draft.status !== '검증통과'} onClick={() => void action('request-approval', '승인 요청')}>승인 요청</Button>}
            {permissions.can_approve && <Button size="sm" variant="outline" disabled={lifecycleBlocked || !canApprove || draft.status !== '승인대기'} onClick={() => { if (window.confirm('검증한 수정본을 승인하고 비공개 등록할까요?')) void action('approve', '승인 · 비공개 등록'); }}>승인</Button>}
            <Button size="sm" variant="ghost" onClick={() => { const panel = document.getElementById('registration-actions'); panel?.scrollIntoView({ behavior: 'smooth', block: 'start' }); panel?.focus({ preventScroll: true }); }}>전체 작업</Button>
            <div className="flex w-full items-center justify-between gap-2 border-t border-border pt-2"><p role="status" aria-live="polite" className="text-xs text-muted-foreground">{validationChecked ? `검증 결과 ${issues.length}건 · 보완 ${issues.filter(issue => issue.severity === 'error').length}건` : '검증 전'}</p><Button size="sm" variant="ghost" disabled={!validationChecked} onClick={() => { const panel = document.getElementById('validation-results'); panel?.scrollIntoView({ behavior: 'smooth', block: 'start' }); panel?.focus({ preventScroll: true }); }}>결과로 이동</Button></div>
          </div>
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0 space-y-5">
              <section className="space-y-4 rounded-lg border border-border bg-card p-5" aria-labelledby="item-heading">
                <h2 id="item-heading" className="text-base font-semibold">품목 원본</h2>
                <Label htmlFor="field-item_id">LUMEN 품목 선택 <span className="text-destructive">*</span></Label>
                <select id="field-item_id" className={selectClass} value={draft.item_id} disabled={!editable || !!draft.id} onChange={e => { const item = items.find(row => row.id === e.target.value); setDraft(previous => previous ? { ...previous, item_id: e.target.value, color_en: itemColors(item).length === 1 ? itemColors(item)[0] : '', season: String(item?.season || '') } : previous); }}><option value="">실제 품목을 선택하세요</option>{items.map(item => <option key={item.id} value={item.id}>{itemLabel(item)}</option>)}</select>
                {!items.length && <p className="text-sm text-muted-foreground">선택 가능한 품목이 없습니다. 품목 마스터를 확인해 주세요.</p>}
                <ItemFacts item={draft.item || selectedItem} listing={draft} />
                {masterColors.length > 1 && <div className="space-y-2"><Label htmlFor="field-color_en">품목 컬러 선택</Label><select id="field-color_en" className={selectClass} value={draft.color_en} disabled={!editable} onChange={e => change('color_en', e.target.value)}><option value="">마스터에 등록된 컬러 선택</option>{masterColors.map(color => <option key={color}>{color}</option>)}</select><p className="text-xs text-muted-foreground">기존 품목 컬러만 참조합니다. 새 컬러를 입력하거나 마스터를 변경하지 않습니다.</p></div>}
                <p className="text-xs text-muted-foreground">SKU·스타일·컬러·원가·소재·사이즈·RRP·품목 이미지는 읽기 전용입니다. 수정은 품목 마스터에서 진행하세요.</p>
              </section>
              {sections.map(section => <details key={section.id} open={section.id === 'basic' || (section.id === 'preorder' && !!preorderWarning)} className="group rounded-lg border border-border bg-card">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-5 py-4 font-semibold focus-visible:outline-2 focus-visible:outline-ring">{section.title}<ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" /></summary>
                <div className="space-y-4 border-t border-border p-5">{section.description && <p className="text-xs text-muted-foreground">{section.description}</p>}
                  {section.id === 'preorder' && preorderWarning && <p role="status" className="rounded-md border border-border bg-muted p-3 text-sm">{preorderWarning}</p>}
                  <div className="grid gap-x-5 gap-y-5 md:grid-cols-2">{section.fields.map(field => <FieldInput key={field.key} field={field} listing={draft} raw={raw[field.key]} disabled={!editable || field.key === 'season' || (field.key === 'is_test' && !!draft.id)} invalid={issues.some(issue => issue.field === field.key && issue.severity === 'error')}
                    onChange={value => { if (['list', 'numbers', 'number', 'shipping'].includes(field.type || '')) setRaw(previous => ({ ...previous, [field.key]: String(value) })); else change(field.key, value); }} />)}</div>
                  {section.id === 'basic' && <div className="flex flex-wrap items-end gap-3"><div className="min-w-0 flex-1"><Label htmlFor="sister-copy">같은 모델의 자매 컬러에서 공통 항목 가져오기</Label><select id="sister-copy" className={selectClass} value={sister} disabled={!editable} onChange={e => setSister(e.target.value)}><option value="">원본 등록 선택</option>{listings.filter(row => row.id !== draft.id && row.style_name && row.style_name === draft.style_name).map(row => <option key={row.id} value={row.id}>{row.name_en || row.color_en}</option>)}</select></div><Button variant="outline" disabled={!editable || lifecycleBlocked || !sister} onClick={() => { if (window.confirm('설명·분류 등 공통 항목을 선택한 자매 컬러 값으로 바꿀까요?')) void action('copy-sister', '공통 항목 복사', { source_listing_id: sister }); }}>공통 항목 복사</Button></div>}
                  {section.id === 'category' && <div className="grid gap-5 md:grid-cols-2">{(['material', 'color', 'size', 'design'] as const).map(key => <div key={key} className="space-y-2"><Label htmlFor={`field-${key}`}>{({ material: '소재', color: '색상', size: '사이즈', design: '디자인' })[key]} 필터 <span className="text-destructive">*</span></Label><select id={`field-${key}`} className={selectClass} value={draft[key]} disabled={!editable} onChange={e => change(key, e.target.value)}><option value="">코드 선택</option>{Object.entries(FILTER_CODES[key]).map(([code, option]) => <option key={code} value={code}>{option.label} · {code}</option>)}</select></div>)}</div>}
                  {section.id === 'logistics' && <div className="space-y-2"><Label htmlFor="field-shopify_channels">Shopify 판매 채널</Label><Input id="field-shopify_channels" value="온라인 스토어 (online_store)" disabled /><p className="text-xs text-muted-foreground">1단계는 온라인 스토어만 지원합니다. 검색엔진 노출·재고 추적은 서버에서 사용으로 설정합니다.</p></div>}
                  {section.id === 'preorder' && <div className="flex flex-wrap items-end gap-3"><div className="flex-1"><Label htmlFor="field-preorder_end_condition">종료 조건</Label><select id="field-preorder_end_condition" className={selectClass} disabled={!editable} value={draft.preorder_end_condition} onChange={e => change('preorder_end_condition', e.target.value)}><option value="receipt">입고 처리 시 해제</option><option value="date">지정 날짜에 해제</option></select></div><Button variant="outline" disabled={!editable || !draft.preorder_ship_date} onClick={() => { const labels = preorderLabels(draft.preorder_ship_date); change('preorder_label_ko', labels.ko); change('preorder_label_en', labels.en); }}>예약배송 문구 만들기</Button></div>}
                </div>
              </details>)}
              <details open className="rounded-lg border border-border bg-card"><summary className="cursor-pointer px-5 py-4 font-semibold">이미지 · 원본 · 순서 · 설명</summary><div className="border-t border-border p-5"><ListingImages listing={draft} images={images} disabled={!editable || !draft.id || dirty} upload={upload} update={(id, metadata) => imageMutation(id, metadata)} remove={id => imageMutation(id)} /></div></details>
              <section className="space-y-4 rounded-lg border border-border bg-card p-5" aria-labelledby="schedule-heading"><h2 id="schedule-heading" className="font-semibold">예약 공개</h2><div className="grid gap-4 md:grid-cols-2"><div className="space-y-2"><Label htmlFor="field-publish_at">공개 예정 날짜 · 시간 (KST)</Label><Input id="field-publish_at" type="datetime-local" disabled={!!busy || !permissions.can_approve} value={scheduleInput} onChange={e => setScheduleInput(e.target.value)} /><p className="text-xs text-muted-foreground">승인 후 예약 버튼으로 확정합니다. 한국 표준시(UTC+09:00).</p></div><fieldset id="field-publish_channels" tabIndex={-1} className="space-y-3"><legend className="text-sm font-medium">공개 대상 채널</legend>{(['cafe24', 'shopify'] as const).map(channel => <label key={channel} className="mr-4 inline-flex items-center gap-2 text-sm"><input type="checkbox" disabled={!editable} checked={draft.publish_channels.includes(channel)} onChange={e => change('publish_channels', e.target.checked ? [...draft.publish_channels, channel] : draft.publish_channels.filter(value => value !== channel))} />{channel === 'cafe24' ? '카페24' : 'Shopify'}</label>)}</fieldset></div></section>
              <ChannelPreview listing={draft} mappings={settings.filter_mappings as FilterMappings | undefined} />
              <section className="space-y-3 border-t border-border pt-5"><h2 className="font-semibold">채널 반영 결과</h2><dl className="grid gap-3 text-sm sm:grid-cols-3"><div><dt className="text-muted-foreground">카페24 상품 번호</dt><dd>{draft.cafe24_product_no || '—'}</dd></div><div><dt className="text-muted-foreground">Shopify 상품 ID</dt><dd className="break-all">{draft.shopify_product_id || '—'}</dd></div><div><dt className="text-muted-foreground">마지막 반영 · KST</dt><dd>{formatTime(draft.last_sync_at)}</dd></div></dl>{draft.last_sync_result && <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-3 text-xs">{JSON.stringify(draft.last_sync_result, null, 2)}</pre>}<details><summary className="cursor-pointer text-xs text-muted-foreground">완료 단계 · 승인 기록</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify({ approved_by: draft.approved_by, approved_revision: draft.approved_revision, step_keys: draft.step_keys }, null, 2)}</pre></details></section>
            </div>
            <aside id="registration-actions" tabIndex={-1} className="space-y-4 scroll-mt-24 xl:sticky xl:top-6" aria-label="검증 및 등록 작업">
              <div className="space-y-3 rounded-lg border border-border bg-card p-4"><h2 className="font-semibold">등록 작업</h2><Button className="w-full" disabled={!editable} onClick={() => void save()}><Save className="mr-2 size-4" />임시저장</Button>
                <Button className="w-full" variant="outline" disabled={!!busy} onClick={localValidation}><Check className="mr-2 size-4" />입력 항목 확인</Button>
                {permissions.can_edit && <><Button className="w-full" variant="outline" disabled={lifecycleBlocked} onClick={() => void action('validate', '서버 검증')}>서버 검증 · 문구 검사</Button><Button className="w-full" variant="outline" disabled={lifecycleBlocked} onClick={() => void action('translate', '번역 제안')}>EN · JA 번역 제안</Button><Button className="w-full" variant="outline" disabled={lifecycleBlocked || draft.status !== '검증통과'} onClick={() => void action('request-approval', '승인 요청')}>승인 요청</Button></>}
                {permissions.can_approve && <><Button className="w-full" variant="outline" disabled={lifecycleBlocked || !canApprove || draft.status !== '승인대기'} onClick={() => { if (window.confirm('검증한 수정본을 승인하고 두 채널에 비공개 등록할까요?')) void action('approve', '승인 · 비공개 등록'); }}>승인 → 비공개 등록</Button><Button className="w-full" variant="outline" disabled={lifecycleBlocked || !canApprove || !approved || draft.status !== '승인' || !scheduleInput || !draft.publish_channels.length} onClick={() => { try { const instant = kstInstant(scheduleInput); void action('schedule', '예약 공개 설정', { publish_at: instant, publish_channels: draft.publish_channels }); } catch (e) { setError(message(e)); } }}>예약</Button><Button className="w-full" variant="outline" disabled={lifecycleBlocked || !canApprove || !approved || !['승인', '예약됨'].includes(draft.status)} onClick={() => { if (window.confirm('선택 채널에 지금 공개할까요? 고객 화면에 반영됩니다.')) void action('publish', '지금 공개'); }}>지금 공개</Button><Button className="w-full" variant="outline" disabled={lifecycleBlocked || !canApprove || !approved || draft.status !== '오류'} onClick={() => { if (window.confirm('승인된 수정본의 실패 단계를 채널에 다시 반영할까요?')) void action('sync', '수정 반영'); }}>수정 반영</Button></>}
                {canApprove && draft.status === '오류' && <Button className="w-full" variant="outline" disabled={lifecycleBlocked || !approved} onClick={() => void action('retry', '실패 단계 재시도')}>실패 단계 재시도</Button>}
                {canApprove && ['승인', '공개됨'].includes(draft.status) && <Button className="w-full" variant="outline" disabled={lifecycleBlocked || !approved || draft.item_changed || !draft.approval_evidence || !draft.cafe24_product_no || !draft.shopify_product_id} onClick={() => { if (window.confirm('현재 품목 사실로 검증·독립 승인을 완료한 ERP 값을 다시 반영합니다. 고객 화면에 반영할까요?')) void action('reapply', '승인한 ERP 값 재반영', { confirm: true, approval_evidence: draft.approval_evidence }); }}>승인한 ERP 값 재반영</Button>}
                {permissions.can_manage_settings && draft.is_test && <Button className="w-full" variant="destructive" disabled={lifecycleBlocked} onClick={() => { if (window.confirm('테스트 상품과 전용 이미지를 삭제할까요? 카페24 휴지통·잔여 파일은 관리자 후처리가 필요합니다.')) void action('delete-test', '테스트 상품 삭제'); }}>테스트 상품 삭제</Button>}
                {permissions.can_approve && !canApprove && <p className="text-xs text-muted-foreground">작성자·수정자는 본인 상품을 승인할 수 없습니다.</p>}
                {dirty && <p className="text-xs text-muted-foreground">변경 내용을 저장한 뒤 검증·승인·이미지 작업을 진행하세요.</p>}
                {busy && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" />{busy}</p>}
                {!!(draft.validation as { queued?: boolean } | undefined)?.queued && <div className="space-y-2"><p role="status" className="text-xs text-muted-foreground">채널 반영 대기 · 서버에서 처리 중입니다. 아직 완료된 상태가 아닙니다.</p><Button size="sm" variant="outline" disabled={!!busy} onClick={() => void selectListing(draft.id)}>반영 결과 새로고침</Button></div>}
              </div>
              <section id="validation-results" tabIndex={-1} className="space-y-3 scroll-mt-40 rounded-lg border border-border bg-card p-4" aria-labelledby="validation-heading"><h2 id="validation-heading" className="font-semibold">검증 결과 <span className="text-sm font-normal text-muted-foreground">{issues.length}건</span></h2>{!issues.length ? <p className="text-sm text-muted-foreground">입력 항목 확인 또는 서버 검증을 실행해 주세요. 승인 여부는 서버에서 다시 확인합니다.</p> : <ul className="max-h-96 space-y-2 overflow-auto">{issues.map((issue, index) => <li key={`${issue.field}-${index}`}><button className="w-full rounded border border-border p-2 text-left text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" onClick={() => focusIssue(issue.field)}><span className="font-medium">{issue.severity === 'warning' ? '주의' : '보완'} · {sections.flatMap(section => section.fields).find(field => field.key === issue.field)?.label || issue.field}</span><span className="mt-1 block text-muted-foreground">{issue.message}</span></button></li>)}</ul>}{!!suggestions && <div><h3 className="text-sm font-medium">문구 제안 · 자동 수정하지 않음</h3><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs text-muted-foreground">{JSON.stringify(suggestions, null, 2)}</pre></div>}</section>
              {draft.status === '삭제대기' && <p className="text-xs text-muted-foreground">카페24 휴지통 비우기·잔여 이미지 파일은 관리자 화면에서 처리해야 합니다.</p>}
            </aside>
          </div>
        </>}
      </>}
    </>}
  </div>;
}

function FieldInput({ field, listing, raw, disabled, invalid, onChange }: { field: Field; listing: Listing; raw?: string; disabled: boolean; invalid: boolean; onChange: (value: unknown) => void }) {
  const id = `field-${field.key}`;
  const value = listing[field.key];
  const text = raw ?? (Array.isArray(value) ? value.join(', ') : field.type === 'shipping' ? JSON.stringify(value, null, 2) : String(value ?? ''));
  return <div className={`space-y-2 ${field.type === 'textarea' || field.type === 'shipping' ? 'md:col-span-2' : ''}`}>
    {field.type === 'shipping' ? <ShippingFields value={text} disabled={disabled} invalid={invalid} onChange={value => onChange(value)} /> : field.type === 'boolean' ? <label htmlFor={id} className="inline-flex min-h-10 items-center gap-2 text-sm"><input id={id} type="checkbox" disabled={disabled} checked={!!value} onChange={e => onChange(e.target.checked)} />{field.label}</label> : <>
      <Label htmlFor={id}>{field.label}{field.required && <span className="ml-1 text-destructive" aria-label="필수">*</span>}</Label>
      {field.type === 'textarea' ? <Textarea id={id} value={text} rows={4} disabled={disabled} aria-invalid={invalid} aria-describedby={field.hint ? `${id}-hint` : undefined} onChange={e => onChange(e.target.value)} /> : <Input id={id} value={text} type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'} min={field.type === 'number' ? 0 : undefined} step={field.type === 'number' ? 'any' : undefined} disabled={disabled} aria-invalid={invalid} aria-describedby={field.hint ? `${id}-hint` : undefined} onChange={e => onChange(e.target.value)} />}
      {field.hint && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{field.hint}</p>}
      {(field.type === 'list' || field.type === 'numbers') && <p className="text-xs text-muted-foreground">여러 값은 쉼표로 구분하세요.</p>}
    </>}
  </div>;
}
function ItemFacts({ item, listing }: { item?: Record<string, unknown>; listing: Listing }) {
  const facts = [
    ['sku', 'SKU', item?.sku || item?.code || listing.sku], ['style_name', '스타일', item?.style_no || item?.styleNo || item?.name || listing.style_name], ['color_en', '컬러', item?.color || item?.color_en || listing.color_en],
    ['supply_price', '공급가 · 원가', item?.base_cost_krw ?? item?.baseCostKrw ?? listing.supply_price], ['material-fact', '소재', item?.material], ['size-fact', '사이즈', item?.size], ['rrp-fact', 'RRP · 도매가', item?.retail_price ?? item?.retailPrice ?? item?.delivery_price ?? item?.deliveryPrice],
  ];
  const image = item?.image_url || item?.imageUrl;
  return <div className="space-y-3"><dl className="grid gap-x-6 gap-y-3 rounded-md bg-muted/30 p-4 sm:grid-cols-3">{facts.map(([id, label, value]) => <div key={String(id)}><dt className="text-xs text-muted-foreground">{String(label)}</dt><dd id={id === 'color_en' && itemColors(item).length > 1 ? undefined : `field-${id}`} tabIndex={-1} className="mt-1 break-words text-sm">{value === undefined || value === '' ? '—' : String(value)}</dd></div>)}</dl>{typeof image === 'string' && image && <img src={image} alt="품목 마스터 참고 이미지 · 채널 등록 원본과 별도" loading="lazy" className="h-32 w-24 rounded object-contain" />}</div>;
}
function connectionLabel(value: unknown): string {
  if (typeof value === 'boolean') return value ? '연결됨' : '미연결';
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const connection = value as Record<string, unknown>;
    return String(connection.message || connection.status || (connection.connected ? '연결됨' : '미연결'));
  }
  return '연결 상태 미확인';
}
function ChannelPreview({ listing, mappings }: { listing: Listing; mappings?: FilterMappings }) {
  const rows = [
    ['상품명', listing.name_ko, listing.name_en], ['가격', `${listing.price_krw.toLocaleString()} KRW`, `${listing.price_usd.toLocaleString()} USD`],
    ['SEO 제목', listing.meta_title_ko || [listing.name_ko, listing.category_name_ko, '아뜰리에 드 루멘'].filter(Boolean).join(' | '), listing.meta_title_en || [listing.name_en, listing.category_name_en].filter(Boolean).join(' | ')],
    ['SEO 설명', listing.meta_desc_ko, listing.meta_desc_en], ['필터 변환', cafe24FilterTags(listing).join(', '), (['material', 'color', 'size', 'design'] as const).map(key => { if (key === 'size') return 'size: ERP 사이즈 마스터 사용 · 참조 ID 불필요'; const mapping = mappings?.[key]?.[listing[key]]; return `${key}: ${mapping?.verified && mapping.shopify_ref ? mapping.shopify_ref : `${listing[key] || '미선택'} · CEO 매핑 확인 필요`}`; }).join('\n')],
    ['검색 태그', listing.tags_ko.join(', '), listing.tags_en.join(', ')], ['원산지', listing.origin_cafe24, listing.origin_shopify], ['독립 재고', String(listing.cafe24_qty), String(listing.shopify_qty)],
    ['상세 설명', listing.detail_html_ko, listing.desc_en], ['모바일 상세', listing.mobile_detail_html_ko || listing.detail_html_ko, '기본 상세 사용'], ['JA 번역 범위', '해당 없음', '본문 + 제품정보만 · 제목/SEO는 영문 유지'],
  ];
  return <section className="space-y-3" aria-labelledby="preview-heading"><h2 id="preview-heading" className="font-semibold">채널 변환 미리보기</h2><p className="text-xs text-muted-foreground">저장된 입력 기준입니다. HTML은 실행하지 않습니다. 실제 필터 참조는 서버의 검증된 CEO 설정으로 변환됩니다.</p><p id="preview-scroll-hint" className="text-xs text-muted-foreground md:hidden">표를 좌우로 밀어 Shopify 열까지 확인하세요.</p><div role="region" aria-label="카페24 · Shopify 변환 비교표" aria-describedby="preview-scroll-hint" tabIndex={0} className="overflow-x-auto rounded-lg border border-border focus-visible:outline-2 focus-visible:outline-ring"><table className="w-full min-w-[620px] table-fixed text-left text-sm"><thead className="bg-muted/40"><tr><th className="w-28 p-3 font-medium">항목</th><th className="p-3 font-medium">카페24</th><th className="p-3 font-medium">Shopify</th></tr></thead><tbody>{rows.map(([label, cafe, shop]) => <tr key={label} className="border-t border-border"><th scope="row" className="p-3 align-top text-xs font-medium">{label}</th>{[cafe, shop].map((text, index) => <td key={index} className="p-3 align-top"><div className="max-h-32 overflow-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">{text || '—'}</div></td>)}</tr>)}</tbody></table></div></section>;
}
function RegistrationSettings({ busy, run, onSaved }: { busy: boolean; run: (label: string, operation: () => Promise<void>) => Promise<void>; onSaved: (value: Record<string, unknown>) => void }) {
  const [value, setValue] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  const [approvers, setApprovers] = useState('');
  const [mappings, setMappings] = useState<FilterMappings>({});
  const [categories, setCategories] = useState('{}');
  const [mappingGroup, setMappingGroup] = useState<keyof FilterMappings>('material');
  const [dailyTime, setDailyTime] = useState('09:00');
  const [weeklyTime, setWeeklyTime] = useState('09:30');
  const [weeklyDay, setWeeklyDay] = useState('1');
  const [monitorEnabled, setMonitorEnabled] = useState(true);
  const [monitorReady, setMonitorReady] = useState(false);
  const [monitorError, setMonitorError] = useState('');
  const [monitorResult, setMonitorResult] = useState<unknown>(null);
  const monitorRequestIds = useRef<Partial<Record<'daily' | 'weekly', string>>>({});
  useEffect(() => {
    let active = true;
    void registrationApi<{ settings: Record<string, unknown> }>('/settings').then(({ settings: data }) => { if (!active) return; setValue(data); setApprovers(Array.isArray(data.approver_ids) ? data.approver_ids.join(', ') : ''); setMappings(data.filter_mappings as FilterMappings || {}); setCategories(JSON.stringify(data.category_mappings || {}, null, 2)); setDailyTime(String(data.daily_time || '09:00')); setWeeklyTime(String(data.weekly_time || '09:30')); setWeeklyDay(String(data.weekly_day ?? 1)); setMonitorEnabled(data.monitor_enabled !== false); onSaved(data); }).catch(e => { if (active) setError(message(e)); });
    void registrationApi<Record<string, unknown>>('/monitor/settings').then(data => { if (!active) return; setDailyTime(String(data.daily_time)); setWeeklyTime(String(data.weekly_time)); setWeeklyDay(String(data.weekly_day)); setMonitorEnabled(data.monitor_enabled === true); setMonitorReady(true); }).catch(e => { if (active) setMonitorError(message(e)); });
    return () => { active = false; };
  }, [onSaved]);
  return <section className="space-y-4 rounded-lg border border-border bg-card p-5" aria-labelledby="settings-heading"><h2 id="settings-heading" className="font-semibold">대표 전용 · 승인자 · 채널 매핑 설정</h2>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}{!value && !error ? <p className="text-sm text-muted-foreground">설정을 불러오는 중입니다.</p> : value && <>
    <div className="space-y-2"><Label htmlFor="setting-approvers">승인자 사용자 ID · 쉼표 구분</Label><Input id="setting-approvers" disabled={busy} value={approvers} onChange={e => setApprovers(e.target.value)} /></div>
    <div className="space-y-3"><Label htmlFor="setting-mapping-group">필터 참조 매핑</Label><select id="setting-mapping-group" className={selectClass} value={mappingGroup} disabled={busy} onChange={e => setMappingGroup(e.target.value as keyof FilterMappings)}><option value="material">소재</option><option value="color">색상</option><option value="size">사이즈</option><option value="design">디자인</option></select>
      <p className="text-xs text-muted-foreground">{mappingGroup === 'size' ? '사이즈는 카페24 변환값을 확인하고 확인됨을 표시하세요. Shopify는 ERP 사이즈 마스터를 사용하므로 별도 참조 ID가 필요하지 않습니다.' : '실제 스토어에서 확인한 메타오브젝트 ID를 입력하고 확인됨을 표시하세요. 코드·카페24 변환값은 고정입니다.'}</p>
      <div className="max-h-96 space-y-3 overflow-y-auto">{Object.entries(FILTER_CODES[mappingGroup]).map(([code, option]) => {
        const mapping = mappings[mappingGroup]?.[code] || {};
        const patch = (change: { shopify_ref?: string; verified?: boolean }) => setMappings(previous => ({ ...previous, [mappingGroup]: { ...previous[mappingGroup], [code]: { ...previous[mappingGroup]?.[code], cafe24: option.cafe24, ...change } } }));
        return <div key={`${mappingGroup}-${code}`} className="grid gap-2 border-b border-border pb-3 md:grid-cols-[200px_1fr_100px]"><div className="text-xs"><span className="block font-medium">{option.label} · {code}</span><span className="text-muted-foreground">카페24: {option.cafe24}</span></div>{mappingGroup === 'size' ? <span className="text-xs text-muted-foreground">Shopify: ERP 사이즈 마스터</span> : <Input aria-label={`${code} Shopify 참조`} placeholder="gid://shopify/Metaobject/..." value={mapping.shopify_ref || ''} disabled={busy} onChange={e => patch({ shopify_ref: e.target.value, verified: false })} />}<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={mapping.verified === true} disabled={busy || (mappingGroup !== 'size' && !mapping.shopify_ref)} onChange={e => patch({ verified: e.target.checked })} />확인됨</label></div>;
      })}</div>
    </div>
    <div className="space-y-2"><Label htmlFor="setting-categories">분류 매핑 JSON</Label><Textarea id="setting-categories" disabled={busy} rows={5} value={categories} onChange={e => setCategories(e.target.value)} /><p className="text-xs text-muted-foreground">기존 스토어에서 검증한 분류 번호·컬렉션 참조를 입력하세요. 운영 ID를 생성하지 않습니다.</p></div>
    <Button variant="outline" disabled={busy} onClick={() => void run('설정 저장 중', async () => {
      const parsed = JSON.parse(categories); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('분류 매핑은 JSON 객체여야 합니다.');
      for (const [key, group] of Object.entries(mappings)) if (key !== 'size') for (const mapping of Object.values(group || {})) if (mapping.verified && mapping.shopify_ref && !/^gid:\/\/shopify\/Metaobject\/[0-9]+$/.test(mapping.shopify_ref)) throw new Error('확인된 필터에는 유효한 Shopify 메타오브젝트 ID가 필요합니다.');
      const { settings: next } = await registrationApi<{ settings: Record<string, unknown> }>('/settings', { method: 'PATCH', body: JSON.stringify({ approver_ids: approvers.split(',').map(id => id.trim()).filter(Boolean), filter_mappings: mappings, category_mappings: parsed }) });
      setValue(next); onSaved(next); toast.success('설정을 저장했습니다.');
    })}>승인자 · 매핑 저장</Button>
    <div className="space-y-4 border-t border-border pt-4"><fieldset className="grid gap-3 sm:grid-cols-3" disabled={busy || !monitorReady}><legend className="mb-2 text-sm font-medium">자사몰 정기 점검 · KST</legend><div><Label htmlFor="settings-daily">일일 시각</Label><Input id="settings-daily" type="time" value={dailyTime} onChange={e => setDailyTime(e.target.value)} /></div><div><Label htmlFor="settings-weekly">주간 시각</Label><Input id="settings-weekly" type="time" value={weeklyTime} onChange={e => setWeeklyTime(e.target.value)} /></div><div><Label htmlFor="settings-weekday">주간 요일</Label><select id="settings-weekday" className={selectClass} value={weeklyDay} onChange={e => setWeeklyDay(e.target.value)}>{['일', '월', '화', '수', '목', '금', '토'].map((day, index) => <option value={index} key={day}>{day}요일</option>)}</select></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={monitorEnabled} onChange={e => setMonitorEnabled(e.target.checked)} />정기 점검 사용</label></fieldset>
      {monitorError && <p role="alert" className="text-xs text-destructive">점검 설정: {monitorError}</p>}
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || !monitorReady} onClick={() => void run('점검 일정 저장 중', async () => { await registrationApi('/monitor/settings', { method: 'PUT', body: JSON.stringify({ monitor_enabled: monitorEnabled, daily_time: dailyTime, weekly_time: weeklyTime, weekly_day: Number(weeklyDay) }) }); toast.success('점검 일정을 저장했습니다.'); })}>점검 일정 저장</Button>
        {(['daily', 'weekly'] as const).map(mode => <Button key={mode} variant="outline" disabled={busy || !monitorReady} onClick={() => void run('자사몰 점검 중', async () => { if (!monitorRequestIds.current[mode]) monitorRequestIds.current[mode] = crypto.randomUUID(); const result = await registrationApi('/monitor/run', { method: 'POST', body: JSON.stringify({ mode, request_id: monitorRequestIds.current[mode] }) }); setMonitorResult(result); delete monitorRequestIds.current[mode]; toast.success('점검 결과를 확인해 주세요.'); })}>{mode === 'daily' ? '일일 점검 지금 실행' : '전수 점검 지금 실행'}</Button>)}
      </div>{!!monitorResult && <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs text-muted-foreground">{JSON.stringify(monitorResult, null, 2)}</pre>}
    </div>
  </>}</section>;
}
