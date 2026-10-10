import { Suspense, type ReactNode } from 'react';
import { useLocation, useSearch } from 'wouter';
import ErrorBoundary from './ErrorBoundary';

// 업무 화면 오류가 나도 메뉴는 유지한다. 다른 경로로 이동하면 오류 경계를 초기화한다.
export default function RouteContent({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const search = useSearch();
  return (
    <ErrorBoundary key={location} resetKey={search}>
      <Suspense fallback={<div role="status" className="p-8 text-sm text-muted-foreground">업무 화면을 불러오는 중입니다.</div>}>
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}
