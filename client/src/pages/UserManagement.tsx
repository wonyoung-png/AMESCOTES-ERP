// 사용자 관리 — 관리자(ADMIN_EMAIL)만 접근. DB(app_users) 기반 초대/비활성/비밀번호 재설정
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getCurrentUser, isAdminEmail, ADMIN_EMAILS } from '@/lib/auth';
import type { UserRole } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { UserPlus, KeyRound, Lock } from 'lucide-react';
import { PROFILE_PLACEHOLDER, PROFILE_MAX } from '@/components/WorkCardActions';

interface DbUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  /** 조직 — 프로젝트 업무 담당자를 계정에서 고르려면 팀이 여기 있어야 한다 */
  team: string | null;
  rank: string | null;
  position: string | null;
  /** 업무 비서가 담당·결정권을 알게 하는 글 (본인은 위젯에서, 관리자는 여기서) */
  work_profile: string | null;
  is_active: boolean;
  created_at: string;
}

const ROLES: UserRole[] = ['대표', '생산관리팀장', '부관리 주임', '영업과장', '사원'];
const TEAMS = ['국내영업', '해외영업', '비주얼컨텐츠', '디자인', '생산', '마케팅', '물류CS'];

// app_users 는 서버 API 로만 읽고 쓴다. 브라우저가 DB 에 직접 붙으면 로그인 없이도
// 전 직원의 비밀번호 해시가 보였다. 관리자 여부도 서버가 다시 확인한다 (server/users.ts)
async function api(path: string, method = 'GET', body?: unknown) {
  const r = await fetch(path, {
    method, credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { code: j.error, status: r.status });
  return j;
}

async function saveOrg(id: string, patch: Partial<Pick<DbUser, 'team' | 'rank' | 'position' | 'is_active'>>) {
  await api(`/api/users/${encodeURIComponent(id)}`, 'PATCH', patch);
}

async function fetchUsers(): Promise<DbUser[]> {
  return (await api('/api/users')).items as DbUser[];
}

export default function UserManagement() {
  const currentUser = getCurrentUser();
  const queryClient = useQueryClient();
  const isAdmin = isAdminEmail(currentUser?.email);

  const { data: users = [], isLoading, refetch } = useQuery({
    queryKey: ['app_users'],
    queryFn: fetchUsers,
    enabled: isAdmin,
  });

  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState({ name: '', email: '', role: '사원' as UserRole, password: '' });
  const [resetTarget, setResetTarget] = useState<DbUser | null>(null);
  const [profileTarget, setProfileTarget] = useState<DbUser | null>(null);
  const [profileText, setProfileText] = useState('');
  const openProfile = (u: DbUser) => { setProfileTarget(u); setProfileText(u.work_profile || ''); };
  const saveProfile = async () => {
    if (!profileTarget) return;
    try {
      // 남의 프로필은 서버에서 대표 권한을 다시 확인하고 저장한다
      const r = await fetch(`/api/work/profile/${encodeURIComponent(profileTarget.id)}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: profileText }),
      });
      if (!r.ok) { toast.error(r.status === 403 ? '대표만 남의 프로필을 고칠 수 있습니다' : '저장 실패'); return; }
      toast.success(`${profileTarget.name} 업무 프로필을 저장했습니다`);
      setProfileTarget(null);
      refetch();
    } catch { toast.error('저장 실패'); }
  };
  const [resetPassword, setResetPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['app_users'] });

  if (!isAdmin) {
    return (
      <div className="p-6">
        <div className="bg-card border border-border rounded-lg p-8 flex flex-col items-center gap-2">
          <Lock className="w-5 h-5 text-muted-foreground" />
          <p className="text-sm font-semibold text-foreground">접근 권한이 없습니다</p>
          <p className="text-[13px] text-muted-foreground">사용자 관리는 관리자 계정({ADMIN_EMAILS.join(', ')})만 사용할 수 있습니다.</p>
        </div>
      </div>
    );
  }

  const handleInvite = async () => {
    const email = invite.email.trim().toLowerCase();
    const name = invite.name.trim();
    if (!name || !email || !invite.password) { toast.error('이름·이메일·임시 비밀번호를 모두 입력하세요'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast.error('이메일 형식이 올바르지 않습니다'); return; }
    if (invite.password.length < 6) { toast.error('비밀번호는 6자 이상으로 하세요'); return; }
    if (users.some(u => u.email.toLowerCase() === email)) { toast.error('이미 등록된 이메일입니다'); return; }
    setSaving(true);
    try {
      // 해시는 서버에서 만든다
      await api('/api/users', 'POST', { email, name, role: invite.role, password: invite.password });
      toast.success(`${name} 계정을 만들었습니다 — 이메일과 임시 비밀번호를 직접 전달하세요`);
      setInviteOpen(false);
      setInvite({ name: '', email: '', role: '사원', password: '' });
      refresh();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.code === 'exists' ? '이미 등록된 이메일입니다' : '계정 생성에 실패했습니다');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (u: DbUser) => {
    if (isAdminEmail(u.email)) { toast.error('관리자 계정은 비활성화할 수 없습니다'); return; }
    try { await saveOrg(u.id, { is_active: !u.is_active }); }
    catch { toast.error('변경 실패'); return; }
    toast.success(`${u.name} — ${u.is_active ? '비활성화됨 (로그인 차단)' : '활성화됨'}`);
    refresh();
  };

  const handleReset = async () => {
    if (!resetTarget) return;
    if (resetPassword.length < 6) { toast.error('비밀번호는 6자 이상으로 하세요'); return; }
    setSaving(true);
    try {
      await api(`/api/users/${encodeURIComponent(resetTarget.id)}/password`, 'POST', { password: resetPassword });
      toast.success(`${resetTarget.name} 비밀번호를 재설정했습니다`);
      setResetTarget(null);
      setResetPassword('');
      refresh();
    } catch (e) {
      console.error(e);
      toast.error('재설정 실패');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">사용자 관리</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            계정 초대 · 활성/비활성 · 비밀번호 재설정 — 관리자 전용
          </p>
        </div>
        <Button size="sm" onClick={() => setInviteOpen(true)} className="gap-1.5">
          <UserPlus className="w-4 h-4" />사용자 초대
        </Button>
      </div>

      {/* 데스크탑 — 표 */}
      <div className="hidden md:block bg-card border border-border rounded-lg overflow-hidden">
        <table className="data-table w-full text-sm">
          <thead>
            <tr className="text-[13px] font-semibold text-muted-foreground text-left">
              <th>이름</th>
              <th>이메일</th>
              <th>역할</th>
              <th>팀</th>
              <th>직급</th>
              <th>직책</th>
              <th>업무 프로필</th>
              <th className="nw">등록일</th>
              <th>활성</th>
              <th className="num">비밀번호</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">Data Loading by AMESCOTES</td></tr>
            )}
            {users.map(u => {
              const isAdminRow = isAdminEmail(u.email);
              return (
                <tr key={u.id} className="hover:bg-[var(--fill-quaternary)]">
                  <td className="font-medium text-foreground">
                    {u.name}
                    {isAdminRow && (
                      <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded-[6px] bg-primary text-primary-foreground">관리자</span>
                    )}
                  </td>
                  <td className="text-muted-foreground">{u.email}</td>
                  <td>
                    <span className="text-[13px] px-2 py-0.5 rounded-[6px] bg-[var(--fill-tertiary)] text-foreground">{u.role}</span>
                  </td>
                  <td>
                    <select
                      value={u.team || ''}
                      onChange={async e => { await saveOrg(u.id, { team: e.target.value || null }); refetch(); }}
                      className="h-7 text-[13px] border border-border rounded-md bg-card px-1.5"
                    >
                      <option value="">미지정</option>
                      {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td>
                    <input
                      defaultValue={u.rank || ''}
                      onBlur={async e => { if (e.target.value !== (u.rank || '')) { await saveOrg(u.id, { rank: e.target.value || null }); refetch(); } }}
                      placeholder="사원"
                      className="h-7 w-16 text-[13px] border border-border rounded-md bg-card px-1.5"
                    />
                  </td>
                  <td>
                    <input
                      defaultValue={u.position || ''}
                      onBlur={async e => { if (e.target.value !== (u.position || '')) { await saveOrg(u.id, { position: e.target.value || null }); refetch(); } }}
                      placeholder="팀장"
                      className="h-7 w-16 text-[13px] border border-border rounded-md bg-card px-1.5"
                    />
                  </td>
                  <td>
                    <button type="button" onClick={() => openProfile(u)}
                      className="max-w-40 truncate text-left text-[13px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">
                      {u.work_profile ? u.work_profile.split('\n')[0] : '작성하기'}
                    </button>
                  </td>
                  <td className="text-muted-foreground">{u.created_at?.slice(0, 10)}</td>
                  <td>
                    <Switch
                      checked={u.is_active}
                      disabled={isAdminRow}
                      onCheckedChange={() => handleToggleActive(u)}
                    />
                  </td>
                  <td className="num">
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setResetTarget(u)}>
                      <KeyRound className="w-3.5 h-3.5" />재설정
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 모바일 — 카드 리스트 */}
      <div className="md:hidden space-y-2">
        {isLoading && (
          <p className="py-8 text-center text-muted-foreground text-[13px]">Data Loading by AMESCOTES</p>
        )}
        {users.map(u => {
          const isAdminRow = isAdminEmail(u.email);
          return (
            <div key={u.id} className="bg-card border border-border rounded-lg p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-foreground text-sm truncate">
                    {u.name}
                    {isAdminRow && (
                      <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded-[6px] bg-primary text-primary-foreground">관리자</span>
                    )}
                  </p>
                  <p className="text-[12px] text-muted-foreground truncate">{u.email}</p>
                </div>
                <Switch
                  checked={u.is_active}
                  disabled={isAdminRow}
                  onCheckedChange={() => handleToggleActive(u)}
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] px-2 py-0.5 rounded-[6px] bg-[var(--fill-tertiary)] text-foreground">{u.role}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">{u.created_at?.slice(0, 10)}</span>
                  <Button variant="outline" size="sm" onClick={() => openProfile(u)}>프로필</Button>
                  <Button variant="outline" size="sm" className="gap-1" onClick={() => setResetTarget(u)}>
                    <KeyRound className="w-3.5 h-3.5" />재설정
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[13px] text-muted-foreground">
        초대 = 계정 생성 후 이메일·임시 비밀번호를 당사자에게 직접 전달하는 방식입니다. 첫 로그인 후 비밀번호 변경은 관리자 재설정으로 처리하세요.
      </p>

      {/* 초대 다이얼로그 */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>사용자 초대</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="inv-name">이름</Label>
              <Input id="inv-name" value={invite.name} onChange={e => setInvite(v => ({ ...v, name: e.target.value }))} placeholder="홍길동" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-email">이메일</Label>
              <Input id="inv-email" type="email" value={invite.email} onChange={e => setInvite(v => ({ ...v, email: e.target.value }))} placeholder="name@atlm.kr" />
            </div>
            <div className="space-y-1.5">
              <Label>역할</Label>
              <Select value={invite.role} onValueChange={(r: UserRole) => setInvite(v => ({ ...v, role: r }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-pw">임시 비밀번호 (6자 이상)</Label>
              <Input id="inv-pw" type="text" value={invite.password} onChange={e => setInvite(v => ({ ...v, password: e.target.value }))} placeholder="전달용 임시 비밀번호" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setInviteOpen(false)}>취소</Button>
            <Button size="sm" onClick={handleInvite} disabled={saving}>{saving ? '생성 중...' : '계정 생성'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 업무 프로필 — 업무 비서가 이 사람의 담당·결정권을 알고 분류·답변한다 */}
      <Dialog open={!!profileTarget} onOpenChange={open => { if (!open) setProfileTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>업무 프로필 — {profileTarget?.name}</DialogTitle></DialogHeader>
          <textarea value={profileText} onChange={e => setProfileText(e.target.value.slice(0, PROFILE_MAX))} rows={8}
            placeholder={PROFILE_PLACEHOLDER}
            className="w-full rounded-md border border-border bg-background p-3 text-sm resize-none outline-none focus:border-primary/50" />
          <p className="text-[12px] text-muted-foreground">{profileText.length}/{PROFILE_MAX} · 본인도 업무 비서의 "내 프로필"에서 고칠 수 있습니다</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setProfileTarget(null)}>취소</Button>
            <Button size="sm" onClick={saveProfile}>저장</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 비밀번호 재설정 다이얼로그 */}
      <Dialog open={!!resetTarget} onOpenChange={open => { if (!open) { setResetTarget(null); setResetPassword(''); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>비밀번호 재설정 — {resetTarget?.name}</DialogTitle></DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reset-pw">새 비밀번호 (6자 이상)</Label>
            <Input id="reset-pw" type="text" value={resetPassword} onChange={e => setResetPassword(e.target.value)} placeholder="새 비밀번호" />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setResetTarget(null); setResetPassword(''); }}>취소</Button>
            <Button size="sm" onClick={handleReset} disabled={saving}>{saving ? '저장 중...' : '재설정'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
