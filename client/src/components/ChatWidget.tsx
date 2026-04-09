// 플로팅 AI 챗봇 위젯 — 이미지 붙여넣기 + 파일 업로드
import { useState, useRef, useEffect, useCallback } from 'react';
import { Bot, X, Send, Loader2, Zap, AlertCircle, Paperclip } from 'lucide-react';

interface PendingImage {
  data: string;
  media_type: string;
  preview: string;
}

interface Message {
  id: string;
  role: 'user' | 'agent';
  text: string;
  imagePreviews?: string[];
  isStreaming?: boolean;
  error?: boolean;
}

const QUICK_PROMPTS = [
  { label: 'BOM 누락 확인', prompt: 'BOM이 없는 품목 목록 알려줘' },
  { label: '미처리 발주', prompt: '자재 미처리 발주 확인해줘' },
  { label: '샘플 현황', prompt: '최근 샘플 목록 보여줘' },
  { label: '생산발주 현황', prompt: '진행 중인 생산발주 보여줘' },
];

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'agent',
      text: '안녕하세요! AMESCOTES ERP AI 어시스턴트입니다.\n이미지 붙여넣기(Ctrl+V)도 가능합니다.',
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  const addImageFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setPendingImages(prev => [...prev, {
        data: dataUrl.split(',')[1],
        media_type: file.type,
        preview: dataUrl,
      }]);
    };
    reader.readAsDataURL(file);
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const imageItems = Array.from(e.clipboardData.items).filter(i => i.type.startsWith('image/'));
    if (imageItems.length === 0) return;
    e.preventDefault();
    imageItems.forEach(item => {
      const file = item.getAsFile();
      if (file) addImageFile(file);
    });
  }, [addImageFile]);

  const sendMessage = useCallback(async (text: string, imagesToSend?: PendingImage[]) => {
    const imgs = imagesToSend ?? pendingImages;
    if (!text.trim() && imgs.length === 0) return;
    if (isLoading) return;

    const agentId = `agent-${Date.now()}`;
    const displayText = text.trim() || '이미지를 분석해주세요.';

    setMessages(prev => [
      ...prev,
      { id: `user-${Date.now()}`, role: 'user', text: displayText, imagePreviews: imgs.map(i => i.preview) },
      { id: agentId, role: 'agent', text: '', isStreaming: true },
    ]);
    setInputText('');
    setPendingImages([]);
    setIsLoading(true);

    try {
      const body: Record<string, unknown> = { prompt: displayText };
      if (imgs.length > 0) body.images = imgs.map(i => ({ data: i.data, media_type: i.media_type }));

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
          try {
            const event = JSON.parse(line.slice(6)) as { type: string; text?: string; message?: string };
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
      inputRef.current?.focus();
    }
  }, [isLoading, pendingImages]);

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
          try {
            const event = JSON.parse(line.slice(6)) as { type: string; text?: string; message?: string };
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
      inputRef.current?.focus();
    }
  }, [isLoading]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type.startsWith('image/')) addImageFile(file);
    else uploadFile(file);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputText);
    }
  };

  return (
    <>
      {/* 플로팅 버튼 */}
      <button
        onClick={() => setOpen(v => !v)}
        className="fixed bottom-24 right-6 z-50 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-transform hover:scale-105 active:scale-95"
        style={{ backgroundColor: '#C9A96E' }}
        aria-label="AI 어시스턴트 열기"
      >
        {open ? <X className="w-6 h-6 text-white" /> : <Bot className="w-6 h-6 text-white" />}
      </button>

      {/* 채팅 창 */}
      {open && (
        <div
          className="fixed bottom-44 right-6 z-50 w-[380px] max-h-[580px] flex flex-col rounded-2xl shadow-2xl border bg-background overflow-hidden"
          style={{ borderColor: '#C9A96E33' }}
        >
          {/* 헤더 */}
          <div className="flex items-center gap-2.5 px-4 py-3 border-b" style={{ backgroundColor: '#C9A96E' }}>
            <Bot className="w-5 h-5 text-white" />
            <div>
              <p className="text-sm font-semibold text-white">AI 어시스턴트</p>
              <p className="text-xs text-white/70">AI 어시스턴트 · claude-haiku-4-5</p>
            </div>
            <button onClick={() => setOpen(false)} className="ml-auto text-white/80 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* 빠른 버튼 */}
          <div className="flex flex-wrap gap-1.5 px-3 py-2 border-b bg-muted/20">
            {QUICK_PROMPTS.map(({ label, prompt }) => (
              <button
                key={label}
                onClick={() => sendMessage(prompt, [])}
                disabled={isLoading}
                className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-full border transition-colors disabled:opacity-50 hover:bg-accent"
                style={{ borderColor: '#C9A96E', color: '#C9A96E' }}
              >
                <Zap className="w-2.5 h-2.5" />
                {label}
              </button>
            ))}
          </div>

          {/* 메시지 영역 */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0" style={{ maxHeight: '360px' }}>
            {messages.map(msg => (
              <div key={msg.id} className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div
                  className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center"
                  style={msg.role === 'agent' ? { backgroundColor: '#C9A96E' } : { backgroundColor: '#e5e7eb' }}
                >
                  {msg.role === 'agent'
                    ? <Bot className="w-4 h-4 text-white" />
                    : <span className="text-xs text-gray-600">나</span>
                  }
                </div>
                <div className={`max-w-[78%] space-y-1.5 flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  {msg.imagePreviews && msg.imagePreviews.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {msg.imagePreviews.map((src, i) => (
                        <img key={i} src={src} alt="첨부" className="max-w-[140px] max-h-[140px] rounded-lg object-cover border" />
                      ))}
                    </div>
                  )}
                  {(msg.text || msg.isStreaming) && (
                    <div className={`px-3 py-2 rounded-xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
                      msg.role === 'user'
                        ? 'bg-muted text-foreground rounded-tr-sm'
                        : msg.error
                        ? 'bg-red-50 text-red-600 border border-red-200 rounded-tl-sm'
                        : 'bg-card border rounded-tl-sm'
                    }`}>
                      {msg.isStreaming && msg.text === '' ? (
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span className="text-xs">처리 중...</span>
                        </div>
                      ) : (
                        <>
                          {msg.error && <AlertCircle className="w-3.5 h-3.5 inline mr-1 text-red-500" />}
                          {msg.text}
                          {msg.isStreaming && <span className="ml-0.5 inline-block w-1 h-3.5 bg-current animate-pulse rounded-sm" />}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* 대기 중 이미지 미리보기 */}
          {pendingImages.length > 0 && (
            <div className="flex gap-2 px-3 py-2 border-t bg-muted/10 flex-wrap">
              {pendingImages.map((img, i) => (
                <div key={i} className="relative group">
                  <img src={img.preview} alt="첨부" className="w-12 h-12 rounded-lg object-cover border" />
                  <button
                    onClick={() => setPendingImages(prev => prev.filter((_, idx) => idx !== i))}
                    className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-[10px]"
                  >×</button>
                </div>
              ))}
            </div>
          )}

          {/* 입력창 */}
          <div className="px-3 py-2.5 border-t">
            <div className="flex items-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv,image/*"
                className="hidden"
                onChange={handleFileChange}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading}
                className="flex-shrink-0 w-9 h-9 rounded-lg border flex items-center justify-center disabled:opacity-50 transition-colors hover:bg-accent"
                style={{ color: '#C9A96E', borderColor: '#C9A96E55' }}
                title="이미지 또는 파일 첨부"
              >
                <Paperclip className="w-4 h-4" />
              </button>
              <textarea
                ref={inputRef}
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={pendingImages.length > 0 ? '질문 입력 또는 Enter로 분석...' : '질문 입력 또는 이미지 Ctrl+V...'}
                className="flex-1 resize-none rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 min-h-[38px] max-h-24"
                style={{ '--tw-ring-color': '#C9A96E' } as React.CSSProperties}
                disabled={isLoading}
                rows={1}
              />
              <button
                onClick={() => sendMessage(inputText)}
                disabled={isLoading || (!inputText.trim() && pendingImages.length === 0)}
                className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-white disabled:opacity-50 transition-opacity"
                style={{ backgroundColor: '#C9A96E' }}
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
