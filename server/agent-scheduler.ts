// One scheduler tick; injected I/O keeps clock and failure tests off production data.
type SchedulerIO = {
  completed: (dayStart: string, signal: AbortSignal) => Promise<string[]>;
  targets: (signal: AbortSignal) => Promise<Iterable<string>>;
  fill: (teams: string[]) => Promise<number>;
};

export function createAgentSchedulerTick(io: SchedulerIO, readTimeoutMs = 30_000) {
  let checking = false;
  return async (now = new Date()) => {
    if (checking) return;
    const kst = new Date(now.getTime() + 9 * 3600e3);
    if (kst.getUTCHours() * 60 + kst.getUTCMinutes() < 8 * 60 + 30) return;
    checking = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(Error('schedule_read_timeout')), readTimeoutMs);
    let onAbort!: () => void;
    const deadline = new Promise<never>((_, reject) => {
      onAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      const dayStart = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 3600e3).toISOString();
      const completed = new Set(await Promise.race([io.completed(dayStart, controller.signal), deadline]));
      const missing = Array.from(await Promise.race([io.targets(controller.signal), deadline])).filter(team => !completed.has(team));
      // Deadline applies to reads only; never release the lock while reports may still be written.
      clearTimeout(timer);
      if (!missing.length) return;
      const saved = await io.fill(missing);
      console.log(`[agents] 아침 점검 보완 ${saved}/${missing.length}팀`);
    } finally { clearTimeout(timer); controller.signal.removeEventListener('abort', onAbort); checking = false; }
  };
}
