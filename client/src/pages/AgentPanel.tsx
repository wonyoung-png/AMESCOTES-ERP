// AI 에이전트 패널 — AMESCOTES ERP 챗 인터페이스
import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Bot, Send, User, AlertCircle, Loader2, Zap } from 'lucide-react';

// ─── 메시지 타입 ───
interface Message {
  id: string;
  role: 'user' | 'agent';
  text: string;
  isStreaming?: boolean;
  error?: boolean;
}

// ─── 빠른 입력 버튼 목록 ───
const QUICK_PROMPTS = [
  { label: 'BOM 누락 확인', prompt: 'BOM이 등록되지 않은 품목 목록을 확인해줘' },
  { label: '미처리 발주 확인', prompt: '자재 미처리 발주를 확인해줘' },
  { label: '샘플 현황', prompt: '최근 샘플 목록을 보여줘' },
  { label: '생산발주 현황', prompt: '현재 진행 중인 생산발주를 보여줘' },
  { label: '거래처 목록', prompt: '거래처 목록을 조회해줘' },
  { label: '자재 재고', prompt: '자재 재고 현황을 알려줘' },
];

export default function AgentPanel() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'agent',
      text: '안녕하세요! AMESCOTES ERP AI 어시스턴트입니다.\n\n아래 빠른 버튼을 클릭하거나 직접 질문을 입력해주세요.\n\n• BOM 누락 및 미처리 발주 감지\n• 샘플/발주 현황 조회\n• 샘플·생산발주 신규 등록\n• 원가·실적 보고서 생성',
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 새 메시지 추가 시 스크롤 아래로
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMessageId = `user-${Date.now()}`;
    const agentMessageId = `agent-${Date.now()}`;

    // 사용자 메시지 추가
    setMessages(prev => [
      ...prev,
      { id: userMessageId, role: 'user', text: text.trim() },
      { id: agentMessageId, role: 'agent', text: '', isStreaming: true },
    ]);
    setInputText('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text.trim() }),
      });

      if (!response.ok) {
        throw new Error(`서버 오류: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) throw new Error('응답 스트림을 읽을 수 없습니다.');

      let buffer = '';
      let agentText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          try {
            const event = JSON.parse(raw) as { type: string; text?: string; message?: string };
            if (event.type === 'text' && event.text) {
              agentText = event.text;
              setMessages(prev =>
                prev.map(m =>
                  m.id === agentMessageId
                    ? { ...m, text: agentText, isStreaming: true }
                    : m
                )
              );
            } else if (event.type === 'done') {
              setMessages(prev =>
                prev.map(m =>
                  m.id === agentMessageId
                    ? { ...m, text: agentText || '처리가 완료되었습니다.', isStreaming: false }
                    : m
                )
              );
            } else if (event.type === 'error') {
              setMessages(prev =>
                prev.map(m =>
                  m.id === agentMessageId
                    ? { ...m, text: `오류: ${event.message ?? '알 수 없는 오류'}`, isStreaming: false, error: true }
                    : m
                )
              );
            }
          } catch {
            // JSON 파싱 오류 무시
          }
        }
      }
    } catch (err) {
      setMessages(prev =>
        prev.map(m =>
          m.id === agentMessageId
            ? { ...m, text: `연결 오류: ${String(err)}`, isStreaming: false, error: true }
            : m
        )
      );
    } finally {
      setIsLoading(false);
      textareaRef.current?.focus();
    }
  }, [isLoading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(inputText);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputText);
    }
  };

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-4rem)] bg-background">
      {/* 헤더 */}
      <div className="flex items-center gap-3 px-6 py-4 border-b">
        <div
          className="flex items-center justify-center w-9 h-9 rounded-full"
          style={{ backgroundColor: '#C9A96E' }}
        >
          <Bot className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-lg font-semibold" style={{ color: '#1C1C1E' }}>
            AI 어시스턴트
          </h1>
          <p className="text-xs text-muted-foreground">에이전트 팀 · claude-opus-4-6</p>
        </div>
      </div>

      {/* 빠른 입력 버튼 */}
      <div className="flex flex-wrap gap-2 px-6 py-3 border-b bg-muted/30">
        {QUICK_PROMPTS.map(({ label, prompt }) => (
          <button
            key={label}
            onClick={() => sendMessage(prompt)}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border transition-colors disabled:opacity-50 hover:bg-accent"
            style={{ borderColor: '#C9A96E', color: '#C9A96E' }}
          >
            <Zap className="w-3 h-3" />
            {label}
          </button>
        ))}
      </div>

      {/* 메시지 영역 */}
      <ScrollArea className="flex-1 px-6 py-4" ref={scrollRef}>
        <div className="space-y-6 max-w-4xl mx-auto">
          {messages.map(message => (
            <div
              key={message.id}
              className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
            >
              {/* 아바타 */}
              <div
                className={`flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full ${
                  message.role === 'user' ? 'bg-muted' : ''
                }`}
                style={message.role === 'agent' ? { backgroundColor: '#C9A96E' } : {}}
              >
                {message.role === 'user' ? (
                  <User className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <Bot className="w-4 h-4 text-white" />
                )}
              </div>

              {/* 말풍선 */}
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                  message.role === 'user'
                    ? 'bg-muted text-foreground rounded-tr-sm'
                    : message.error
                    ? 'bg-destructive/10 text-destructive rounded-tl-sm'
                    : 'bg-card border rounded-tl-sm'
                }`}
              >
                {message.isStreaming && message.text === '' ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>에이전트가 처리 중입니다...</span>
                  </div>
                ) : (
                  <>
                    {message.error && (
                      <AlertCircle className="w-4 h-4 inline mr-1.5 text-destructive" />
                    )}
                    {message.text}
                    {message.isStreaming && (
                      <span className="ml-1 inline-block w-1.5 h-4 bg-current animate-pulse rounded-sm" />
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* 입력 영역 */}
      <div className="px-6 py-4 border-t">
        <form onSubmit={handleSubmit} className="flex items-end gap-3 max-w-4xl mx-auto">
          <Textarea
            ref={textareaRef}
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="질문을 입력하세요... (Enter: 전송, Shift+Enter: 줄바꿈)"
            className="flex-1 min-h-[44px] max-h-32 resize-none"
            disabled={isLoading}
            rows={1}
          />
          <Button
            type="submit"
            disabled={isLoading || !inputText.trim()}
            className="h-11 px-4 text-white"
            style={{ backgroundColor: '#C9A96E' }}
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </form>
        <p className="text-xs text-muted-foreground text-center mt-2">
          ANTHROPIC_API_KEY 및 SUPABASE 환경변수 설정 필요
        </p>
      </div>
    </div>
  );
}
