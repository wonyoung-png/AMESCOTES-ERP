// AMESCOTES ERP — 인증 보호 라우트
import { isAuthenticated } from '@/lib/auth';
import { Redirect } from 'wouter';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  if (!isAuthenticated()) {
    return <Redirect to="/login" />;
  }
  return <>{children}</>;
}
