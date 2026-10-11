import { useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import type {
  AdsIndex,
  AdsMarket,
  AdsModel,
  AdsOpinion,
  AdsPhase,
  AdsRun,
  AdsSnapshot,
} from "@shared/ads-analysis";

const models: AdsModel[] = ["claude", "codex", "meta"];
const modelNames = { claude: "Claude", codex: "Codex", meta: "Meta" };
const phases: Record<AdsPhase, string> = {
  queued: "접수 대기",
  planning: "Claude 계획 중",
  independent: "모델별 독립 분석 중",
  cross_review: "교차 검토 중",
  finalizing: "최종 결론 정리 중",
  completed: "분석 완료",
  failed: "분석 실패",
};
const stepNames = {
  planning: "Claude 계획",
  independent: "모델별 독립 분석",
  cross_review: "교차 검토",
  finalizing: "최종 결론 정리",
};
const confidence = {
  high: "높음",
  medium: "보통",
  low: "낮음",
  unknown: "확인 불가",
};
const actionNames = {
  increase: "확대 제안",
  decrease: "축소 제안",
  hold: "유지 제안",
};
const tabs = { today: "오늘의 분석", question: "질문하기", history: "기록" };
type Tab = keyof typeof tabs;
const terminal = (run: AdsRun) =>
  run.status === "completed" || run.status === "failed";
export function adsRouteTarget(search: string): {
  market: AdsMarket;
  run: string;
} {
  const p = new URLSearchParams(search),
    market = p.get("market"),
    run = p.get("run") || "";
  return {
    market: market === "lm-gl" ? "lm-gl" : "lm-kr",
    run:
      (!market || market === "lm-kr" || market === "lm-gl") &&
      /^[A-Za-z0-9_-]{1,100}$/.test(run)
        ? run
        : "",
  };
}
const dayKst = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
const timeKst = (value: string) =>
  Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value))
    : "시각 확인 불가";
const message = (error: unknown) =>
  error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";
const activationMessage =
  "광고 분석 서비스 활성화가 아직 완료되지 않았습니다. 관리자에게 활성화를 확인해 주세요. 기존 기록은 계속 조회할 수 있습니다.";

export async function adsApi<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("X-Workspace", "LUMEN");
  const token = localStorage.getItem("erp_token");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(`/api/ads-council${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      data?.error === "ads_analysis_disabled"
        ? activationMessage
        : data?.error === "ads_access_denied" || response.status === 403
          ? "광고 분석 권한이 없습니다. 관리자에게 권한을 확인해 주세요."
          : data?.error ||
            (response.status === 404 || response.status === 503
              ? "광고 분석 서버가 아직 준비되지 않았습니다. 잠시 후 다시 조회해 주세요."
              : `광고 분석 요청 실패 (${response.status})`)
    );
  if (!data || typeof data !== "object")
    throw new Error("광고 분석 응답을 확인할 수 없습니다. 다시 조회해 주세요.");
  return data as T;
}

export function modelContribution(runs: AdsRun[], now = Date.now()) {
  return models.map(model => {
    let evaluated = 0,
      correct = 0,
      scoredRuns = 0;
    for (const run of runs) {
      const score = run.score,
        row = score?.models[model],
        created = Date.parse(run.created_at);
      if (
        score?.state !== "scored" ||
        !Number.isFinite(created) ||
        created > now ||
        created < now - 28 * 86400_000 ||
        !row ||
        !Number.isSafeInteger(row.evaluated) ||
        row.evaluated <= 0 ||
        !Number.isSafeInteger(row.correct) ||
        row.correct < 0 ||
        row.correct > row.evaluated
      )
        continue;
      evaluated += row.evaluated;
      correct += row.correct;
      scoredRuns++;
    }
    return {
      model,
      evaluated,
      correct,
      scoredRuns,
      percent: evaluated ? Math.round((correct / evaluated) * 100) : null,
    };
  });
}

export default function AdsAnalysis() {
  const { workspace } = useWorkspace();
  const initialTarget = useRef(
    adsRouteTarget(typeof window === "undefined" ? "" : window.location.search)
  );
  const [market, setMarket] = useState<AdsMarket>(initialTarget.current.market);
  const [tab, setTab] = useState<Tab>("today");
  const [index, setIndex] = useState<AdsIndex | null>(null);
  const [run, setRun] = useState<AdsRun | null>(null);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pollError, setPollError] = useState("");
  const [pollStopped, setPollStopped] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [reload, setReload] = useState(0);
  const [selection, setSelection] = useState("");
  const epoch = useRef(0),
    detailVersion = useRef(0),
    submitLock = useRef(false);
  const submission = useRef<{ key: string; requestId: string } | null>(null);
  const context = useRef({ market, workspace });
  context.current = { market, workspace };

  useEffect(() => {
    const version = ++epoch.current;
    const preferred =
      run?.market === market
        ? run.id
        : initialTarget.current.market === market
          ? initialTarget.current.run
          : "";
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15000);
    setIndex(null);
    setRun(null);
    setSelection("");
    setError("");
    setPollError("");
    setPollStopped(false);
    if (workspace !== "LUMEN") {
      setLoading(false);
      window.clearTimeout(timer);
      return () => controller.abort();
    }
    setLoading(true);
    void adsApi<{ allowed: boolean }>("/access", { signal: controller.signal })
      .then(access => {
        if (!access.allowed)
          throw new Error(
            "광고 분석 권한이 없습니다. 관리자에게 권한을 확인해 주세요."
          );
        return adsApi<AdsIndex>(`?market=${market}`, {
          signal: controller.signal,
        });
      })
      .then(data => {
        if (version !== epoch.current || controller.signal.aborted) return;
        if (data.market !== market)
          throw new Error(
            "다른 시장의 응답이므로 표시하지 않습니다. 다시 조회해 주세요."
          );
        setIndex(data);
        const rows = data.runs
          .filter(row => row.market === market)
          .sort((a, b) => b.created_at.localeCompare(a.created_at));
        const candidate =
          rows.find(row => row.id === preferred) ||
          (tab === "today"
            ? rows.find(row => row.kind === "daily" && row.day === dayKst())
            : tab === "question"
              ? rows.find(row => row.kind === "question")
              : rows[0]);
        if (data.allowed && candidate) {
          setRun(preferred && candidate.id !== preferred ? null : candidate);
          setSelection(preferred || candidate.id);
        } else if (data.allowed && preferred) {
          // Linked history can be older than the 100-row index. Detail API
          // independently verifies market/auth before showing any raw data.
          setSelection(preferred);
        }
        initialTarget.current.run = "";
      })
      .catch(e => {
        if (version === epoch.current)
          setError(
            controller.signal.aborted
              ? "조회 시간이 초과되었습니다. 다시 조회해 주세요."
              : message(e)
          );
      })
      .finally(() => {
        window.clearTimeout(timer);
        if (version === epoch.current) setLoading(false);
      });
    return () => {
      ++epoch.current;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [market, workspace, reload]);

  useEffect(() => {
    if (
      !selection ||
      !index?.allowed ||
      index.market !== market ||
      workspace !== "LUMEN"
    ) {
      setDetailLoading(false);
      return;
    }
    const version = ++detailVersion.current;
    const controller = new AbortController(),
      timer = window.setTimeout(() => controller.abort(), 15000);
    setDetailLoading(true);
    setPollError("");
    setPollStopped(false);
    void adsApi<{ run: AdsRun }>(
      `/runs/${encodeURIComponent(selection)}?market=${market}`,
      { signal: controller.signal }
    )
      .then(({ run: next }) => {
        if (controller.signal.aborted || version !== detailVersion.current)
          return;
        if (next.market !== market || next.id !== selection)
          throw new Error("선택한 분석과 응답이 다릅니다. 다시 조회해 주세요.");
        setRun(next);
      })
      .catch(e => {
        if (version === detailVersion.current)
          setPollError(
            controller.signal.aborted
              ? "분석 조회 시간이 초과되었습니다. 다시 조회해 주세요."
              : message(e)
          );
      })
      .finally(() => {
        window.clearTimeout(timer);
        if (version === detailVersion.current) setDetailLoading(false);
      });
    return () => {
      ++detailVersion.current;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [selection, market, workspace, index?.allowed]);

  const running = !!run && !terminal(run);
  useEffect(() => {
    if (
      !run ||
      run.market !== market ||
      index?.market !== market ||
      !running ||
      detailLoading ||
      workspace !== "LUMEN" ||
      !index?.allowed
    )
      return;
    const id = run.id,
      started = Date.now(),
      currentEpoch = epoch.current,
      version = detailVersion.current;
    let active = true,
      timeout: number,
      controller: AbortController | undefined;
    const clockTimer = window.setInterval(() => setClock(Date.now()), 1000);
    async function poll() {
      if (!active) return;
      if (Date.now() - started >= 10 * 60_000) {
        setPollStopped(true);
        return;
      }
      controller = new AbortController();
      const requestTimer = window.setTimeout(() => controller?.abort(), 15000);
      try {
        const { run: next } = await adsApi<{ run: AdsRun }>(
          `/runs/${encodeURIComponent(id)}?market=${market}`,
          { signal: controller.signal }
        );
        if (
          !active ||
          currentEpoch !== epoch.current ||
          version !== detailVersion.current
        )
          return;
        if (next.market !== market || next.id !== id)
          throw new Error("분석 응답의 시장·기록이 일치하지 않습니다.");
        setRun(next);
        setPollError("");
        setIndex(
          previous =>
            previous && {
              ...previous,
              runs: [next, ...previous.runs.filter(row => row.id !== next.id)],
            }
        );
        if (terminal(next)) return;
      } catch (e) {
        if (active) setPollError(message(e));
      } finally {
        window.clearTimeout(requestTimer);
      }
      if (active) timeout = window.setTimeout(poll, 7500);
    }
    timeout = window.setTimeout(poll, 7500);
    return () => {
      active = false;
      window.clearTimeout(timeout);
      window.clearInterval(clockTimer);
      controller?.abort();
    };
  }, [
    run?.id,
    running,
    detailLoading,
    market,
    workspace,
    index?.allowed,
    selection,
  ]);

  async function start(kind: "daily" | "question") {
    if (
      submitLock.current ||
      workspace !== "LUMEN" ||
      !index?.allowed ||
      index.enabled === false ||
      (kind === "question" && !question.trim())
    )
      return;
    const text = kind === "question" ? question.trim() : "";
    const key = JSON.stringify([market, kind, text]);
    if (submission.current?.key !== key)
      submission.current = { key, requestId: crypto.randomUUID() };
    const version = epoch.current,
      requestMarket = market;
    submitLock.current = true;
    setBusy(true);
    setError("");
    const controller = new AbortController(),
      timer = window.setTimeout(() => controller.abort(), 20000);
    try {
      const { run: next } = await adsApi<{ run: AdsRun }>("/run", {
        method: "POST",
        body: JSON.stringify({
          market,
          kind,
          question: text,
          requestId: submission.current.requestId,
        }),
        signal: controller.signal,
      });
      if (
        version !== epoch.current ||
        context.current.market !== requestMarket ||
        context.current.workspace !== "LUMEN"
      )
        return;
      if (next.market !== market)
        throw new Error(
          "분석 응답의 시장이 일치하지 않습니다. 다시 조회해 주세요."
        );
      setRun(next);
      setSelection(next.id);
      setPollStopped(false);
      setPollError("");
      setIndex(
        previous =>
          previous && {
            ...previous,
            runs: [next, ...previous.runs.filter(row => row.id !== next.id)],
          }
      );
      submission.current = null;
    } catch (e) {
      if (version === epoch.current)
        setError(
          controller.signal.aborted
            ? "접수 결과를 확인하지 못했습니다. 같은 입력으로 다시 제출하면 동일 요청으로 확인합니다."
            : message(e)
        );
    } finally {
      window.clearTimeout(timer);
      submitLock.current = false;
      setBusy(false);
    }
  }

  if (workspace !== "LUMEN")
    return (
      <div className="p-6 text-sm text-muted-foreground">
        광고 분석은 LUMEN 워크스페이스에서만 이용할 수 있습니다.
      </div>
    );
  const marketRuns = (index?.runs || [])
    .filter(row => row.market === market)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const selected = run?.market === market ? run : null;
  const capReached = !!index && index.spentUsd >= index.dailyCapUsd;
  const serviceDisabled = index?.enabled === false;
  const waitFrom = Date.parse(
    selected?.waitStartedAt || selected?.created_at || ""
  );
  const elapsed = Number.isFinite(waitFrom)
    ? Math.max(0, Math.floor((clock - waitFrom) / 1000))
    : null;
  function changeTab(next: Tab) {
    setTab(next);
    const candidate =
      next === "today"
        ? marketRuns.find(row => row.kind === "daily" && row.day === dayKst())
        : next === "question"
          ? marketRuns.find(row => row.kind === "question")
          : marketRuns[0];
    setRun(candidate || null);
    setSelection(candidate?.id || "");
  }
  return (
    <main className="mx-auto max-w-[1440px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">광고 분석</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            LUMEN · 같은 근거로 비교하는 Claude·Codex·Meta 의견. 광고는 변경하지
            않습니다.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={loading || busy}
          onClick={() => setReload(value => value + 1)}
        >
          <RefreshCw className="size-4" />
          다시 조회
        </Button>
      </header>
      <div className="flex flex-wrap gap-2" role="group" aria-label="분석 시장">
        {(["lm-kr", "lm-gl"] as const).map(value => (
          <Button
            key={value}
            variant={market === value ? "default" : "outline"}
            aria-pressed={market === value}
            disabled={busy}
            onClick={() => setMarket(value)}
          >
            {value === "lm-kr" ? "국내 · lm-kr" : "해외 · lm-gl"}
          </Button>
        ))}
      </div>
      {index?.allowed && (
        <div className="flex flex-wrap gap-x-6 gap-y-2 border-y border-border py-3 text-xs text-muted-foreground">
          <span>
            오늘 사용·예약 한도 ${index.spentUsd.toFixed(2)} / $
            {index.dailyCapUsd.toFixed(2)}
          </span>
          <span>Meta 접근 만료 {index.tokenExpiresOn || "확인 불가"}</span>
          {index.tokenNeedsRenewal && (
            <span className="font-medium text-destructive">
              Meta 토큰 재연장 필요
            </span>
          )}
        </div>
      )}
      {(error || index?.errors?.length) && (
        <div
          role="alert"
          className="flex gap-2 rounded-lg border border-border bg-card p-4 text-sm"
        >
          <AlertCircle className="size-4 shrink-0" />
          <div className="min-w-0 break-words">
            {error}
            {index?.errors?.map((item, i) => (
              <p key={i}>{item}</p>
            ))}
          </div>
        </div>
      )}
      {loading ? (
        <p
          role="status"
          className="flex items-center gap-2 py-12 text-sm text-muted-foreground"
        >
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
          분석 기록을 불러오는 중입니다.
        </p>
      ) : index && !index.allowed ? (
        <p role="status" className="py-8 text-sm text-muted-foreground">
          광고 분석 조회 권한이 없습니다. 관리자에게 권한을 확인해 주세요.
        </p>
      ) : (
        index?.allowed && (
          <>
            {serviceDisabled && (
              <p
                role="status"
                className="rounded-lg border border-border bg-muted p-4 text-sm"
              >
                {activationMessage}
              </p>
            )}
            <div
              className="flex flex-wrap gap-2 border-b border-border pb-3"
              role="group"
              aria-label="분석 화면"
            >
              {(Object.keys(tabs) as Tab[]).map(value => (
                <Button
                  key={value}
                  variant={tab === value ? "secondary" : "ghost"}
                  aria-pressed={tab === value}
                  onClick={() => changeTab(value)}
                >
                  {tabs[value]}
                </Button>
              ))}
            </div>
            {tab === "today" && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">오늘의 분석 · {dayKst()}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    광고세트·캠페인 기준, 최근 14일과 직전 14일을 비교합니다.
                  </p>
                </div>
                <Button
                  disabled={busy || serviceDisabled || capReached || running}
                  onClick={() => void start("daily")}
                >
                  {busy ? "접수 중…" : "오늘 분석 실행"}
                </Button>
              </div>
            )}
            {tab === "question" && (
              <form
                className="space-y-3"
                onSubmit={e => {
                  e.preventDefault();
                  void start("question");
                }}
              >
                <Label htmlFor="ads-question">
                  광고 성과에 대해 질문하세요
                </Label>
                <Textarea
                  id="ads-question"
                  className="min-h-28"
                  maxLength={2000}
                  value={question}
                  disabled={busy || serviceDisabled}
                  onChange={e => setQuestion(e.target.value)}
                  placeholder="지난주 해외 ROAS가 떨어진 이유는 무엇인가요?"
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    분석·제안만 제공합니다. 광고 생성·수정·켜기·끄기는 하지
                    않습니다.
                  </p>
                  <Button
                    type="submit"
                    disabled={
                      busy ||
                      serviceDisabled ||
                      capReached ||
                      running ||
                      !question.trim()
                    }
                  >
                    {busy ? "접수 중…" : "질문 분석 요청"}
                  </Button>
                </div>
              </form>
            )}
            {capReached && tab !== "history" && (
              <p role="status" className="text-sm text-destructive">
                일일 분석 비용 상한에 도달했습니다. 기존 결과는 계속 조회할 수
                있습니다.
              </p>
            )}
            {tab === "history" && (
              <>
                <section
                  className="space-y-3"
                  aria-labelledby="contribution-heading"
                >
                  <h2 id="contribution-heading" className="font-semibold">
                    최근 4주 모델별 기여도
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    조회된 기록 중 최근 28일에 생성되고 실제 채점된 권장 조치만
                    집계합니다. 미채점·데이터 없음은 0점으로 계산하지 않습니다.
                  </p>
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-muted/40">
                        <tr>
                          {["모델", "채점 기록", "적중 / 평가", "적중률"].map(
                            label => (
                              <th
                                key={label}
                                className="whitespace-nowrap p-3 font-medium"
                              >
                                {label}
                              </th>
                            )
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {modelContribution(
                          index?.contributionRuns ?? marketRuns
                        ).map(row => (
                          <tr
                            key={row.model}
                            className="border-t border-border"
                          >
                            <th className="p-3 font-medium">
                              {modelNames[row.model]}
                            </th>
                            <td className="p-3 tabular-nums">
                              {row.scoredRuns}
                            </td>
                            <td className="p-3 tabular-nums">
                              {row.evaluated
                                ? `${row.correct} / ${row.evaluated}`
                                : "미채점"}
                            </td>
                            <td className="p-3 tabular-nums">
                              {row.percent === null ? "—" : `${row.percent}%`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
                <section
                  className="space-y-3"
                  aria-labelledby="history-heading"
                >
                  <h2 id="history-heading" className="font-semibold">
                    분석·질문 기록 · 최근 100건
                  </h2>
                  {!marketRuns.length ? (
                    <p className="text-sm text-muted-foreground">
                      저장된 분석 기록이 없습니다.
                    </p>
                  ) : (
                    <ul className="divide-y divide-border border-y border-border">
                      {marketRuns.map(row => (
                        <li key={row.id}>
                          <button
                            aria-current={
                              selection === row.id ? "true" : undefined
                            }
                            className="w-full rounded-md px-2 py-3 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                            onClick={() => {
                              setRun(row);
                              setSelection(row.id);
                            }}
                          >
                            <span className="flex flex-wrap justify-between gap-2 text-sm">
                              <span className="min-w-0 break-words font-medium">
                                {row.kind === "daily"
                                  ? "일일 분석"
                                  : row.question}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {phases[row.status]}
                              </span>
                            </span>
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {timeKst(row.created_at)} ·{" "}
                              {row.score?.state === "scored"
                                ? "채점 완료"
                                : "미채점"}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            )}
            {pollError && (
              <p role="alert" className="break-words text-sm text-destructive">
                결과 갱신: {pollError} 상단의 다시 조회로 재시도할 수 있습니다.
              </p>
            )}
            {!selected ? (
              <section className="space-y-2 rounded-lg border border-border bg-card p-6">
                <h2 className="font-medium">
                  {tab === "today"
                    ? "오늘의 분석이 아직 없습니다."
                    : tab === "question"
                      ? "질문을 입력하면 분석이 시작됩니다."
                      : "분석 기록을 선택해 주세요."}
                </h2>
                <p className="text-sm text-muted-foreground">
                  결과·수치·모델 참여 여부는 서버가 반환한 기록으로만
                  표시합니다.
                </p>
              </section>
            ) : (
              <>
                <section
                  aria-label="분석 진행 상태"
                  className="space-y-3 border-y border-border py-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="min-w-0 break-words font-semibold">
                      {selected.kind === "daily"
                        ? `${selected.day} 일일 분석`
                        : selected.question}
                    </h2>
                    <Badge variant="secondary">{phases[selected.status]}</Badge>
                  </div>
                  {!terminal(selected) && (
                    <p
                      role="status"
                      aria-live="polite"
                      className="text-sm text-muted-foreground"
                    >
                      {phases[selected.status]}
                      {elapsed === null
                        ? ""
                        : ` · ${Math.floor(elapsed / 60)}분 ${elapsed % 60}초 경과`}{" "}
                      · 완료 시간은 아직 알 수 없습니다.
                    </p>
                  )}
                  <ol className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
                    {(
                      [
                        "planning",
                        "independent",
                        "cross_review",
                        "finalizing",
                      ] as AdsPhase[]
                    ).map(phase => (
                      <li
                        key={phase}
                        className={
                          selected.status === phase
                            ? "font-semibold text-foreground"
                            : ""
                        }
                      >
                        {selected.status === phase
                          ? phases[phase]
                          : stepNames[phase as keyof typeof stepNames]}
                      </li>
                    ))}
                  </ol>
                  <p className="text-xs text-muted-foreground">
                    확인된 분석 호출 비용 ·{" "}
                    {typeof selected.costUsd === "number" &&
                    Number.isFinite(selected.costUsd) &&
                    selected.costUsd >= 0
                      ? `$${selected.costUsd.toFixed(4)}`
                      : "확인되지 않음"}
                    {
                      " · 예약 한도와 별개이며, 미확인 호출 비용은 포함하지 않습니다."
                    }
                  </p>
                  {pollStopped && (
                    <p role="status" className="text-sm">
                      자동 조회를 10분 후 멈췄습니다. 서버 작업을 취소한 것은
                      아닙니다. 다시 조회로 결과를 확인해 주세요.
                    </p>
                  )}
                  {selected.error && (
                    <p
                      role="alert"
                      className="break-words text-sm text-destructive"
                    >
                      {selected.error}
                    </p>
                  )}
                </section>
                {selected.snapshot && !selected.snapshot.dataAvailable && (
                  <p
                    role="status"
                    className="rounded-lg border border-border bg-muted p-4 text-sm"
                  >
                    데이터 없음 · 수집한 근거가 부족합니다. 성과 수치나 결론을
                    추정하지 않습니다. 아래 출처 상태를 확인해 주세요.
                  </p>
                )}
                {selected.snapshot?.alerts.length ? (
                  <section
                    className="space-y-3"
                    aria-labelledby="alerts-heading"
                  >
                    <h2 id="alerts-heading" className="font-semibold">
                      경보
                    </h2>
                    <ul className="space-y-3">
                      {selected.snapshot.alerts.map(alert => (
                        <li
                          key={alert.id}
                          className="border-b border-border pb-3 text-sm"
                        >
                          <p className="break-words">{alert.message}</p>
                          <Evidence
                            ids={alert.factIds}
                            snapshot={selected.snapshot}
                          />
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                <section aria-labelledby="models-heading" className="space-y-4">
                  <h2 id="models-heading" className="font-semibold">
                    모델별 독립 원문
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    같은 스냅샷을 각자 분석한 첫 의견입니다. Meta는 API 신호만
                    표시하며 추가 판단을 만들지 않습니다.
                  </p>
                  <div className="grid gap-4 lg:grid-cols-3">
                    {models.map(model => (
                      <article
                        key={model}
                        className="min-w-0 space-y-4 rounded-lg border border-border bg-card p-5"
                      >
                        <h3 className="font-semibold">{modelNames[model]}</h3>
                        <Opinion
                          opinion={selected.opinions?.[model]}
                          model={model}
                          snapshot={selected.snapshot}
                          completed={terminal(selected)}
                        />
                        {model !== "meta" && selected.reviews?.[model] && (
                          <section className="space-y-3 border-t border-border pt-4">
                            <h4 className="text-sm font-semibold">
                              교차 검토 후 ·{" "}
                              {selected.reviews[model]!.decision === "revise"
                                ? "수정"
                                : "유지"}
                            </h4>
                            <p className="whitespace-pre-wrap break-words text-sm">
                              {selected.reviews[model]!.reason}
                            </p>
                            <Opinion
                              opinion={selected.reviews[model]!.opinion}
                              model={model}
                              snapshot={selected.snapshot}
                              completed={terminal(selected)}
                            />
                          </section>
                        )}
                        <details className="text-xs text-muted-foreground">
                          <summary className="cursor-pointer">
                            원본 JSON · 검토 전후
                          </summary>
                          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all">
                            {JSON.stringify(
                              {
                                original: selected.opinions?.[model] || null,
                                review:
                                  model === "meta"
                                    ? null
                                    : selected.reviews?.[model] || null,
                              },
                              null,
                              2
                            )}
                          </pre>
                        </details>
                      </article>
                    ))}
                  </div>
                </section>
                <section
                  className="space-y-5 rounded-lg border border-border bg-card p-5 sm:p-6"
                  aria-labelledby="final-heading"
                >
                  <h2 id="final-heading" className="text-lg font-semibold">
                    최종 결론
                  </h2>
                  {!selected.final ? (
                    <p className="text-sm text-muted-foreground">
                      {terminal(selected)
                        ? "최종 결론이 제공되지 않았습니다."
                        : "모델별 분석·교차 검토 이후 표시됩니다."}
                    </p>
                  ) : (
                    <>
                      <p className="max-w-[75ch] whitespace-pre-wrap break-words text-sm leading-relaxed">
                        {selected.final.conclusion}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        확신도 {confidence[selected.final.confidence]} ·{" "}
                        {selected.final.codexParticipated
                          ? "Codex 참여"
                          : "Codex 미참여 · Claude 정리"}
                      </p>
                      <div className="grid gap-6 md:grid-cols-2">
                        <TextList
                          title="합의된 결론"
                          values={selected.final.agreements}
                          empty="합의 항목 없음"
                        />
                        <TextList
                          title="모델별 이견"
                          values={selected.final.disagreements.map(
                            row => `${modelNames[row.model]}: ${row.reason}`
                          )}
                          empty="기록된 이견 없음"
                        />
                      </div>
                      <TextList
                        title="대표님이 결정할 것"
                        values={selected.final.decisions}
                        empty="요청된 결정 없음"
                      />
                      <Evidence
                        evidence={selected.final.evidence}
                        snapshot={selected.snapshot}
                      />
                    </>
                  )}
                </section>
                <SourceFacts run={selected} />
                {tab === "history" && (
                  <section className="space-y-3 border-t border-border pt-5">
                    <h2 className="font-semibold">2주 뒤 성과 채점</h2>
                    {selected.score?.state !== "scored" ? (
                      <p className="text-sm text-muted-foreground">
                        {selected.score?.state === "unavailable"
                          ? "채점 데이터 없음 · 결과를 0점으로 처리하지 않습니다."
                          : "아직 채점되지 않았습니다. 실제 성과를 확보한 뒤 서버에서 평가합니다."}
                      </p>
                    ) : (
                      <>
                        <p className="text-xs text-muted-foreground">
                          채점 시각 {timeKst(selected.score.checkedAt)} · 근거
                          스냅샷 {selected.score.snapshotId || "제공되지 않음"}
                        </p>
                        {models.map(model => {
                          const score = selected.score?.models[model];
                          return (
                            <p className="break-words text-sm" key={model}>
                              {modelNames[model]} ·{" "}
                              {score && score.evaluated > 0
                                ? `${score.correct} / ${score.evaluated} 적중`
                                : "평가 가능한 조치 없음"}
                              {score?.reason ? ` · ${score.reason}` : ""}
                            </p>
                          );
                        })}
                      </>
                    )}
                  </section>
                )}
              </>
            )}
          </>
        )
      )}
    </main>
  );
}

function TextList({
  title,
  values,
  empty,
}: {
  title: string;
  values: string[];
  empty: string;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {values.length ? (
        <ul className="list-disc space-y-2 pl-5 text-sm">
          {values.map((value, i) => (
            <li key={i} className="whitespace-pre-wrap break-words">
              {value}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}
function Evidence({
  evidence,
  ids,
  snapshot,
}: {
  evidence?: { factId: string; value: number }[];
  ids?: string[];
  snapshot?: AdsSnapshot;
}) {
  const rows =
    evidence ||
    (ids || []).map(factId => ({
      factId,
      value: snapshot?.facts.find(fact => fact.id === factId)?.value ?? NaN,
    }));
  return (
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer py-2">
        근거 숫자 · 출처 ({rows.length})
      </summary>
      {!rows.length ? (
        <p>제공된 근거 없음</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row, i) => {
            const fact = snapshot?.facts.find(
              fact =>
                fact.id === row.factId &&
                fact.value === row.value &&
                Number.isFinite(row.value)
            );
            return (
              <li key={i} className="break-words">
                {fact
                  ? `${fact.source} · ${fact.metric}: ${fact.value.toLocaleString("ko-KR")}${fact.currency ? ` ${fact.currency}` : ""} · ${fact.entityId || "계정 전체"} · ${fact.period || "기간 미제공"} · ${fact.id}`
                  : `${row.factId} · 스냅샷 근거 확인 불가`}
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}
function Opinion({
  opinion,
  model,
  snapshot,
  completed,
}: {
  opinion?: AdsOpinion;
  model: AdsModel;
  snapshot?: AdsSnapshot;
  completed: boolean;
}) {
  if (!opinion)
    return (
      <p className="text-sm text-muted-foreground">
        {completed
          ? model === "codex"
            ? "Codex 미참여 · 원문을 제공받지 못했습니다."
            : "제공된 의견 없음"
          : "의견 대기 중"}
      </p>
    );
  if (opinion.state !== "ok")
    return (
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>
          {opinion.state === "not_applicable"
            ? "해당 없음"
            : model === "codex"
              ? "Codex 미참여"
              : `${modelNames[model]} 이용 불가`}
        </p>
        <p className="break-words">
          {opinion.reason || "서버가 제공한 해당 의견이 없습니다."}
        </p>
      </div>
    );
  return (
    <>
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
        {opinion.conclusion}
      </p>
      <p className="text-xs text-muted-foreground">
        확신도 {confidence[opinion.confidence]}
      </p>
      {opinion.actions.length > 0 && (
        <ul className="space-y-2 text-sm">
          {opinion.actions.map((action, i) => (
            <li className="break-words" key={i}>
              {action.entityId} · {actionNames[action.action]}
              <p className="mt-1 text-xs text-muted-foreground">
                {action.reason}
              </p>
              <Evidence ids={action.factIds} snapshot={snapshot} />
            </li>
          ))}
        </ul>
      )}
      <Evidence evidence={opinion.evidence} snapshot={snapshot} />
    </>
  );
}
function SourceFacts({ run }: { run: AdsRun }) {
  const snapshot = run.snapshot;
  return (
    <section
      className="space-y-3 border-t border-border pt-5"
      aria-labelledby="sources-heading"
    >
      <h2 id="sources-heading" className="font-semibold">
        수집 출처 · 원본 근거
      </h2>
      {!snapshot ? (
        <p className="text-sm text-muted-foreground">
          수집 스냅샷이 아직 없습니다.
        </p>
      ) : (
        <>
          <p className="break-all text-xs text-muted-foreground">
            스냅샷 {snapshot.id} · {timeKst(snapshot.collectedAt)} · hash{" "}
            {snapshot.hash}
          </p>
          <ul className="space-y-2 text-sm">
            {snapshot.sources.map((source, i) => (
              <li key={i} className="break-words">
                {source.source} ·{" "}
                {source.state === "ok"
                  ? "수집 완료"
                  : source.state === "partial"
                    ? "일부 수집"
                    : "데이터 없음"}{" "}
                · {timeKst(source.checkedAt)}
                {source.reason && ` · ${source.reason}`}
              </li>
            ))}
          </ul>
          <details>
            <summary className="cursor-pointer text-sm">
              원본 수치·Meta 신호 펼치기
            </summary>
            <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(
                {
                  facts: snapshot.facts,
                  signals: snapshot.signals,
                  plan: run.plan,
                },
                null,
                2
              )}
            </pre>
          </details>
        </>
      )}
    </section>
  );
}
