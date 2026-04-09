// AI 에이전트 패널 — 이미지 붙여넣기 + 파일 업로드 + ERP 조회
import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Bot, Send, User, AlertCircle, Loader2, Zap, Paperclip, X, Image } from 'lucide-react';

interface PendingImage {
  data: string;       // base64 (no prefix)
  media_type: string;
  preview: string;    // data URL for display
}

interface Message {
  id: string;
  role: 'user' | 'agent';
  text: string;
  imagePreviews?: string[]; // data URLs
  isStreaming?: boolean;
  error?: boolean;
}

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
      text: '안녕하세요! AMESCOTES ERP AI 어시스턴트입니다.\n\n아래 빠른 버튼을 클릭하거나 질문을 입력하세요.\n이미지를 붙여넣기(Ctrl+V)하면 분석도 가능합니다.\n\n• BOM 누락 및 미처리 발주 감지\n• 샘플/발주 현황 조회\n• 샘플·생산발주 신규 등록\n• 이미지 분석 (사진, 캡처 등)',
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // 이미지 파일 → PendingImage 변환
  const addImageFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      setPendingImages(prev => [...prev, { data: base64, media_type: file.type, preview: dataUrl }]);
    };
    reader.readAsDataURL(file);
  }, []);

  // 붙여넣기 핸들러 — 이미지 감지
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter(item => item.type.startsWith('image/'));
    if (imageItems.length === 0) return;
    e.preventDefault();
    imageItems.forEach(item => {
      const file = item.getAsFile();
      if (file) addImageFile(file);
    });
  }, [addImageFile]);

  // 메시지 전송 (텍스트 + 선택된 이미지)
  const sendMessage = useCallback(async (text: string, imagesToSend?: PendingImage[]) => {
    const imgs = imagesToSend ?? pendingImages;
    if (!text.trim() && imgs.length === 0) return;
    if (isLoading) return;

    const agentId = `agent-${Date.now()}`;
    const displayText = text.trim() || (imgs.length > 0 ? '이미지를 분석해주세요.' : '');

    setMessages(prev => [
      ...prev,
      {
        id: `user-${Date.now()}`,
        role: 'user',
        text: displayText,
        imagePreviews: imgs.map(i => i.preview),
      },
      { id: agentId, role: 'agent', text: '', isStreaming: true },
    ]);
    setInputText('');
    setPendingImages([]);
    setIsLoading(true);

    try {
      const body: Record<string, unknown> = {
        prompt: displayText,
      };
      if (imgs.length > 0) {
        body.images = imgs.map(i => ({ data: i.data, media_type: i.media_type }));
      }

      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) throw new Error(`서버 오류: ${response.status}`);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('스트림 오류');

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
              setMessages(prev => prev.map(m =>
                m.id === agentId ? { ...m, text: agentText, isStreaming: true } : m
              ));
            } else if (event.type === 'done') {
              setMessages(prev => prev.map(m =>
                m.id === agentId ? { ...m, text: agentText || '완료됐습니다.', isStreaming: false } : m
              ));
            } else if (event.type === 'error') {
              setMessages(prev => prev.map(m =>
                m.id === agentId ? { ...m, text: `오류: ${event.message}`, isStreaming: false, error: true } : m
              ));
            }
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      setMessages(prev => prev.map(m =>
        m.id === agentId
          ? { ...m, text: `연결 오류: ${String(err)}`, isStreaming: false, error: true }
          : m
      ));
    } finally {
      setIsLoading(false);
      textareaRef.current?.focus();
    }
  }, [isLoading, pendingImages]);

  // 엑셀/CSV 파일 업로드
  const uploadFile = useCallback(async (file: File) => {
    if (isLoading) return;
    const agentId = `agent-${Date.now()}`;
    setMessages(prev => [
      ...prev,
      { id: `user-${Date.now()}`, role: 'user', text: `파일 업로드: ${file.name}` },
      { id: agentId, role: 'agent', text: '', isStreaming: true },
    ]);
    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mode', 'auto');

      const response = await fetch('/api/agent/upload', { method: 'POST', body: formData });
      if (!response.ok) throw new Error(`서버 오류: ${response.status}`);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('스트림 오류');

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
              setMessages(prev => prev.map(m => m.id === agentId ? { ...m, text: agentText, isStreaming: true } : m));
            } else if (event.type === 'done') {
              setMessages(prev => prev.map(m => m.id === agentId ? { ...m, text: agentText || '완료됐습니다.', isStreaming: false } : m));
            } else if (event.type === 'error') {
              setMessages(prev => prev.map(m => m.id === agentId ? { ...m, text: `오류: ${event.message}`, isStreaming: false, error: true } : m));
            }
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      setMessages(prev => prev.map(m =>
        m.id === agentId ? { ...m, text: `연결 오류: ${String(err)}`, isStreaming: false, error: true } : m
      ));
    } finally {
      setIsLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      textareaRef.current?.focus();
    }
  }, [isLoading]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type.startsWith('image/')) {
      addImageFile(file);
    } else {
      uploadFile(file);
    }
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
        <div className="flex items-center justify-center w-9 h-9 rounded-full" style={{ backgroundColor: '#C9A96E' }}>
          <Bot className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-lg font-semibold" style={{ color: '#1C1C1E' }}>AI 어시스턴트</h1>
          <p className="text-xs text-muted-foreground">AI 어시스턴트 · claude-haiku-4-5</p>
        </div>
      </div>

      {/* 빠른 입력 버튼 */}
      <div className="flex flex-wrap gap-2 px-6 py-3 border-b bg-muted/30">
        {QUICK_PROMPTS.map(({ label, prompt }) => (
          <button
            key={label}
            onClick={() => sendMessage(prompt, [])}
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
            <div key={message.id} className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              <div
                className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full"
                style={message.role === 'agent' ? { backgroundColor: '#C9A96E' } : { backgroundColor: '#e5e7eb' }}
              >
                {message.role === 'user'
                  ? <User className="w-4 h-4 text-muted-foreground" />
                  : <Bot className="w-4 h-4 text-white" />
                }
              </div>
              <div className={`max-w-[75%] space-y-2 ${message.role === 'user' ? 'items-end' : 'items-start'} flex flex-col`}>
                {/* 이미지 미리보기 */}
                {message.imagePreviews && message.imagePreviews.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {message.imagePreviews.map((src, i) => (
                      <img
                        key={i}
                        src={src}
                        alt="첨부 이미지"
                        className="max-w-[200px] max-h-[200px] rounded-xl object-cover border"
                      />
                    ))}
                  </div>
                )}
                {/* 텍스트 말풍선 */}
                {(message.text || message.isStreaming) && (
                  <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                    message.role === 'user'
                      ? 'bg-muted text-foreground rounded-tr-sm'
                      : message.error
                      ? 'bg-destructive/10 text-destructive rounded-tl-sm'
                      : 'bg-card border rounded-tl-sm'
                  }`}>
                    {message.isStreaming && message.text === '' ? (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>에이전트가 처리 중입니다...</span>
                      </div>
                    ) : (
                      <>
                        {message.error && <AlertCircle className="w-4 h-4 inline mr-1.5 text-destructive" />}
                        {message.text}
                        {message.isStreaming && (
                          <span className="ml-1 inline-block w-1.5 h-4 bg-current animate-pulse rounded-sm" />
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* 입력 영역 */}
      <div className="px-6 py-4 border-t">
        {/* 대기 중인 이미지 미리보기 */}
        {pendingImages.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {pendingImages.map((img, i) => (
              <div key={i} className="relative group">
                <img src={img.preview} alt="첨부" className="w-16 h-16 rounded-lg object-cover border" />
                <button
                  onClick={() => setPendingImages(prev => prev.filter((_, idx) => idx !== i))}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-3 max-w-4xl mx-auto">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv,image/*"
            className="hidden"
            onChange={handleFileChange}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            className="h-11 px-3 flex-shrink-0"
            style={{ color: '#C9A96E', borderColor: '#C9A96E55' }}
            title="이미지 또는 Excel/CSV 파일 첨부"
          >
            <Paperclip className="w-4 h-4" />
          </Button>

          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={pendingImages.length > 0 ? '이미지에 대해 질문하거나 Enter로 바로 분석...' : '질문을 입력하거나 이미지를 붙여넣기(Ctrl+V)...'}
              className="w-full min-h-[44px] max-h-32 resize-none rounded-lg border px-3 py-2.5 text-sm focus:outline-none focus:ring-1"
              style={{ '--tw-ring-color': '#C9A96E' } as React.CSSProperties}
              disabled={isLoading}
              rows={1}
            />
            {pendingImages.length > 0 && (
              <div className="absolute right-2 top-2 flex items-center gap-1 text-xs text-muted-foreground">
                <Image className="w-3 h-3" style={{ color: '#C9A96E' }} />
                <span style={{ color: '#C9A96E' }}>{pendingImages.length}</span>
              </div>
            )}
          </div>

          <Button
            type="button"
            onClick={() => sendMessage(inputText)}
            disabled={isLoading || (!inputText.trim() && pendingImages.length === 0)}
            className="h-11 px-4 text-white flex-shrink-0"
            style={{ backgroundColor: '#C9A96E' }}
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
