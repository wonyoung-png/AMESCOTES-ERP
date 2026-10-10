import { cn } from "@/lib/utils";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, ReactNode } from "react";
import { isScreenLoadError, reloadWithConfirmation } from "../lib/screenRecovery";

interface Props {
  children: ReactNode;
  resetKey?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidUpdate(previous: Props) {
    // 정상 화면은 검색 조건 변경 시 유지하고, 오류 상태만 해제한다.
    if (this.state.hasError && previous.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen p-8 bg-background">
          <div className="flex flex-col items-center w-full max-w-2xl p-8">
            <AlertTriangle
              size={48}
              className="text-destructive mb-6 flex-shrink-0"
            />

            <h2 className="text-xl mb-4">
              {isScreenLoadError(this.state.error) ? '업무 화면을 불러오지 못했습니다.' : '이 화면에 오류가 발생했습니다.'}
            </h2>
            <p className="text-sm text-muted-foreground mb-4">
              {isScreenLoadError(this.state.error)
                ? '새 버전 배포 또는 연결 문제일 수 있습니다. 인터넷 연결을 확인한 뒤 화면을 새로 불러와 주세요.'
                : '다른 메뉴로 이동하거나 화면을 새로 불러와 주세요.'}
            </p>
            <p className="text-sm text-muted-foreground mb-6">
              서버에 저장된 자료는 유지됩니다. 새로고침하면 저장하지 않은 입력은 사라질 수 있습니다.
            </p>

            <details className="p-4 w-full rounded bg-muted overflow-auto mb-6">
              <summary className="cursor-pointer text-sm">오류 상세 보기</summary>
              <pre className="text-sm text-muted-foreground whitespace-break-spaces">
                {this.state.error?.stack}
              </pre>
            </details>

            <button
              aria-label="화면 새로 불러오기"
              onClick={() => reloadWithConfirmation(
                message => window.confirm(message),
                () => window.location.reload(),
              )}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-md",
                "bg-primary text-primary-foreground",
                "hover:opacity-90 cursor-pointer"
              )}
            >
              <RotateCcw size={16} />
              화면 새로 불러오기
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
