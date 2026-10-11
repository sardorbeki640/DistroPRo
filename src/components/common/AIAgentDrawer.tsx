import React, { useState, useRef, useEffect } from 'react';
import { 
  Sparkles, 
  X, 
  Send, 
  Bot, 
  User, 
  CheckCircle2, 
  AlertTriangle, 
  TrendingUp, 
  DollarSign, 
  Phone, 
  RefreshCw, 
  Minimize2, 
  Maximize2 
} from 'lucide-react';
import { api } from '../../services/api.ts';
import { AIAgentChatMessage } from '../../types.ts';

interface AIAgentDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateToForecast?: () => void;
}

export const AIAgentDrawer: React.FC<AIAgentDrawerProps> = ({ isOpen, onClose, onNavigateToForecast }) => {
  const [messages, setMessages] = useState<AIAgentChatMessage[]>([
    {
      id: 'msg-welcome',
      role: 'assistant',
      content: `Assalomu alaykum! Men sizning **Distro Finance AI Maslahatchisi**man.\n\nMen korxonangizning barcha integratsiyalangan ombor qoldiqlari, kunlik savdo, rasxodlar, sof foyda va nasiyalarini real vaqt rejimida nazorat qilib boraman.\n\nMenga istalgan savolingizni bering yoki pastdagi tezkor tahlillardan birini tanlang.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [input, setInput] = useState<string>('');
  const [isTyping, setIsTyping] = useState<boolean>(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen]);

  const handleSend = async (textToSend?: string) => {
    const text = textToSend || input;
    if (!text.trim() || isTyping) return;

    const userMsg: AIAgentChatMessage = {
      id: `usr-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    try {
      const history = messages.map(m => ({ role: m.role, text: m.content }));
      const res = await api.chatWithAIAgent(text, history);

      const aiMsg: AIAgentChatMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: (res.ai_note ? `⚠️ ${res.ai_note}\n\n` : '') + (res.reply || 'Tahlil yakunlandi.'),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        actionTriggered: res.actionTriggered,
        actionResult: res.actionResult
      };

      setMessages(prev => [...prev, aiMsg]);
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        {
          id: `ai-err-${Date.now()}`,
          role: 'assistant',
          content: `Kechirasiz, ma'lumotlarni tahlil qilishda xatolik yuz berdi: ${err.message || 'Tarmoq xatosi'}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  if (!isOpen) return null;

  const quickPrompts = [
    { label: '🚨 Tugagan tovarlar & boy berilgan foyda', prompt: 'Qaysi mahsulotlar tugagan va qancha foydadan qolib ketyapmiz?' },
    { label: '⏳ Qoldiqlar necha kunga yetadi?', prompt: 'Ombordagi tovarlar hozirgi savdodan kelib chiqib necha kunga yetadi?' },
    { label: '💰 Kunlik savdo va sof foyda', prompt: 'Bugungi kunlik savdo, rasxodlar va sof foyda qancha bo\'ldi?' },
    { label: '👤 Agentlar reytingi', prompt: 'Qaysi agent eng ko‘p sotdi va kim orqada qolyapti?' },
    { label: '👥 Nasiyalar nazorati', prompt: 'Nasiyalar holati qanday, kimlar limitdan oshgan?' }
  ];

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-white shadow-2xl border-l border-neutral-200 transition-all duration-300">
      {/* Header */}
      <div className="flex h-16 items-center justify-between px-5 border-b border-neutral-100 bg-neutral-900 text-white">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl shadow-xs text-white">
            <Sparkles className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="text-sm font-bold tracking-tight">Distro AI Maslahatchisi</h3>
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
            </div>
            <p className="text-[11px] text-neutral-400 font-mono">Claude AI (Jarvis → Sozlamalar’dagi kalit bilan)</p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-neutral-50/50">
        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          return (
            <div
              key={msg.id}
              className={`flex items-start gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
            >
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-bold ${
                  isUser ? 'bg-indigo-600 text-white' : 'bg-neutral-900 text-emerald-400'
                }`}
              >
                {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>

              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-relaxed shadow-2xs whitespace-pre-line ${
                  isUser
                    ? 'bg-indigo-600 text-white rounded-tr-none'
                    : 'bg-white border border-neutral-200 text-neutral-800 rounded-tl-none font-medium'
                }`}
              >
                {msg.content}

                {/* If an action was executed */}
                {msg.actionResult && (
                  <div className="mt-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 font-normal">
                    <div className="flex items-center space-x-1.5 font-bold text-emerald-800 mb-1">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>{msg.actionResult.message || 'Amal muvaffaqiyatli bajarildi!'}</span>
                    </div>
                    {msg.actionResult.recipient && (
                      <p className="text-[11px] text-emerald-800">
                        Yuborilgan raqam: <strong>{msg.actionResult.recipient}</strong>
                      </p>
                    )}
                  </div>
                )}

                <div
                  className={`mt-1.5 text-[10px] text-right font-mono ${
                    isUser ? 'text-indigo-200' : 'text-neutral-400'
                  }`}
                >
                  {msg.timestamp}
                </div>
              </div>
            </div>
          );
        })}

        {isTyping && (
          <div className="flex items-start gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-emerald-400 text-xs">
              <Bot className="w-4 h-4" />
            </div>
            <div className="rounded-2xl rounded-tl-none bg-white border border-neutral-200 px-4 py-3 shadow-2xs flex items-center space-x-1.5">
              <span className="w-2 h-2 rounded-full bg-indigo-500 animate-bounce"></span>
              <span className="w-2 h-2 rounded-full bg-indigo-500 animate-bounce [animation-delay:0.2s]"></span>
              <span className="w-2 h-2 rounded-full bg-indigo-500 animate-bounce [animation-delay:0.4s]"></span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick Prompts Chips */}
      <div className="p-3 bg-white border-t border-neutral-100 overflow-x-auto">
        <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider mb-2">
          Tezkor Tahlil So'rovlari:
        </p>
        <div className="flex flex-wrap gap-1.5">
          {quickPrompts.map((qp, idx) => (
            <button
              key={idx}
              onClick={() => handleSend(qp.prompt)}
              disabled={isTyping}
              className="text-[11px] font-medium px-2.5 py-1.5 rounded-lg bg-neutral-100 hover:bg-indigo-50 hover:text-indigo-700 text-neutral-700 transition cursor-pointer border border-neutral-200 shrink-0"
            >
              {qp.label}
            </button>
          ))}
        </div>
      </div>

      {/* Input area */}
      <div className="p-3 border-t border-neutral-200 bg-white">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex items-center space-x-2"
        >
          <input
            type="text"
            placeholder="AI maslahatchiga savol bering..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isTyping}
            className="flex-1 px-3.5 py-2.5 text-xs bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-indigo-600 focus:bg-white transition"
          />
          <button
            type="submit"
            disabled={!input.trim() || isTyping}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition shadow-xs cursor-pointer shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
