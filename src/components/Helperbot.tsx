import * as React from 'react';
import { useState, useRef, useEffect } from 'react';
import { Rfp } from '../../types';
import botIcon from '../assets/chatbot1.png';
import { aiApi } from '../services/api';

interface Message {
  sender: 'user' | 'bot';
  text: string;
  timestamp: Date;
}

interface HelperBotProps {
  currentRfp?: Rfp | null; // The bot sees what you see
}

export const HelperBot: React.FC<HelperBotProps> = ({ currentRfp }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { sender: 'bot', text: 'TenderFlow Copilot online. I have access to the active RFP. How can I assist with compliance or strategy?', timestamp: new Date() }
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // --- Drag and Drop State ---
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const hasDraggedRef = useRef(false);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMsg: Message = { sender: 'user', text: input, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    try {
      // Send History + Current RFP Context to Backend
      const data = await aiApi.copilot(
        userMsg.text,
        currentRfp ? {
          id: currentRfp.id,
          org: currentRfp.organisation,
          parsedData: currentRfp.agentOutputs?.parsedData,
          financials: currentRfp.agentOutputs?.pricing
        } : null,
        messages.slice(1).map(m => ({ role: m.sender, content: m.text }))
      );
      
      const botMsg: Message = { 
        sender: 'bot', 
        text: data.reply || "I'm having trouble connecting to the neural core.", 
        timestamp: new Date() 
      };
      setMessages(prev => [...prev, botMsg]);
    } catch (err) {
      setMessages(prev => [...prev, { sender: 'bot', text: "Connection interrupted.", timestamp: new Date() }]);
    } finally {
      setIsTyping(false);
    }
  };

  // --- Dragging Logic Handlers ---
  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    isDraggingRef.current = true;
    hasDraggedRef.current = false;
    dragStartRef.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!isDraggingRef.current) return;
    
    // Determine if it was an intentional drag vs a slight jiggle during click
    const deltaX = Math.abs(e.clientX - dragStartRef.current.x - pos.x);
    const deltaY = Math.abs(e.clientY - dragStartRef.current.y - pos.y);
    if (deltaX > 3 || deltaY > 3) {
      hasDraggedRef.current = true;
    }
    
    setPos({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    isDraggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const toggleOpen = () => {
    if (hasDraggedRef.current) {
      hasDraggedRef.current = false; // Reset if it was a drag, don't toggle chat window
      return; 
    }
    setIsOpen(!isOpen);
  };

  return (
    <div 
      className={`fixed bottom-8 right-8 z-[200] flex flex-col items-end ${isOpen ? 'w-[400px]' : 'w-auto'}`}
      style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
    >
      
      {/* CHAT WINDOW */}
      {isOpen && (
        <div className="w-full h-[500px] bg-slate-900/90 backdrop-blur-xl border border-slate-700 rounded-3xl shadow-2xl mb-4 flex flex-col overflow-hidden animate-in slide-in-from-bottom-10 fade-in duration-300">
          {/* Header */}
          <div className="p-4 border-b border-slate-800 bg-slate-950/50 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <div>
                <h3 className="text-sm font-black text-white uppercase italic">Copilot <span className="text-gold-500">Live</span></h3>
                <p className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">
                  {currentRfp ? `Context: ${currentRfp.organisation.substring(0, 15)}...` : 'Idle Mode'}
                </p>
              </div>
            </div>
            <button onClick={() => setIsOpen(false)} className="text-slate-500 hover:text-white transition-colors">✕</button>
          </div>

          {/* Messages Area */}
          <div className="flex-grow overflow-y-auto p-4 space-y-4 scrollbar-hide">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] p-3 rounded-2xl text-xs leading-relaxed ${
                  m.sender === 'user' 
                    ? 'bg-amber-500 text-black rounded-br-none font-bold border border-amber-400' 
                    : 'bg-slate-800 text-slate-300 rounded-bl-none border border-slate-700'
                }`}>
                  {m.text}
                </div>
              </div>
            ))}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] p-3 rounded-2xl text-xs leading-relaxed ${
                  m.sender === 'user' 
                    ? 'bg-gold-500 text-slate-950 rounded-br-none font-bold shadow-[0_0_15px_rgba(212,175,55,0.2)]' 
                    : 'bg-slate-800 text-slate-300 rounded-bl-none border border-slate-700'
                }`}>
                  {m.text}
                </div>
              </div>
            ))}
            {isTyping && (
              <div className="flex justify-start">
                <div className="bg-slate-800 p-3 rounded-2xl rounded-bl-none border border-slate-700">
                  <span className="flex gap-1">
                    <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" />
                    <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce delay-100" />
                    <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce delay-200" />
                  </span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="p-4 bg-slate-950/50 border-t border-slate-800">
            <div className="flex gap-2">
              <input 
                type="text" 
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder="Ask about this RFP..." 
                className="flex-grow bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-xs text-white focus:border-gold-500 outline-none transition-all"
              />
              <button 
                onClick={handleSend}
                className="bg-gold-500 text-slate-950 p-2.5 rounded-xl hover:bg-white transition-all shadow-lg shadow-gold-500/20"
              >
                <svg className="w-4 h-4" fill="white" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FLOATING TOGGLE BUTTON (Draggable) */}
      <button 
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onClick={toggleOpen}
        className="w-14 h-14 shrink-0 bg-gradient-to-br from-slate-800 to-slate-950 border border-gold-500/30 rounded-full shadow-[0_0_30px_rgba(212,175,55,0.15)] flex items-center justify-center group hover:scale-110 hover:border-gold-500 touch-none cursor-grab active:cursor-grabbing transition-all duration-300"
        style={{ transitionProperty: 'background-color, border-color, box-shadow, transform' }}
      >
        {isOpen ? (
          <span className="text-xl font-bold text-white pointer-events-none">✕</span>
        ) : (
          <div className="relative w-full h-full flex items-center justify-center pointer-events-none">
            <img src={botIcon} alt="Chatbot Icon" className="w-10 h-10 object-contain" />
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full border-2 border-slate-950 animate-ping" />
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full border-2 border-slate-950" />
          </div>
        )}
      </button>
    </div>
  );
};