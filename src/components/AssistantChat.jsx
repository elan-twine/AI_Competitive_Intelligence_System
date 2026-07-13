import { useState, useRef, useEffect, useCallback } from 'react'
import { Sparkles, X, ArrowUp } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { buildAssistantContext } from '../lib/assistantContext'
import { askAssistant } from '../lib/assistant'
import './assistantChat.css'

// Markdown renderers: open links in a new tab (safely), and never render raw HTML
// (react-markdown's default — LLM output is untrusted).
const MD_COMPONENTS = {
  a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
}

// Floating "ask about this data" assistant. Lives on the dashboard; answers both
// specific questions ("why did Orchid spike?") and navigational ones ("where do
// I see AI visibility?") from the data already in memory + the app map baked into
// the Worker system prompt. Data-bearing props come from the Dashboard.
const SUGGESTIONS = [
  'Why did the top mover change this week?',
  'Who gained the most share recently, and why?',
  'Where do I see AI visibility?',
  'Report a data or weighting error',
]

export function AssistantChat({ allPosts = [], ranked = [], competitors = [], config = {}, platform = 'All', windowLabel = 'current' }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([]) // { role:'user'|'assistant'|'error', content }
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)
  const scrollRef = useRef(null)

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus()
  }, [open])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, busy])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const send = useCallback(async (text) => {
    const question = String(text ?? input).trim()
    if (!question || busy) return
    setInput('')
    const history = messages.filter(m => m.role !== 'error').map(m => ({ role: m.role, content: m.content }))
    // Add the question + an empty assistant bubble the stream fills in place.
    setMessages(m => [...m, { role: 'user', content: question }, { role: 'assistant', content: '' }])
    setBusy(true)
    try {
      const context = buildAssistantContext({ allPosts, ranked, competitors, config, filters: { platform, window: windowLabel } })
      await askAssistant({
        question, context, history,
        onToken: (_chunk, full) => setMessages(m => {
          const c = [...m]
          for (let i = c.length - 1; i >= 0; i--) { if (c[i].role === 'assistant') { c[i] = { ...c[i], content: full }; break } }
          return c
        }),
      })
      // Nothing streamed back → show a fallback in the placeholder bubble.
      setMessages(m => {
        const c = [...m], last = c[c.length - 1]
        if (last && last.role === 'assistant' && !last.content) c[c.length - 1] = { ...last, content: "I couldn't find an answer for that." }
        return c
      })
    } catch (err) {
      // Drop the empty placeholder, surface the error.
      setMessages(m => {
        const c = [...m]
        if (c.length && c[c.length - 1].role === 'assistant' && !c[c.length - 1].content) c.pop()
        return [...c, { role: 'error', content: err?.message || 'Something went wrong.' }]
      })
    } finally {
      setBusy(false)
    }
  }, [input, busy, messages, allPosts, ranked, competitors, config, platform, windowLabel])

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  return (
    <>
      <button
        className={`asst-fab ${open ? 'is-open' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-label={open ? 'Close data assistant' : 'Ask about this data'}
        title="Ask about this data"
      >
        {open ? <X size={20} /> : <Sparkles size={20} />}
      </button>

      {open && (
        <div className="asst-panel" role="dialog" aria-label="Data assistant">
          <div className="asst-head">
            <div className="asst-head-title">
              <Sparkles size={15} className="asst-head-spark" />
              <span>Ask about this data</span>
            </div>
            <button className="asst-icon-btn" onClick={() => setOpen(false)} aria-label="Close">
              <X size={16} />
            </button>
          </div>

          <div className="asst-msgs" ref={scrollRef}>
            {messages.length === 0 && (
              <div className="asst-empty">
                <p className="asst-empty-lead">Ask why a number moved, or where to find something.</p>
                <div className="asst-suggests">
                  {SUGGESTIONS.map(s => (
                    <button key={s} className="asst-suggest" onClick={() => send(s)} disabled={busy}>{s}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`asst-msg asst-msg-${m.role}`}>
                {m.content
                  ? (m.role === 'assistant'
                      ? <div className="asst-md"><ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>{m.content}</ReactMarkdown></div>
                      : m.content)
                  : (m.role === 'assistant'
                      ? <span className="asst-typing" aria-label="Thinking"><span></span><span></span><span></span></span>
                      : '')}
              </div>
            ))}
          </div>

          <div className="asst-input-row">
            <textarea
              ref={inputRef}
              className="asst-input"
              rows={1}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask a question…"
              disabled={busy}
            />
            <button className="asst-send" onClick={() => send()} disabled={busy || !input.trim()} aria-label="Send">
              <ArrowUp size={16} />
            </button>
          </div>
          <div className="asst-foot">Answers use the board + posts currently loaded. It can be wrong — verify anything important.</div>
        </div>
      )}
    </>
  )
}
