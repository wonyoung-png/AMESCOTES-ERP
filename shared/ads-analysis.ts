export type AdsMarket = "lm-kr" | "lm-gl";
export type AdsPhase =
  | "queued"
  | "planning"
  | "independent"
  | "cross_review"
  | "finalizing"
  | "completed"
  | "failed";
export type AdsModel = "claude" | "codex" | "meta";
export type AdsFact = {
  id: string;
  source: string;
  metric: string;
  value: number;
  entityId?: string;
  unit?: "ad" | "adset" | "campaign" | "account" | "product";
  period?: string;
  currency?: string;
};
export type AdsSource = {
  source: string;
  state: "ok" | "unavailable" | "partial";
  reason?: string;
  checkedAt: string;
};
export type MetaSignal = {
  id: string;
  text: string;
  factIds: string[];
  entityId?: string;
};
export type AdsSnapshot = {
  id: string;
  market: AdsMarket;
  collectedAt: string;
  hash: string;
  facts: AdsFact[];
  sources: AdsSource[];
  signals: MetaSignal[];
  alerts: AdsAlert[];
  dataAvailable: boolean;
  tokenExpiresOn: string;
  tokenNeedsRenewal: boolean;
};
export type AdsAlert = {
  id: string;
  kind: string;
  message: string;
  factIds: string[];
  entityId?: string;
};
export type AdsPlan = {
  task: string;
  market: AdsMarket;
  periodDays: 14;
  comparisonDays: 14;
  unit: "adset" | "campaign";
  metrics: string[];
  metaSignals: string[];
};
export type AdsOpinion = {
  model: AdsModel;
  state: "ok" | "unavailable" | "not_applicable";
  conclusion: string;
  evidence: { factId: string; value: number }[];
  confidence: "high" | "medium" | "low" | "unknown";
  actions: {
    entityId: string;
    action: "increase" | "decrease" | "hold";
    reason: string;
    factIds: string[];
  }[];
  reason?: string;
};
export type AdsReview = {
  model: "claude" | "codex";
  decision: "keep" | "revise";
  reason: string;
  opinion: AdsOpinion;
};
export type AdsFinal = {
  conclusion: string;
  agreements: string[];
  disagreements: { model: AdsModel; reason: string }[];
  evidence: { factId: string; value: number }[];
  confidence: AdsOpinion["confidence"];
  decisions: string[];
  codexParticipated: boolean;
};
export type AdsRun = {
  id: string;
  market: AdsMarket;
  kind: "daily" | "question";
  question: string;
  day: string;
  status: AdsPhase;
  created_at: string;
  updated_at: string;
  plan?: AdsPlan;
  snapshot?: AdsSnapshot;
  // Lightweight index metadata; raw snapshot is fetched only for a selected run.
  tokenExpiresOn?: string;
  opinions?: Partial<Record<AdsModel, AdsOpinion>>;
  reviews?: Partial<Record<"claude" | "codex", AdsReview>>;
  final?: AdsFinal;
  error?: string;
  waitStartedAt?: string;
  costUsd?: number;
  score?: {
    state: "scored" | "unavailable";
    checkedAt: string;
    models: Partial<
      Record<AdsModel, { evaluated: number; correct: number; reason?: string }>
    >;
    snapshotId?: string;
  };
};
export type AdsIndex = {
  runs: AdsRun[];
  contributionRuns?: AdsRun[];
  allowed: boolean;
  enabled?: boolean;
  market: AdsMarket;
  dailyCapUsd: number;
  spentUsd: number;
  tokenExpiresOn: string;
  tokenNeedsRenewal: boolean;
  errors?: string[];
};
export type AdsJobTask = {
  phase: "independent" | "cross_review";
  question: string;
  plan: AdsPlan;
  snapshot: AdsSnapshot;
  opinions?: Partial<Record<AdsModel, AdsOpinion>>;
};
