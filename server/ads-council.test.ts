import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import {
  createAdsService,
  createAdsRouter,
  sanitizeOpinion,
  sanitizeFinal,
  validatePlan,
  scoreAdsRun,
  adsOfficeSummary,
  syncAdsConnectionNotice,
  ADS_DAILY_QUESTION,
  groundedText,
} from "./ads-council";
import type {
  AdsSnapshot,
  AdsRun,
  AdsFact,
  AdsOpinion,
} from "../shared/ads-analysis";
const now = new Date("2026-10-11T01:00:00Z");
const snap: AdsSnapshot = {
  id: "snapshot",
  market: "lm-kr",
  hash: "synthetic-hash",
  collectedAt: now.toISOString(),
  dataAvailable: true,
  facts: [
    {
      id: "spend",
      source: "meta",
      metric: "spend",
      value: 100,
      entityId: "adset_fixture",
      unit: "adset",
      period: "current",
      currency: "KRW",
    },
    {
      id: "roas",
      source: "meta",
      metric: "roas",
      value: 2,
      entityId: "adset_fixture",
      unit: "adset",
      period: "current",
      currency: "KRW",
    },
    {
      id: "ad-roas",
      source: "meta",
      metric: "roas",
      value: 3,
      entityId: "ad_fixture",
      unit: "ad",
      period: "current",
    },
  ],
  sources: [{ source: "meta", state: "ok", checkedAt: now.toISOString() }],
  signals: [],
  alerts: [],
  tokenExpiresOn: "2026-11-24",
  tokenNeedsRenewal: false,
};
const opinion = {
  conclusion: "ROAS 2 확인",
  evidence: [{ factId: "roas", value: 2 }],
  confidence: "medium",
  actions: [
    {
      entityId: "adset_fixture",
      action: "increase",
      reason: "ROAS 2",
      factIds: ["roas"],
    },
  ],
};
function fixture() {
  let date = now;
  const rs = new Map<string, any>(),
    jobs = new Map<string, any>(),
    calls: { stage: string; input: any }[] = [];
  let reserved = 0;
  const rest = async (path: string, init: any = {}) => {
    const body = init.body ? JSON.parse(init.body) : {};
    let value: any = [];
    if (path === "rpc/ads_open_run") {
      const old = [...rs.values()].find(r => r.key === body.p_key);
      if (old) value = old;
      else {
        if (reserved + 0.6 > body.p_cap)
          return new Response("ads_daily_cap", { status: 400 });
        reserved += 0.6;
        value = {
          id: body.p_run.id,
          payload: structuredClone(body.p_run),
          status: "queued",
          key: body.p_key,
        };
        rs.set(value.id, value);
      }
    } else if (path === "rpc/ads_claim_run") {
      value =
        [...rs.values()].find(
          r => !["completed", "failed"].includes(r.status)
        ) || null;
      if (value) value.lease_owner = body.p_owner;
    } else if (path === "rpc/ads_renew_run") {
      value = rs.get(body.p_id)?.lease_owner === body.p_owner;
      if (!value) return new Response("ads_lease_lost", { status: 409 });
    } else if (path === "rpc/ads_begin_call") {
      const row = rs.get(body.p_id);
      if (row.payload.calls?.[body.p_stage])
        return new Response("ads_call_already_attempted", { status: 400 });
      row.payload.calls = { ...row.payload.calls, [body.p_stage]: "attempted" };
      value = true;
    } else if (path === "rpc/ads_save_run") {
      const row = rs.get(body.p_id);
      assert.equal(row.status, body.p_expected);
      if (body.p_job)
        jobs.set(body.p_job.phase, { ...body.p_job, run_id: row.id });
      row.status = body.p_run.status;
      row.payload = structuredClone(body.p_run);
      value = row;
    } else if (path.startsWith("ads_analysis_jobs?")) {
      const params = new URLSearchParams(path.split("?")[1]);
      value = [...jobs.values()].filter(
        j =>
          !params.get("phase") ||
          j.phase === params.get("phase")?.replace("eq.", "")
      );
    } else if (path.startsWith("ads_analysis_runs?")) {
      const params = new URLSearchParams(path.split("?")[1]);
      value = [...rs.values()].filter(
        r => !params.get("id") || r.id === params.get("id")?.replace("eq.", "")
      );
    } else if (path.startsWith("ads_analysis_budget?"))
      value = [{ reserved_usd: reserved }];
    else if (path.startsWith("ads_analysis_notices?")) value = [];
    else if (path.startsWith("app_users?")) value = [{ team: "국내 MD" }];
    else throw Error("Unexpected synthetic request " + path);
    return new Response(JSON.stringify(value), {
      headers: { "Content-Type": "application/json" },
    });
  };
  const service = createAdsService({
    enabled: () => true,
    rest: rest as any,
    now: () => date,
    collect: async () => structuredClone(snap),
    authenticate: async () => ({
      id: "ceo",
      role: "대표",
      name: "Fixture",
      email: "wonyoung@atlm.kr",
    }),
    model: async (stage, input) => {
      calls.push({ stage, input: structuredClone(input) });
      return {
        costUsd: 0.05,
        value:
          stage === "plan"
            ? { task: "동일 과제", unit: "adset" }
            : stage === "cross_review"
              ? { decision: "keep", reason: "유지" }
              : stage === "final"
                ? {
                    conclusion: "ROAS 2",
                    evidence: opinion.evidence,
                    confidence: "medium",
                    decisions: ["확인해주세요"],
                  }
                : opinion,
      };
    },
  });
  return {
    service,
    rs,
    jobs,
    calls,
    advance: () => {
      date = new Date(+date + 301_000);
    },
    rest,
    setTime: (d: Date) => {
      date = d;
    },
  };
}
test("plan is bounded; invented numerical claims/evidence and ad-level actions are excluded", () => {
  const plan = validatePlan(
    { unit: "ad", periodDays: 7, url: "https://evil.invalid" },
    "lm-kr",
    "question"
  );
  assert.equal(plan.unit, "adset");
  assert.equal(plan.periodDays, 14);
  assert.equal(plan.comparisonDays, 14);
  assert.equal("url" in plan, false);
  const v = sanitizeOpinion(
    {
      ...opinion,
      conclusion: "ROAS 2 and 999% invented",
      evidence: [
        ...opinion.evidence,
        { factId: "missing", value: 999 },
        { factId: "roas", value: 9 },
      ],
      actions: [
        ...opinion.actions,
        {
          entityId: "ad_fixture",
          action: "increase",
          reason: "Ad",
          factIds: ["ad-roas"],
        },
      ],
    },
    "codex",
    snap
  );
  assert.equal(v.evidence.length, 1);
  assert.equal(v.actions.length, 1);
  assert.doesNotMatch(v.conclusion, /999/);
  assert.match(v.conclusion, /제외/);
  const final = sanitizeFinal(
    {
      conclusion: "999",
      evidence: [{ factId: "roas", value: 999 }],
      confidence: "high",
    },
    snap,
    false
  );
  assert.equal(final.confidence, "unknown");
  assert.equal(final.codexParticipated, false);
});
test("full durable progression keeps independent opinions blind, crosses once and finalizes with shared snapshot", async () => {
  const f = fixture();
  const run = await f.service.open(
    "lm-kr",
    "question",
    "왜?",
    "ceo",
    "request_fixture"
  );
  await f.service.tick();
  await f.service.tick();
  const independent = f.jobs.get("independent");
  assert.ok(independent);
  assert.equal(independent.task.snapshot.id, "snapshot");
  assert.equal("opinions" in independent.task, false);
  assert.deepEqual(
    f.calls.map(c => c.stage),
    ["plan", "independent"]
  );
  assert.equal("opinions" in f.calls[1].input, false);
  independent.status = "completed";
  independent.result = opinion;
  await f.service.tick();
  const review = f.jobs.get("cross_review");
  assert.ok(review.task.opinions.claude);
  assert.ok(review.task.opinions.codex);
  assert.equal("reviews" in review.task, false);
  review.status = "completed";
  review.result = { decision: "keep", reason: "유지" };
  await f.service.tick();
  await f.service.tick();
  const result = await f.service.get(run.id);
  assert.equal(result?.status, "completed");
  assert.equal(result?.final?.codexParticipated, true);
  assert.equal(result?.reviews?.codex?.decision, "keep");
  assert.deepEqual(
    f.calls.map(c => c.stage),
    ["plan", "independent", "cross_review", "final"]
  );
  assert.equal(await f.service.tick(), false);
});
test("runner absence waits bounded time and transparently finishes without Codex", async () => {
  const f = fixture();
  const r = await f.service.open(
    "lm-kr",
    "daily",
    ADS_DAILY_QUESTION,
    "ceo",
    "dailyrequest"
  );
  await f.service.tick();
  await f.service.tick();
  assert.equal(await f.service.tick(), false);
  f.advance();
  await f.service.tick();
  await f.service.tick();
  await f.service.tick();
  const saved = await f.service.get(r.id);
  assert.equal(saved?.final?.codexParticipated, false);
  assert.equal(saved?.opinions?.codex?.state, "unavailable");
  assert.equal(f.jobs.has("cross_review"), false);
  assert.equal(f.calls.filter(c => c.stage === "cross_review").length, 1);
});
test("uncertain model invocation is never reissued and cross-day stale run does not consume another budget", async () => {
  const f = fixture();
  const r = await f.service.open("lm-kr", "question", "q", "ceo", "req");
  f.rs.get(r.id).payload.calls = { plan: "attempted" };
  await f.service.tick();
  assert.equal(f.calls.length, 0);
  assert.equal((await f.service.get(r.id))?.status, "failed");
  const g = fixture();
  const q = await g.service.open("lm-kr", "question", "q", "ceo", "req");
  g.setTime(new Date("2026-10-12T01:00:00Z"));
  await g.service.tick();
  assert.equal(g.calls.length, 0);
  assert.equal((await g.service.get(q.id))?.error, "ads_run_day_expired");
});
test("score uses follow-up weighted ROAS; missing comparisons are not zero performance", () => {
  const r = {
    market: snap.market,
    snapshot: snap,
    opinions: { claude: sanitizeOpinion(opinion, "claude", snap) },
  } as AdsRun;
  const next = {
    ...snap,
    id: "followup",
    facts: [
      { ...snap.facts.find(f => f.metric === "roas")!, value: 3 },
      { ...snap.facts[0], id: "spend", metric: "spend", value: 100 },
    ],
  };
  const score = scoreAdsRun(r, next, now);
  assert.equal(score.models.claude?.correct, 1);
  assert.equal(score.models.claude?.evaluated, 1);
  const missing = scoreAdsRun(r, { ...next, facts: [] }, now);
  assert.equal(missing.state, "unavailable");
  assert.equal(missing.models.claude?.evaluated, 0);
});

function scoreEntity(
  entityId: string,
  unit: AdsFact["unit"],
  spend: number | undefined,
  roas: number | undefined,
  currency = "KRW"
): AdsFact[] {
  const common = {
    source: "meta.synthetic",
    entityId,
    unit,
    period: "current",
    currency,
  };
  return [
    ...(spend === undefined
      ? []
      : [
          { ...common, id: `${entityId}:spend`, metric: "spend", value: spend },
        ]),
    ...(roas === undefined
      ? []
      : [{ ...common, id: `${entityId}:roas`, metric: "roas", value: roas }]),
  ];
}
function scoreAction(
  entityId: string,
  action: AdsOpinion["actions"][number]["action"]
): AdsOpinion["actions"][number] {
  return {
    entityId,
    action,
    reason: "Synthetic prediction",
    factIds: [`${entityId}:roas`],
  };
}
function scoreFixture(actions: AdsOpinion["actions"], facts: AdsFact[]) {
  const run: AdsRun = {
    id: "score_fixture",
    market: "lm-kr",
    kind: "daily",
    question: "Synthetic scoring",
    day: "2026-10-11",
    status: "completed",
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    snapshot: structuredClone(snap),
    opinions: {
      claude: { ...sanitizeOpinion(opinion, "claude", snap), actions },
    },
  };
  return {
    run,
    next: { ...structuredClone(snap), id: "followup_score", facts },
  };
}

test("score regression: spend-weighted follow-up mean determines hits, not prior delta or unweighted mean", () => {
  // Weighted mean = (10*4 + 80*2 + 10*2.5)/100 = 2.25; plain mean = 2.833...
  const { run, next } = scoreFixture(
    [scoreAction("adset:c", "increase"), scoreAction("adset:b", "decrease")],
    [
      ...scoreEntity("adset:a", "adset", 10, 4),
      ...scoreEntity("adset:b", "adset", 80, 2),
      ...scoreEntity("adset:c", "adset", 10, 2.5),
    ]
  );
  run.snapshot!.facts = [
    ...scoreEntity("adset:c", "adset", 10, 10),
    ...scoreEntity("adset:b", "adset", 80, 1),
  ];
  const score = scoreAdsRun(run, next, now);
  assert.equal(score.state, "scored");
  assert.deepEqual(score.models.claude, { evaluated: 2, correct: 2 });
  // Inverting both predictions must miss against the same weighted baseline.
  run.opinions!.claude!.actions = [
    scoreAction("adset:c", "decrease"),
    scoreAction("adset:b", "increase"),
  ];
  assert.deepEqual(scoreAdsRun(run, next, now).models.claude, {
    evaluated: 2,
    correct: 0,
  });
});

test("score regression: campaign and adset baselines stay separate from ads and foreign currency", () => {
  const { run, next } = scoreFixture(
    [
      scoreAction("adset:high", "increase"),
      scoreAction("campaign:low", "decrease"),
      scoreAction("campaign:high", "increase"),
    ],
    [
      // Adset mean 1.2, campaign mean 9.5; neither includes ad-level performance.
      ...scoreEntity("adset:low", "adset", 90, 1),
      ...scoreEntity("adset:high", "adset", 10, 3),
      ...scoreEntity("campaign:low", "campaign", 10, 5),
      ...scoreEntity("campaign:high", "campaign", 90, 10),
      ...scoreEntity("ad:outlier", "ad", 1_000_000, 999),
      ...scoreEntity("adset:usd", "adset", 1_000_000, 999, "USD"),
    ]
  );
  assert.deepEqual(scoreAdsRun(run, next, now).models.claude, {
    evaluated: 3,
    correct: 3,
  });
  // Missing ROAS on another unit cannot invalidate a complete adset baseline.
  run.opinions!.claude!.actions = [scoreAction("adset:high", "increase")];
  next.facts = next.facts.filter(
    f => !(f.entityId === "campaign:high" && f.metric === "roas")
  );
  assert.deepEqual(scoreAdsRun(run, next, now).models.claude, {
    evaluated: 1,
    correct: 1,
  });
});

test("score regression: incomplete mean is unavailable; genuine zero ROAS counts and nonexecution skips", () => {
  const actions = [
    scoreAction("adset:a", "increase"),
    scoreAction("adset:b", "decrease"),
  ];
  const cases: {
    name: string;
    facts: AdsFact[];
    evaluated: number;
    correct: number;
  }[] = [
    {
      name: "zero ROAS with positive spend is observed performance",
      facts: [
        ...scoreEntity("adset:a", "adset", 100, 2),
        ...scoreEntity("adset:b", "adset", 100, 0),
      ],
      evaluated: 2,
      correct: 2,
    },
    {
      name: "a spent peer missing ROAS invalidates the whole same-unit mean",
      facts: [
        ...scoreEntity("adset:a", "adset", 100, 2),
        ...scoreEntity("adset:b", "adset", 100, undefined),
      ],
      evaluated: 0,
      correct: 0,
    },
    {
      name: "zero spend skips the target and excludes it from the mean",
      facts: [
        ...scoreEntity("adset:a", "adset", 100, 2),
        ...scoreEntity("adset:b", "adset", 0, 0),
      ],
      evaluated: 1,
      correct: 1,
    },
    {
      name: "missing target spend is non-evaluable even when ROAS is present",
      facts: [
        ...scoreEntity("adset:a", "adset", 100, 2),
        ...scoreEntity("adset:b", "adset", undefined, 0),
      ],
      evaluated: 1,
      correct: 1,
    },
    {
      name: "zero mean is valid: increase at equality hits, decrease at equality misses",
      facts: [
        ...scoreEntity("adset:a", "adset", 100, 0),
        ...scoreEntity("adset:b", "adset", 100, 0),
      ],
      evaluated: 2,
      correct: 1,
    },
    {
      name: "no executed entities means no baseline",
      facts: [
        ...scoreEntity("adset:a", "adset", 0, 0),
        ...scoreEntity("adset:b", "adset", 0, 0),
      ],
      evaluated: 0,
      correct: 0,
    },
  ];
  for (const scenario of cases) {
    const { run, next } = scoreFixture(actions, scenario.facts),
      score = scoreAdsRun(run, next, now);
    assert.equal(
      score.state,
      scenario.evaluated ? "scored" : "unavailable",
      scenario.name
    );
    assert.equal(
      score.models.claude?.evaluated,
      scenario.evaluated,
      scenario.name
    );
    assert.equal(score.models.claude?.correct, scenario.correct, scenario.name);
    if (!scenario.evaluated)
      assert.ok(score.models.claude?.reason, scenario.name);
  }
});

test("lost lease prevents subsequent model/collection calls and never saves another owner result", async () => {
  const f = fixture();
  await f.service.open("lm-kr", "question", "q", "ceo", "request_fixture");
  let modelCalls = 0,
    collections = 0;
  const service = createAdsService({
    ...f.service.io,
    model: async () => {
      modelCalls++;
      throw Error("must_not_call");
    },
    collect: async () => {
      collections++;
      return snap;
    },
    rest: (async (path, init) =>
      path === "rpc/ads_renew_run"
        ? new Response("ads_lease_lost", { status: 409 })
        : f.rest(path, init)) as any,
  });
  await assert.rejects(service.tick(), /ads_lease_lost/);
  assert.equal(modelCalls, 0);
  assert.equal(collections, 0);
  assert.equal([...f.rs.values()][0].status, "queued");
});

// Use the real service and fake wall clock, with the DB's owner/expiry fences.
// No provider calls, operating DB or real six-minute wait are involved.
const flushLeaseTasks = () =>
  new Promise<void>(resolve => setImmediate(resolve));
function leaseFixture() {
  const f = fixture(),
    requests: string[] = [],
    renewedAt: number[] = [];
  let leaseUntil = 0,
    owner: string | null = null;
  const began = Promise.withResolvers<void>(),
    releaseBegin = Promise.withResolvers<void>();
  let delayBegin = false;
  const rest = async (path: string, init: any = {}) => {
    requests.push(path);
    const body = init.body ? JSON.parse(init.body) : {};
    const row = f.rs.get(body.p_id);
    if (path === "rpc/ads_claim_run") {
      if (owner && leaseUntil > Date.now()) return new Response("null");
      const response = await f.rest(path, init);
      if (
        [...f.rs.values()].some(
          r => !["completed", "failed"].includes(r.status)
        )
      ) {
        owner = body.p_owner;
        leaseUntil = Date.now() + 120_000;
      }
      return response;
    }
    if (
      ["rpc/ads_renew_run", "rpc/ads_begin_call", "rpc/ads_save_run"].includes(
        path
      )
    ) {
      if (!row || owner !== body.p_owner || leaseUntil <= Date.now())
        return new Response("ads_lease_lost", { status: 409 });
    }
    if (path === "rpc/ads_renew_run") {
      leaseUntil = Date.now() + 120_000;
      renewedAt.push(Date.now());
    }
    const response = await f.rest(path, init);
    if (path === "rpc/ads_begin_call") {
      began.resolve();
      if (delayBegin) await releaseBegin.promise;
    }
    if (path === "rpc/ads_save_run") {
      owner = null;
      leaseUntil = 0;
    }
    return response;
  };
  const service = createAdsService({
    ...f.service.io,
    rest: rest as any,
    now: () => new Date(),
  });
  return {
    ...f,
    service,
    requests,
    renewedAt,
    began: began.promise,
    releaseBegin: () => releaseBegin.resolve(),
    delayBegin: () => {
      delayBegin = true;
    },
    steal: () => {
      owner = "replacement_worker";
      leaseUntil = Date.now() + 120_000;
      for (const row of f.rs.values()) row.lease_owner = owner;
    },
    remainingLease: () => leaseUntil - Date.now(),
  };
}

test("lease regression: 180s model plus 180s collection heartbeats retain ownership without replay", async t => {
  t.mock.timers.enable({ apis: ["Date", "setInterval"], now: +now });
  const f = leaseFixture(),
    model = Promise.withResolvers<{ value: unknown; costUsd: number }>(),
    collection = Promise.withResolvers<AdsSnapshot>();
  const modelStarted = Promise.withResolvers<void>(),
    collectionStarted = Promise.withResolvers<void>();
  let modelCalls = 0,
    collections = 0;
  f.service.io.model = async () => {
    modelCalls++;
    modelStarted.resolve();
    return model.promise;
  };
  f.service.io.collect = async () => {
    collections++;
    collectionStarted.resolve();
    return collection.promise;
  };
  const run = await f.service.open(
    "lm-kr",
    "question",
    "synthetic long stage",
    "ceo",
    "long_lease_fixture"
  );
  const running = f.service.tick();
  await collectionStarted.promise;
  const advance180 = async () => {
    for (let i = 0; i < 6; i++) {
      const previous = f.renewedAt.length;
      t.mock.timers.tick(30_000);
      await flushLeaseTasks();
      assert.ok(
        f.renewedAt.length > previous,
        "heartbeat must renew during the pending stage"
      );
      assert.equal(f.remainingLease(), 120_000);
      assert.equal(
        await f.service.tick(),
        false,
        "another tick cannot claim the live lease"
      );
    }
  };
  await advance180();
  collection.resolve(structuredClone(snap));
  await modelStarted.promise;
  await advance180();
  model.resolve({
    value: { task: "synthetic long stage", unit: "adset" },
    costUsd: 0.05,
  });
  assert.equal(await running, true);
  const saved = await f.service.get(run.id);
  assert.equal(saved?.status, "planning");
  assert.equal(modelCalls, 1);
  assert.equal(collections, 1);
  assert.equal(saved?.costUsd, 0.05);
  assert.deepEqual(f.rs.get(run.id).payload.calls, { plan: "done" });
  assert.equal(f.requests.filter(p => p === "rpc/ads_begin_call").length, 1);
  assert.equal(f.requests.filter(p => p === "rpc/ads_save_run").length, 1);
  const renewals = f.renewedAt.length;
  t.mock.timers.tick(60_000);
  await flushLeaseTasks();
  assert.equal(
    f.renewedAt.length,
    renewals,
    "finished tick must clear its heartbeat"
  );
});

test("lease regression: heartbeat loss during collection discards result and never saves or replays", async t => {
  t.mock.timers.enable({ apis: ["Date", "setInterval"], now: +now });
  const f = leaseFixture(),
    collection = Promise.withResolvers<AdsSnapshot>(),
    started = Promise.withResolvers<void>();
  let modelCalls = 0,
    collections = 0;
  f.service.io.model = async () => {
    modelCalls++;
    return { value: { task: "synthetic" }, costUsd: 0.05 };
  };
  f.service.io.collect = async () => {
    collections++;
    started.resolve();
    return collection.promise;
  };
  const run = await f.service.open(
    "lm-kr",
    "question",
    "synthetic owner loss",
    "ceo",
    "lost_lease_fixture"
  );
  const running = f.service.tick(),
    rejected = assert.rejects(running, /ads_lease_lost/);
  await started.promise;
  f.steal();
  t.mock.timers.tick(30_000);
  await flushLeaseTasks();
  collection.resolve(structuredClone(snap));
  await rejected;
  assert.equal(modelCalls, 0);
  assert.equal(collections, 1);
  assert.equal(f.requests.filter(p => p === "rpc/ads_save_run").length, 0);
  assert.equal(f.rs.get(run.id).status, "queued");
  assert.equal("snapshot" in f.rs.get(run.id).payload, false);
  assert.equal(f.rs.get(run.id).payload.calls, undefined);
  const attempts = f.requests.length;
  t.mock.timers.tick(60_000);
  await flushLeaseTasks();
  assert.equal(f.requests.length, attempts, "lost tick must stop heartbeats");
  // No paid call began during failed preflight. Reclaim can safely reread.
  t.mock.timers.tick(31_000);
  await flushLeaseTasks();
  assert.equal(await f.service.tick(), true);
  assert.equal(f.rs.get(run.id).status, "planning");
  assert.equal(f.rs.get(run.id).payload.error, undefined);
  assert.equal(modelCalls, 1);
  assert.equal(collections, 2);
});

test("lease regression: delayed begin_call response after lost heartbeat never invokes the model", async t => {
  t.mock.timers.enable({ apis: ["Date", "setInterval"], now: +now });
  const f = leaseFixture();
  f.delayBegin();
  let modelCalls = 0,
    collections = 0;
  f.service.io.model = async () => {
    modelCalls++;
    return { value: { task: "must not run" }, costUsd: 0.05 };
  };
  f.service.io.collect = async () => {
    collections++;
    return structuredClone(snap);
  };
  const run = await f.service.open(
    "lm-kr",
    "question",
    "synthetic begin response race",
    "ceo",
    "begin_race_fixture"
  );
  const running = f.service.tick(),
    rejected = assert.rejects(running, /ads_lease_lost/);
  await f.began;
  assert.deepEqual(f.rs.get(run.id).payload.calls, { plan: "attempted" });
  f.steal();
  t.mock.timers.tick(30_000);
  await flushLeaseTasks();
  f.releaseBegin();
  await rejected;
  assert.equal(modelCalls, 0);
  assert.equal(collections, 1);
  assert.equal(f.requests.filter(p => p === "rpc/ads_save_run").length, 0);
  assert.equal(f.rs.get(run.id).status, "queued");
  assert.equal(f.rs.get(run.id).lease_owner, "replacement_worker");
  const attempts = f.requests.length;
  t.mock.timers.tick(60_000);
  await flushLeaseTasks();
  assert.equal(
    f.requests.length,
    attempts,
    "rejected tick must clear its heartbeat"
  );
});

test("office only gets three summary lines, alerts and renewal notices; storage error is not empty success", async () => {
  const f = fixture();
  assert.equal((await adsOfficeSummary(f.rest as any, now)).state, "ok");
  assert.equal(
    (
      await adsOfficeSummary(async () => {
        throw Error("fixture");
      }, now)
    ).state,
    "unavailable"
  );
});

test("list, contribution, office and notice query thin projections; only detail reads raw snapshot", async () => {
  const paths: string[] = [];
  const brief = {
    id: "thin",
    market: "lm-kr",
    day: "2026-10-11",
    kind: "daily",
    status: "completed",
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    question: "fixture",
    tokenExpiresOn: "2027-03-01",
    final: { conclusion: "checked", codexParticipated: false, decisions: [] },
    score: {
      state: "scored",
      models: { claude: { evaluated: 1, correct: 1 } },
    },
  };
  const rest = (async (path: string, init: any = {}) => {
    paths.push(path);
    if (path.startsWith("ads_analysis_notices?"))
      return new Response(init.method ? "" : "[]");
    if (path.includes("id=eq."))
      return new Response(
        JSON.stringify([
          { payload: { ...brief, snapshot: snap }, status: "completed" },
        ])
      );
    if (path.includes("sources:payload"))
      return new Response(
        JSON.stringify([
          {
            tokenExpiresOn: "2027-03-01",
            tokenNeedsRenewal: false,
            sources: [],
            collectedAt: now.toISOString(),
          },
        ])
      );
    return new Response(JSON.stringify([brief]));
  }) as any;
  const service = createAdsService({ rest, now: () => now });
  assert.equal((await service.list("lm-kr"))[0].snapshot, undefined);
  assert.equal((await service.list("lm-kr"))[0].tokenExpiresOn, "2027-03-01");
  assert.equal(
    (await service.contribution("lm-kr"))[0].score?.models.claude?.correct,
    1
  );
  assert.equal(
    (await adsOfficeSummary(rest, now)).analyses[0].summary[0],
    "checked"
  );
  await syncAdsConnectionNotice(rest, now);
  assert.ok(
    paths
      .filter(p => p.startsWith("ads_analysis_runs?"))
      .every(
        p =>
          !p.includes("select=*") && !p.includes("snapshot:payload->snapshot")
      )
  );
  assert.equal((await service.get("thin"))?.snapshot?.id, snap.id);
  assert.match(paths.at(-1)!, /select=\*/);
});

test("numeric redaction cannot expand bounded model text beyond 700 characters", () => {
  assert.ok(groundedText("999 ".repeat(200), snap).length <= 700);
  assert.doesNotMatch(groundedText("999 ".repeat(200), snap), /999/);
  assert.equal(
    groundedText("가".repeat(697) + "3.25 다음", {
      ...snap,
      facts: [{ ...snap.facts[0], value: 3.25 }],
    }),
    "가".repeat(697)
  );
  assert.equal(
    groundedText(
      "가".repeat(237) + "3.25 다음",
      { ...snap, facts: [{ ...snap.facts[0], value: 3.25 }] },
      240
    ),
    "가".repeat(237)
  );
});

test("maximum final peer text remains bounded; token preflight rejects before any paid create", async () => {
  const peers = Object.fromEntries(
    ["claude", "codex", "meta"].map(model => [
      model,
      sanitizeOpinion(
        {
          ...opinion,
          conclusion: "검토".repeat(1000),
          actions: Array.from({ length: 6 }, () => ({
            ...opinion.actions[0],
            reason: "검토".repeat(1000),
          })),
        },
        model as AdsOpinion["model"],
        snap
      ),
    ])
  );
  const input = {
    question: "질문".repeat(1000),
    snapshot: {
      ...snap,
      facts: Array.from({ length: 80 }, (_, i) => ({
        ...snap.facts[0],
        id: `max-${i}`,
        entityId: `unit-${i}`,
        source: "x".repeat(150),
      })),
    },
    opinions: peers,
    reviews: Object.fromEntries(
      ["claude", "codex"].map(model => [
        model,
        {
          decision: "revise",
          reason: groundedText("999 ".repeat(200), snap),
          opinion: peers[model],
        },
      ])
    ),
  };
  const before = globalThis.fetch,
    oldKey = process.env.ANTHROPIC_API_KEY;
  let counted = 0,
    paid = 0;
  process.env.ANTHROPIC_API_KEY = "synthetic-test-only";
  globalThis.fetch = (async (request: any, init: any) => {
    const url = typeof request === "string" ? request : request.url;
    if (url.endsWith("/messages/count_tokens")) {
      counted++;
      const body = JSON.parse(
        typeof init?.body === "string" ? init.body : await request.text()
      );
      assert.ok(body.messages[0].content.length < 65000);
      return new Response(JSON.stringify({ input_tokens: 16001 }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    paid++;
    throw Error("paid create prohibited");
  }) as typeof fetch;
  try {
    await assert.rejects(
      createAdsService().io.model("final", input),
      /model_input_limit/
    );
    assert.equal(counted, 1);
    assert.equal(paid, 0);
  } finally {
    globalThis.fetch = before;
    if (oldKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = oldKey;
  }
});
test("missing connection stops before paid plan; no invented independent opinions", async () => {
  const f = fixture();
  f.service.io.collect = async () => ({
    ...snap,
    dataAvailable: false,
    facts: [],
    sources: [
      {
        source: "meta.auth",
        state: "unavailable",
        checkedAt: now.toISOString(),
      },
    ],
  });
  const r = await f.service.open(
    "lm-kr",
    "daily",
    ADS_DAILY_QUESTION,
    "ceo",
    "dailyrequest"
  );
  await f.service.tick();
  assert.equal(f.calls.length, 0);
  assert.equal((await f.service.get(r.id))?.status, "completed");
  assert.equal(f.jobs.size, 0);
});
test("office connection notice uses actual snapshot, correct upsert, clears after verified renewal, checks save failure", async () => {
  let current = {
      ...snap,
      tokenExpiresOn: "2026-10-15",
      tokenNeedsRenewal: true,
    },
    saved: any;
  const rest = (async (path: string, init: any = {}) => {
    if (path.startsWith("ads_analysis_runs?"))
      return new Response(JSON.stringify([{ snapshot: current }]));
    assert.equal(path, "ads_analysis_notices?on_conflict=id");
    saved = JSON.parse(init.body);
    return new Response("");
  }) as any;
  await syncAdsConnectionNotice(rest, now);
  assert.equal(saved.payload.state, "active");
  assert.equal(saved.payload.expiresOn, "2026-10-15");
  current = { ...snap, tokenExpiresOn: "2027-03-01", tokenNeedsRenewal: false };
  await syncAdsConnectionNotice(rest, now);
  assert.equal(saved.payload.state, "cleared");
  current = {
    ...current,
    sources: [
      {
        source: "meta.auth",
        state: "unavailable",
        checkedAt: now.toISOString(),
      },
    ],
  };
  await syncAdsConnectionNotice(rest, now);
  assert.equal(saved.payload.state, "active");
  assert.match(saved.payload.title, /인증 실패/);
  await assert.rejects(
    syncAdsConnectionNotice(
      (async (path: string) =>
        path.startsWith("ads_analysis_runs?")
          ? new Response("[]")
          : new Response("", { status: 500 })) as any,
      now
    ),
    /ads_storage_unavailable/
  );
});
test("actual HTTP router denies employees/runner mismatch and validates market/request shape", async () => {
  const f = fixture(),
    app = express();
  app.use(express.json());
  app.use(createAdsRouter(f.service));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const port = (server.address() as any).port,
    base = `http://127.0.0.1:${port}`;
  try {
    assert.equal(
      (await fetch(base + "/api/ads-council/jobs/next")).status,
      401
    );
    assert.equal(
      (await fetch(base + "/api/ads-council?market=OEM")).status,
      400
    );
    assert.equal((await fetch(base + "/api/ads-council/access")).status, 200);
    const r = await fetch(base + "/api/ads-council/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        market: "lm-kr",
        kind: "question",
        question: "질문",
        requestId: "request_fixture",
      }),
    });
    assert.equal(r.status, 202);
    const id = (await r.json()).run.id;
    assert.equal(
      (await fetch(base + `/api/ads-council/runs/${id}?market=lm-gl`)).status,
      404
    );
    f.service.io.authenticate = async () => null;
    assert.equal(
      (await fetch(base + "/api/ads-council?market=lm-kr")).status,
      403
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(e => (e ? reject(e) : resolve()))
    );
  }
});
