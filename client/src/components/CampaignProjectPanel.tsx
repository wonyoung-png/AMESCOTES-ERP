// 기획전 프로젝트 워크스페이스 — 팀별 상세 업무 (BGROW L2)
import { useMemo, useState } from 'react';
import {
  phase1, CAMPAIGN_TEAMS, type Campaign, type CampaignStatus, type CampaignTask, type CampaignTaskStatus,
} from '@/lib/phase1';
import { getCurrentUser } from '@/lib/auth';
import { store } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { AtSign, Check, MessageSquare, Plus, Trash2 } from 'lucide-react';

const STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: '미온보딩',
  onboarded: '온보딩됨',
  active: '진행중',
  closed: '마감',
};

const TASK_STATUS: { value: CampaignTaskStatus; label: string }[] = [
  { value: 'todo', label: '시작전' },
  { value: 'in_progress', label: '진행중' },
  { value: 'review', label: '검토중' },
  { value: 'done', label: '완료' },
];

function TaskMentionsBlock({
  campaignId,
  task,
  onRefresh,
}: {
  campaignId: string;
  task: CampaignTask;
  onRefresh: () => void;
}) {
  const me = getCurrentUser();
  const users = store.getUsers().filter(u => u.isActive);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [mentions, setMentions] = useState<string[]>([]);
  const [askCheck, setAskCheck] = useState(true);
  const [customMention, setCustomMention] = useState('');

  const messages = task.messages || [];
  const checks = task.checks || [];
  const pendingForMe = checks.filter(c =>
    !c.checked && (
      c.targetName === me?.name ||
      (me && c.targetName.toLowerCase() === me.name.toLowerCase())
    ),
  );

  const mentionOptions = useMemo(() => {
    const names = new Set<string>();
    users.forEach(u => names.add(u.name));
    if (task.assignee?.trim()) names.add(task.assignee.trim());
    CAMPAIGN_TEAMS.forEach(t => names.add(`${t}팀`));
    return [...names];
  }, [users, task.assignee]);

  const toggleMention = (name: string) => {
    setMentions(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]);
  };

  const addCustomMention = () => {
    const n = customMention.trim();
    if (!n) return;
    if (!mentions.includes(n)) setMentions(prev => [...prev, n]);
    setCustomMention('');
  };

  const send = () => {
    if (!text.trim()) {
      toast.error('메시지를 입력하세요');
      return;
    }
    phase1.addCampaignTaskMessage(campaignId, task.id, {
      authorName: me?.name || '나',
      authorId: me?.id,
      text: text.trim(),
      mentions,
      askCheck,
    });
    setText('');
    setMentions([]);
    toast.success(askCheck && mentions.length ? '메시지·체크 요청이 등록되었습니다' : '메시지가 등록되었습니다');
    onRefresh();
  };

  const doCheck = (checkId: string) => {
    phase1.toggleCampaignTaskCheck(campaignId, task.id, checkId, me?.name || '나');
    toast.success('체크 확인했습니다');
    onRefresh();
  };

  const pendingCount = checks.filter(c => !c.checked).length;

  return (
    <div className="mt-1 border-t border-border pt-2">
      <button
        type="button"
        className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-primary"
        onClick={() => setOpen(o => !o)}
      >
        <MessageSquare className="w-3.5 h-3.5" />
        멘션 · 메시지
        {messages.length > 0 && <span className="text-muted-foreground">({messages.length})</span>}
        {pendingCount > 0 && (
          <Badge variant="outline" className="text-[11px] h-4 px-1 border-border text-[var(--system-orange)]">
            체크대기 {pendingCount}
          </Badge>
        )}
        {pendingForMe.length > 0 && (
          <Badge className="text-[11px] h-4 px-1 bg-[var(--system-orange)]">내 체크 {pendingForMe.length}</Badge>
        )}
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {messages.length === 0 && (
            <p className="text-[11px] text-muted-foreground">아직 메시지가 없습니다. @멘션으로 체크를 요청하세요.</p>
          )}
          {messages.map(msg => {
            const msgChecks = checks.filter(c => c.messageId === msg.id);
            return (
              <div key={msg.id} className="rounded-md bg-muted border border-border p-2 text-xs space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-foreground">{msg.authorName}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {new Date(msg.createdAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p className="text-foreground whitespace-pre-wrap">{msg.text}</p>
                {msg.mentions.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {msg.mentions.map(m => (
                      <span key={m} className="inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                        <AtSign className="w-2.5 h-2.5" />{m}
                      </span>
                    ))}
                  </div>
                )}
                {msgChecks.length > 0 && (
                  <div className="space-y-1 pt-1 border-t border-border">
                    {msgChecks.map(c => {
                      const isMine = me && (c.targetName === me.name || c.targetName.toLowerCase() === me.name.toLowerCase());
                      return (
                        <div key={c.id} className="flex items-center justify-between gap-2">
                          <span className={`text-[11px] ${c.checked ? 'text-[var(--system-green)]' : 'text-[var(--system-orange)]'}`}>
                            {c.checked
                              ? `✓ ${c.targetName} 확인 (${c.checkedBy || ''}${c.checkedAt ? ` · ${new Date(c.checkedAt).toLocaleDateString('ko-KR')}` : ''})`
                              : `◯ ${c.targetName} 체크 대기`}
                          </span>
                          {isMine && (
                            <Button
                              type="button"
                              size="sm"
                              variant={c.checked ? 'outline' : 'secondary'}
                              className="h-6 text-[11px] px-2"
                              onClick={() => doCheck(c.id)}
                            >
                              <Check className="w-3 h-3 mr-0.5" />
                              {c.checked ? '체크 취소' : '확인 체크'}
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          <div className="rounded-md border border-dashed border-border p-2 space-y-2 bg-card">
            <textarea
              className="w-full text-xs border rounded-md px-2 py-1.5 min-h-[56px] resize-y"
              placeholder="메시지 입력... (예: 할인율 재확인 부탁해요)"
              value={text}
              onChange={e => setText(e.target.value)}
            />
            <div>
              <p className="text-[11px] text-muted-foreground mb-1 flex items-center gap-1">
                <AtSign className="w-3 h-3" />멘션할 사람
              </p>
              <div className="flex flex-wrap gap-1 mb-1.5">
                {mentionOptions.map(name => {
                  const on = mentions.includes(name);
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => toggleMention(name)}
                      className={`text-[11px] px-1.5 py-0.5 rounded border ${
                        on ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-muted-foreground border-border hover:border-primary/50'
                      }`}
                    >
                      @{name}
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-1">
                <Input
                  className="h-7 text-xs"
                  placeholder="이름 직접 입력 후 추가"
                  value={customMention}
                  onChange={e => setCustomMention(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomMention(); } }}
                />
                <Button type="button" size="sm" variant="outline" className="h-7 text-xs shrink-0" onClick={addCustomMention}>
                  @추가
                </Button>
              </div>
            </div>
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                className="accent-primary"
                checked={askCheck}
                onChange={e => setAskCheck(e.target.checked)}
              />
              멘션한 사람에게 체크 요청
            </label>
            <Button type="button" size="sm" variant="secondary" className="h-7 w-full text-xs" onClick={send}>
              메시지 등록
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

interface Props {
  campaign: Campaign | null;
  onClose: () => void;
  onRefresh: () => void;
}

export default function CampaignProjectPanel({ campaign, onClose, onRefresh }: Props) {
  const [teamTab, setTeamTab] = useState<string>('MD');
  const [newLabel, setNewLabel] = useState('');
  const [newAssignee, setNewAssignee] = useState('');
  const [newDueDate, setNewDueDate] = useState('');
  const detail = campaign ? phase1.getCampaign(campaign.id) : null;
  if (!detail) return null;

  const progress = phase1.getCampaignProgress(detail);

  const refreshDetail = () => {
    onRefresh();
  };

  const toggleTask = (taskId: string) => {
    phase1.toggleCampaignTask(detail.id, taskId);
    refreshDetail();
  };

  const patchTask = (taskId: string, patch: Parameters<typeof phase1.updateCampaignTask>[2]) => {
    phase1.updateCampaignTask(detail.id, taskId, patch);
    refreshDetail();
  };

  const setTaskStatus = (taskId: string, status: CampaignTaskStatus) => {
    phase1.updateCampaignTask(detail.id, taskId, { status, done: status === 'done' });
    refreshDetail();
  };

  const onboard = () => {
    phase1.onboardCampaign(detail.id);
    toast.success('캘린더 온보딩되었습니다. 팀 탭에서 업무를 직접 추가하세요');
    refreshDetail();
  };

  const addTask = () => {
    const label = newLabel.trim();
    if (!label) {
      toast.error('업무명을 입력하세요');
      return;
    }
    phase1.addCampaignTask(detail.id, {
      team: teamTab,
      label,
      assignee: newAssignee.trim(),
      dueDate: newDueDate || undefined,
    });
    setNewLabel('');
    setNewAssignee('');
    setNewDueDate('');
    toast.success(`${teamTab} 팀 업무가 추가되었습니다`);
    refreshDetail();
  };

  const removeTask = (taskId: string, label: string) => {
    if (!confirm(`「${label}」 업무를 삭제할까요?`)) return;
    phase1.deleteCampaignTask(detail.id, taskId);
    toast.success('업무가 삭제되었습니다');
    refreshDetail();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex flex-wrap items-start gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground">{detail.channel} · {detail.startDate} – {detail.endDate}</p>
              <DialogTitle className="text-lg">{detail.title}</DialogTitle>
            </div>
            <Badge>{STATUS_LABEL[detail.status]}</Badge>
            {detail.discountRate != null && <Badge variant="outline">할인 {detail.discountRate}%</Badge>}
          </div>
          {detail.pushSkus?.length ? (
            <div className="flex flex-wrap gap-1 mt-2">
              {detail.pushSkus.map(s => (
                <Badge key={s} variant="secondary" className="font-mono text-[11px]">{s}</Badge>
              ))}
            </div>
          ) : null}
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="font-semibold">전체 완료율</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {CAMPAIGN_TEAMS.map(team => {
                const pct = phase1.getCampaignTeamProgress(detail, team);
                const cnt = detail.tasks.filter(t => t.team === team).length;
                return (
                  <span key={team} className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--fill-quaternary)] text-muted-foreground">
                    {team} {cnt ? `${pct}%` : '—'}
                  </span>
                );
              })}
            </div>
          </div>

          {detail.status === 'draft' && (
            <div className="bg-muted border border-border rounded-lg p-3 text-sm">
              <p className="text-foreground">미온보딩 상태입니다. 온보딩 후 팀별로 업무를 직접 등록하세요.</p>
              <Button size="sm" className="mt-2" onClick={onboard}>캘린더 온보딩</Button>
            </div>
          )}

          <Tabs value={teamTab} onValueChange={tab => {
            setTeamTab(tab);
            setNewLabel('');
            setNewAssignee('');
            setNewDueDate('');
          }}>
              <TabsList className="flex flex-wrap h-auto gap-1">
                {CAMPAIGN_TEAMS.map(team => {
                  const pct = phase1.getCampaignTeamProgress(detail, team);
                  const cnt = detail.tasks.filter(t => t.team === team).length;
                  return (
                    <TabsTrigger key={team} value={team} className="text-xs">
                      {team} <span className="ml-1 opacity-60">{cnt ? `${pct}%` : '0'}</span>
                    </TabsTrigger>
                  );
                })}
              </TabsList>

              {CAMPAIGN_TEAMS.map(team => {
                const tasksForTeam = phase1.getCampaignTasksByTeam(detail, team);
                return (
                <TabsContent key={team} value={team} className="mt-3 space-y-2">
                  <div className="flex justify-between text-xs text-muted-foreground mb-2">
                    <span>{team} 팀 업무</span>
                    <span>{tasksForTeam.length ? `${phase1.getCampaignTeamProgress(detail, team)}% 완료` : '직접 추가'}</span>
                  </div>

                  {tasksForTeam.length === 0 && (
                    <p className="text-xs text-muted-foreground py-1">등록된 업무가 없습니다. 아래에서 직접 입력해 추가하세요.</p>
                  )}

                  {tasksForTeam.map(task => (
                    <div key={task.id} className={`border rounded-lg p-3 space-y-2 ${task.done ? 'bg-muted opacity-90' : 'bg-card'}`}>
                      <div className="flex items-start gap-2">
                        <button
                          type="button"
                          onClick={() => toggleTask(task.id)}
                          className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center text-[11px] shrink-0 ${
                            task.done ? 'bg-[var(--system-green)] border-[var(--system-green)] text-white' : 'border-border'
                          }`}
                        >
                          {task.done ? <Check className="w-3 h-3" /> : ''}
                        </button>
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <Input
                            className={`h-8 text-sm font-medium ${task.done ? 'line-through text-muted-foreground' : ''}`}
                            value={task.label}
                            onChange={e => patchTask(task.id, { label: e.target.value })}
                            placeholder="업무명"
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-[11px] text-muted-foreground">담당자</label>
                              <Input
                                className="h-8 text-xs"
                                placeholder="담당자 이름"
                                value={task.assignee || ''}
                                onChange={e => patchTask(task.id, { assignee: e.target.value })}
                              />
                            </div>
                            <div>
                              <label className="text-[11px] text-muted-foreground">예상완료일</label>
                              <Input
                                type="date"
                                className="h-8 text-xs"
                                value={task.dueDate || ''}
                                onChange={e => patchTask(task.id, { dueDate: e.target.value })}
                              />
                            </div>
                          </div>
                          <Input
                            className="h-8 text-xs"
                            placeholder="세부내용 입력..."
                            value={task.detail || ''}
                            onChange={e => patchTask(task.id, { detail: e.target.value })}
                          />
                          <TaskMentionsBlock
                            campaignId={detail.id}
                            task={task}
                            onRefresh={refreshDetail}
                          />
                        </div>
                        <div className="flex flex-col gap-1 shrink-0">
                          <select
                            className="text-[11px] border rounded px-1.5 py-1 h-7"
                            value={task.status}
                            onChange={e => setTaskStatus(task.id, e.target.value as CampaignTaskStatus)}
                          >
                            {TASK_STATUS.map(s => (
                              <option key={s.value} value={s.value}>{s.label}</option>
                            ))}
                          </select>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-[var(--system-red)]"
                            onClick={() => removeTask(task.id, task.label)}
                            title="업무 삭제"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* 팀별 업무 직접 추가 */}
                  <div className="border border-dashed border-border rounded-lg p-3 bg-muted space-y-2">
                    <p className="text-xs font-semibold text-foreground">{team} 업무 추가</p>
                    <Input
                      className="h-8 text-sm bg-card"
                      placeholder="업무명 (직접 입력)"
                      value={team === teamTab ? newLabel : ''}
                      onChange={e => setNewLabel(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') addTask(); }}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        className="h-8 text-xs bg-card"
                        placeholder="담당자"
                        value={team === teamTab ? newAssignee : ''}
                        onChange={e => setNewAssignee(e.target.value)}
                      />
                      <Input
                        type="date"
                        className="h-8 text-xs bg-card"
                        value={team === teamTab ? newDueDate : ''}
                        onChange={e => setNewDueDate(e.target.value)}
                        title="예상완료일"
                      />
                    </div>
                    <Button size="sm" variant="secondary" className="w-full h-8" onClick={addTask}>
                      <Plus className="w-3.5 h-3.5 mr-1" />업무 생성
                    </Button>
                  </div>
                </TabsContent>
              );
              })}
            </Tabs>

          <div className="flex flex-wrap gap-2 pt-2 border-t">
            {detail.status === 'draft' && (
              <Button size="sm" onClick={onboard}>캘린더 온보딩</Button>
            )}
            {detail.status === 'onboarded' && (
              <Button size="sm" onClick={() => { phase1.updateCampaign(detail.id, { status: 'active' }); refreshDetail(); }}>진행 시작</Button>
            )}
            {detail.status === 'active' && (
              <Button size="sm" variant="outline" onClick={() => { phase1.updateCampaign(detail.id, { status: 'closed' }); refreshDetail(); }}>마감</Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
