// AMESCOTES ERP — 로그인
// 2026-04-16: 데모 계정 안내 블록 제거 (보안)
import { useState } from 'react';
import { login, initDefaultUsers } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Eye, EyeOff, Lock } from 'lucide-react';

interface LoginProps {
  onLogin: () => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // 최초 실행 시 기본 계정 초기화 (+ 팀 버전 자동 마이그레이션)
  initDefaultUsers();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { toast.error('이메일과 비밀번호를 입력해주세요'); return; }
    setLoading(true);
    setTimeout(() => {
      const user = login(email, password);
      setLoading(false);
      if (user) {
        toast.success(`${user.name}님, 환영합니다`);
        onLogin();
      } else {
        toast.error('이메일 또는 비밀번호가 올바르지 않습니다');
      }
    }, 300);
  };

  return (
    <div className="min-h-screen bg-[#F5F4EF] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* 로고 */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-[#1C1C1E] flex items-center justify-center mb-4 shadow-lg">
            <span className="text-[#C9A96E] font-bold text-xl tracking-wider">AM</span>
          </div>
          <h1 className="text-2xl font-bold text-stone-800 tracking-wide">AMESCOTES</h1>
          <p className="text-sm text-stone-400 mt-1">ERP System</p>
        </div>

        {/* 로그인 카드 */}
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-8">
          <h2 className="text-lg font-semibold text-stone-800 mb-6 flex items-center gap-2">
            <Lock className="w-4 h-4 text-[#C9A96E]" />
            로그인
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">이메일</Label>
              <Input
                id="email"
                type="email"
                placeholder="name@atlm.kr"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">비밀번호</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="비밀번호 입력"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className="h-10 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <Button
              type="submit"
              className="w-full h-10 bg-[#1C1C1E] hover:bg-stone-700 text-white font-medium"
              disabled={loading}
            >
              {loading ? '로그인 중...' : '로그인'}
            </Button>
          </form>

          {/* 안내 문구 (데모 블록 제거 — 대신 간단 안내) */}
          <p className="mt-6 text-center text-[11px] text-stone-400">
            계정 관련 문의는 대표님께 요청해 주십시오.
          </p>
        </div>

        <p className="text-center text-xs text-stone-400 mt-6">
          © 2026 (주)아메스코테스 · B2B OEM/ODM ERP
        </p>
      </div>
    </div>
  );
}
