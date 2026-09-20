import { useEffect, useRef, useState } from 'react';

type State = 'Idle' | 'Listening...' | 'Processing...' | 'Speaking...';
interface Product { id: string; name: string; price: number; brand: string; color?: string | null }
interface Latency { sttMs: number; llmMs: number; toolMs: number; ttsMs: number; totalMs: number }
interface Msg { role: 'user' | 'assistant'; text: string; latency?: Latency; intent?: string }

const API = '';

export function App() {
  const [convId, setConvId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([{ role: 'assistant', text: "Hi! I'm your shopping assistant. What are you looking for today?" }]);
  const [products, setProducts] = useState<Product[]>([]);
  const [state, setState] = useState<State>('Idle');
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [merchantId, setMerchantId] = useState('default');
  const recogRef = useRef<any>(null);
  const listenStart = useRef(0);

  useEffect(() => {
    fetch(`${API}/api/voice/respond`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Hi' }) })
      .then(r => r.json()).then(d => setConvId(d.conversationId)).catch(() => setError('Backend not reachable. Run server on :3001.'));
  }, []);

  function speak(text: string) {
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      setState('Speaking...');
      const u = new SpeechSynthesisUtterance(text);
      u.onend = () => setState('Idle');
      synth.cancel();
      synth.speak(u);
    } catch { setState('Idle'); }
  }

  async function send(text: string, sttMs = 0) {
    if (!text.trim()) return;
    setError('');
    setMsgs(m => [...m, { role: 'user', text }]);
    setInput('');
    setState('Processing...');
    try {
      const r = await fetch(`${API}/api/voice/respond`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, ...(convId ? { conversationId: convId } : {}), sttLatencyMs: sttMs, merchantId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Request failed');
      if (!convId) setConvId(d.conversationId);
      const latency: Latency = { ...d.latency, sttMs: d.latency.sttMs || sttMs };
      setMsgs(m => [...m, { role: 'assistant', text: d.reply, latency, intent: d.intent }]);
      setProducts(d.products ?? []);
      speak(d.voiceText ?? d.reply);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setState('Idle');
    }
  }

  function toggleMic() {
    const w = window as unknown as Record<string, any>;
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) { setError('Mic STT not supported in this browser — type instead.'); return; }
    if (state === 'Listening...') {
      try { (recogRef.current as any)?.stop?.(); } catch { /* ignore */ }
      return;
    }
    const rec = new SR();
    recogRef.current = rec;
    rec.lang = merchantId === 'demo_hinglish' ? 'hi-IN' : 'en-IN';
    setState('Listening...');
    listenStart.current = performance.now();
    rec.onresult = (e: any) => {
      const transcript = e.results[0][0].transcript as string;
      const sttMs = Math.round(performance.now() - listenStart.current);
      setState('Processing...');
      void send(transcript, sttMs);
    };
    rec.onend = () => setState('Idle');
    rec.onerror = () => setState('Idle');
    try { rec.start(); } catch { setState('Idle'); }
  }

  return (
    <div className="wrap">
      <h2>Voice Commerce AI</h2>
      <div className="row">
        <label className="state" htmlFor="merchant">Merchant:</label>
        <select id="merchant" value={merchantId} onChange={e => { setMerchantId(e.target.value); setConvId(null); setMsgs([{ role: 'assistant', text: e.target.value === 'demo_hinglish' ? 'Namaste! Main aapka shopping assistant hoon. Aap kya dhoondh rahe hain?' : "Hi! I'm your shopping assistant. What are you looking for today?" }]); setProducts([]); }}>
          <option value="default">English store</option>
          <option value="demo_hinglish">Hinglish store</option>
        </select>
      </div>
      <div className="state">{state}{convId ? '' : ' (connecting...)'}</div>
      {msgs.map((m, i) => (
        <div key={i} className="card"><b>{m.role === 'user' ? '👤' : '🤖'}</b> {m.text}
          {m.latency && (
            <div className="latency">stt {m.latency.sttMs}ms · llm {m.latency.llmMs}ms · tool {m.latency.toolMs}ms · tts {m.latency.ttsMs}ms · total {m.latency.totalMs}ms{m.intent ? ` · ${m.intent}` : ''}</div>
          )}
        </div>
      ))}
      {products.length > 0 && (
        <div className="card"><b>Products</b><div className="products">
          {products.map(p => (
            <div key={p.id} className="prod"><b>{p.name}</b> — ₹{p.price.toLocaleString('en-IN')} <span>({p.brand}{p.color ? `, ${p.color}` : ''})</span></div>
          ))}
        </div></div>
      )}
      {error && <div className="card">⚠️ {error}</div>}
      <div className="card row">
        <button className={`mic ${state === 'Listening...' ? 'listening' : ''}`} onClick={toggleMic} aria-label="speak">🎙️</button>
        <input type="text" placeholder="Type or speak… e.g. Show me running shoes under 3000" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void send(input); }} />
        <button className="send" onClick={() => void send(input)}>Send</button>
      </div>
      <div className="state">Press mic to speak{merchantId === 'demo_hinglish' ? ' (Hinglish supported)' : ' in English'}.</div>
    </div>
  );
}
