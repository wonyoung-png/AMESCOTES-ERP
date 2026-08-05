// 사용자 관리 — 관리자(ADMIN_EMAIL)만 접근. DB(app_users) 기반 초대/비활성/비밀번호 재설정
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { getCurrentUser, hashPassword, isAdminEmail, ADMIN_EMAILS } from '@/lib/auth';
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

interface DbUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
}

const ROLES: UserRole[] = ['대표', '생산관리팀장', '부관리 주임', '영업과장', '사원'];

async function fetchUsers(): Promise<DbUser[]> {
  const { data, error } = await supabase
    .from('app_users')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as DbUser[];
}

export default function UserManagement() {
  const currentUser = getCurrentUser();
  const queryClient = useQueryClient();
  const isAdmin = isAdminEmail(currentUser?.email);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['app_users'],
    queryFn: fetchUsers,
    enabled: isAdmin,
  });

  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState({ name: '', email: '', role: '사원' as UserRole, password: '' });
  const [resetTarget, setResetTarget] = useState<DbUser | null>(null);
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
      const { error } = await supabase.from('app_users').insert({
        id: email,
        email,
        name,
        role: invite.role,
        password_hash: hashPassword(invite.password),
        is_active: true,
      });
      if (error) throw error;
      toast.success(`${name} 계정을 만들었습니다 — 이메일과 임시 비밀번호를 직접 전달하세요`);
      setInviteOpen(false);
      setInvite({ name: '', email: '', role: '사원', password: '' });
      refresh();
    } catch (e) {
      console.error(e);
      toast.error('계정 생성에 실패했습니다');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (u: DbUser) => {
    if (isAdminEmail(u.email)) { toast.error('관리자 계정은 비활성화할 수 없습니다'); return; }
    const { error } = await supabase.from('app_users').update({ is_active: !u.is_active }).eq('id', u.id);
    if (error) { toast.error('변경 실패'); return; }
    toast.success(`${u.name} — ${u.is_active ? '비활성화됨 (로그인 차단)' : '활성화됨'}`);
    refresh();
  };

  const handleReset = async () => {
    if (!resetTarget) return;
    if (resetPassword.length < 6) { toast.error('비밀번호는 6자 이상으로 하세요'); return; }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('app_users')
        .update({ password_hash: hashPassword(resetPassword) })
        .eq('id', resetTarget.id);
      if (error) throw error;
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
      <div className="flex items-center justify-between">
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

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[13px] font-semibold text-muted-foreground text-left">
              <th className="px-4 py-3">이름</th>
              <th className="px-4 py-3">이메일</th>
              <th className="px-4 py-3">역할</th>
              <th className="px-4 py-3">등록일</th>
              <th className="px-4 py-3">활성</th>
              <th className="px-4 py-3 text-right">비밀번호</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Data Loading by AMESCOTES</td></tr>
            )}
            {users.map(u => {
              const isAdminRow = isAdminEmail(u.email);
              return (
                <tr key={u.id} className="hover:bg-[var(--fill-quaternary)]">
                  <td className="px-4 py-3 font-medium text-foreground">
                    {u.name}
                    {isAdminRow && (
                      <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded-[6px] bg-primary text-primary-foreground">관리자</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className="text-[13px] px-2 py-0.5 rounded-[6px] bg-[var(--fill-tertiary)] text-foreground">{u.role}</span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{u.created_at?.slice(0, 10)}</td>
                  <td className="px-4 py-3">
                    <Switch
                      checked={u.is_active}
                      disabled={isAdminRow}
                      onCheckedChange={() => handleToggleActive(u)}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
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
