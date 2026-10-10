/** A browser may only replace the campaign version it actually read. */
export type CampaignVersion = { id: string; updatedAt: string; [key: string]: any };
export const sameCampaign = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function createCampaignSync(
  write: (next: CampaignVersion, previous?: CampaignVersion) => Promise<CampaignVersion>,
  accepted: (submitted: CampaignVersion, saved: CampaignVersion) => void,
  rejected: (submitted: CampaignVersion, baseline: CampaignVersion | undefined, error: unknown) => Promise<void>,
) {
  const pending = new Map<string, { submitted: CampaignVersion; baseline?: CampaignVersion; result: Promise<CampaignVersion> }>();
  return async (next: CampaignVersion[], previous: CampaignVersion[]) => {
    const before = new Map(previous.map(c => [c.id, c]));
    await Promise.all(next.filter(c => !sameCampaign(c, before.get(c.id))).map(async submitted => {
      const old = before.get(submitted.id);
      const ancestor = pending.get(submitted.id);
      const follows = ancestor && sameCampaign(ancestor.submitted, old) ? ancestor : undefined;
      const baseline = follows ? follows.baseline : old;
      let acknowledged = baseline;
      const result = (async () => {
        const expected = follows ? await follows.result : old;
        acknowledged = expected;
        return write(submitted, expected);
      })();
      const entry = { submitted, baseline, result };
      pending.set(submitted.id, entry);
      try { accepted(submitted, await result); }
      catch (error) { await rejected(submitted, acknowledged, error); }
      finally { if (pending.get(submitted.id) === entry) pending.delete(submitted.id); }
    }));
  };
}
