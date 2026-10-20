import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';

const ACCOUNT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1Qbtfj9dwB84LUhhxpT2KpENwPZO4vsMB7KzwnJSAkXI/edit?gid=472237914#gid=472237914';

export default function CompanyAccounts() {
  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">회사 계정</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          전 직원이 공유하는 Google 시트가 회사 계정 정보의 원본입니다.
        </p>
      </div>
      <div className="rounded-lg border border-border bg-card p-5">
        <p className="mb-4 text-sm text-foreground">계정 정보는 아래 시트에서 확인하고 관리하세요.</p>
        <Button asChild size="lg" className="h-11 px-5 text-sm">
          <a href={ACCOUNT_SHEET_URL} target="_blank" rel="noopener noreferrer">
            회사 계정 시트 열기 <ExternalLink aria-hidden="true" />
          </a>
        </Button>
      </div>
    </div>
  );
}
