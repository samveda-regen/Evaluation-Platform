import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Bot, Send, Sparkles, Loader2, User } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { superAdminApi, type AssistantChatMessage } from '../../services/superAdminApi';
import { PageHeader } from './components';

interface DisplayMessage extends AssistantChatMessage {
  id: string;
  toolsUsed?: string[];
}

// crypto.randomUUID() only exists in a secure context (HTTPS or localhost) --
// over plain http:// on a bare IP/hostname it's undefined, which would throw
// here and silently kill send() before any message ever renders.
function generateId(): string {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

const SUGGESTED_PROMPTS = [
  'What happened on the platform today?',
  'Is anything unusual in the last 24 hours?',
  'How smooth is the app running right now?',
  'Which admin has been most active this week?',
];

export default function SuperAdminAiAssistant() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMessage: DisplayMessage = { id: generateId(), role: 'user', content: trimmed };
    const history = messages.map(({ role, content }) => ({ role, content }));
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const { data } = await superAdminApi.chatWithAssistant(trimmed, history);
      setMessages((prev) => [
        ...prev,
        { id: generateId(), role: 'assistant', content: data.reply, toolsUsed: data.toolsUsed },
      ]);
    } catch (error: unknown) {
      const message =
        (error as { response?: { data?: { message?: string; error?: string } } })?.response?.data?.message ||
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'The assistant is unavailable right now.';
      toast.error(message);
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-7.5rem)]">
      <PageHeader
        title="AI Assistant"
        description="Ask ReGen anything about admin activity, audit history, or platform health — every answer is backed by a live query, never guessed."
      />

      <div className="flex-1 min-h-0 bg-sa-panel-raised border border-sa-line rounded-xl flex flex-col overflow-hidden relative">
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center gap-5">
              <div className="h-12 w-12 rounded-full bg-sa-accent-soft border border-sa-accent/40 flex items-center justify-center">
                <Sparkles size={20} className="text-sa-accent" />
              </div>
              <div>
                <p className="text-sa-ink text-sm">ReGen Assistant online</p>
                <p className="text-sa-ink-faint text-[12.5px] mt-1 max-w-sm">
                  Read-only. It queries real accounts, logs, and telemetry — it cannot delete, lock, or change anything.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 max-w-lg">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => void send(prompt)}
                    className="text-[11.5px] text-sa-ink-dim border border-sa-line rounded-full px-3 py-1.5 hover:border-sa-accent hover:text-sa-accent transition-all"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={`flex gap-2.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'assistant' && (
                <div className="shrink-0 h-7 w-7 rounded-full bg-sa-accent-soft border border-sa-accent/40 flex items-center justify-center mt-0.5">
                  <Bot size={13} className="text-sa-accent" />
                </div>
              )}
              <div
                className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? 'bg-sa-accent2-soft border border-sa-accent2/30 text-sa-ink'
                    : 'bg-sa-panel-inset border border-sa-line text-sa-ink'
                }`}
              >
                {msg.content}
                {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-sa-line-soft text-[10px] text-sa-ink-faint">
                    queried: {msg.toolsUsed.join(', ')}
                  </div>
                )}
              </div>
              {msg.role === 'user' && (
                <div className="shrink-0 h-7 w-7 rounded-full bg-sa-accent2-soft border border-sa-accent2/40 flex items-center justify-center mt-0.5">
                  <User size={13} className="text-sa-accent2" />
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex gap-2.5 justify-start">
              <div className="shrink-0 h-7 w-7 rounded-full bg-sa-accent-soft border border-sa-accent/40 flex items-center justify-center">
                <Bot size={13} className="text-sa-accent" />
              </div>
              <div className="bg-sa-panel-inset border border-sa-line rounded-2xl px-3.5 py-2.5 flex items-center gap-2 text-sa-ink-faint text-[12.5px]">
                <Loader2 size={13} className="animate-spin" />
                querying live data…
              </div>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="border-t border-sa-line-soft p-3 flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            placeholder="Ask about admin activity, audit history, or platform health…"
            rows={1}
            className="flex-1 resize-none bg-sa-panel-inset border border-sa-line rounded-xl px-3 py-2.5 text-[13px] text-sa-ink outline-none focus:border-sa-accent transition-all max-h-32"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="shrink-0 h-[42px] w-[42px] flex items-center justify-center bg-sa-accent text-white font-semibold rounded-lg hover:brightness-110 active:brightness-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  );
}
