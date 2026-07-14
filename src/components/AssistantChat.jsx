import { useState, useRef, useEffect, useCallback } from 'react'
import { Sparkles, X, ArrowUp, RotateCcw, FileText, Copy, Check, Pencil } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { buildAssistantContext } from '../lib/assistantContext'
import { askAssistant, fileIssue } from '../lib/assistant'
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
  const [copiedIdx, setCopiedIdx] = useState(null)
  const inputRef = useRef(null)
  const scrollRef = useRef(null)

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus()
  }, [open])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, busy])

  // Auto-size the input to its content (up to the CSS max-height), and shrink it
  // back down as text is deleted or after a send clears it.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }, [input, open])

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
    let gotDraft = false
    try {
      const context = buildAssistantContext({ allPosts, ranked, competitors, config, filters: { platform, window: windowLabel } })
      await askAssistant({
        question, context, history,
        onToken: (_chunk, full) => { if (gotDraft) return; setMessages(m => {
          const c = [...m]
          for (let i = c.length - 1; i >= 0; i--) { if (c[i].role === 'assistant') { c[i] = { ...c[i], content: full }; break } }
          return c
        }) },
        // Model wants to file feedback → replace the placeholder with a review card.
        // Nothing is filed until the user taps "File it".
        onDraft: (draft) => { gotDraft = true; setMessages(m => {
          const c = [...m]
          for (let i = c.length - 1; i >= 0; i--) { if (c[i].role === 'assistant') { c[i] = { role: 'assistant', kind: 'draft', draft, content: '' }; break } }
          return c
        }) },
      })
      // Nothing streamed back → show a fallback in the placeholder bubble.
      if (!gotDraft) setMessages(m => {
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

  // Clear the whole conversation. There's no server-side session — history lives
  // only in this state and is re-sent each turn — so this fully resets context.
  const reset = () => { setMessages([]); setInput(''); if (inputRef.current) inputRef.current.focus() }

  // Confirm a draft → actually file the issue, then swap the card for the result.
  const fileDraft = useCallback(async (idx, draft) => {
    setMessages(m => { const c = [...m]; if (c[idx]?.kind === 'draft') c[idx] = { ...c[idx], filing: true, error: null }; return c })
    try {
      const res = await fileIssue(draft)
      setMessages(m => { const c = [...m]; c[idx] = { role: 'assistant', content: `✓ ${res.message || 'Filed.'}\n\nThe team will review it.` }; return c })
    } catch (err) {
      setMessages(m => { const c = [...m]; if (c[idx]?.kind === 'draft') c[idx] = { ...c[idx], filing: false, error: err?.message || 'Could not file that.' }; return c })
    }
  }, [])

  // Discard a draft without filing.
  const cancelDraft = useCallback((idx) => {
    setMessages(m => { const c = [...m]; c[idx] = { role: 'assistant', content: '_Draft discarded — nothing was filed._' }; return c })
  }, [])

  // Copy a message's text to the clipboard; flash a check for a moment.
  const copyMessage = useCallback(async (idx, text) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedIdx(idx)
      setTimeout(() => setCopiedIdx(c => (c === idx ? null : c)), 1200)
    } catch { /* clipboard blocked — ignore */ }
  }, [])

  // Edit an earlier question: pull it back into the input and drop that turn and
  // everything after it, so the next send restarts the conversation from here
  // (same as editing a prior message in Claude).
  const editMessage = useCallback((idx) => {
    if (busy) return
    const msg = messages[idx]
    if (!msg || msg.role !== 'user') return
    setInput(msg.content)
    setMessages(prev => prev.slice(0, idx))
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [busy, messages])

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
            <div className="asst-head-actions">
              {messages.length > 0 && (
                <button className="asst-icon-btn" onClick={reset} aria-label="Reset chat" title="Reset chat">
                  <RotateCcw size={15} />
                </button>
              )}
              <button className="asst-icon-btn" onClick={() => setOpen(false)} aria-label="Close">
                <X size={16} />
              </button>
            </div>
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
              m.kind === 'draft' ? (
                <div key={i} className="asst-draft" dir="auto">
                  <div className="asst-draft-head"><FileText size={13} /> Draft issue — review before filing</div>
                  {m.draft?.title && <div className="asst-draft-title">{m.draft.title}</div>}
                  {m.draft?.body && (
                    <div className="asst-md asst-draft-body">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>{m.draft.body}</ReactMarkdown>
                    </div>
                  )}
                  {m.draft?.verbatim && (
                    <div className="asst-draft-verbatim">
                      <span className="asst-draft-verbatim-label">Your words (attached verbatim)</span>
                      {m.draft.verbatim}
                    </div>
                  )}
                  {m.draft?.category && <div className="asst-draft-cat">{m.draft.category}</div>}
                  {m.error && <div className="asst-draft-err">{m.error}</div>}
                  <div className="asst-draft-actions">
                    <button className="asst-draft-file" onClick={() => fileDraft(i, m.draft)} disabled={m.filing}>
                      {m.filing ? 'Filing…' : 'File it'}
                    </button>
                    <button className="asst-draft-cancel" onClick={() => cancelDraft(i)} disabled={m.filing}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div key={i} className={`asst-row asst-row-${m.role}`}>
                  <div className={`asst-msg asst-msg-${m.role}`} dir="auto">
                    {m.content
                      ? (m.role === 'assistant'
                          ? <div className="asst-md"><ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>{m.content}</ReactMarkdown></div>
                          : m.content)
                      : (m.role === 'assistant'
                          ? <span className="asst-typing" aria-label="Thinking"><span></span><span></span><span></span></span>
                          : '')}
                  </div>
                  {m.content && m.role !== 'error' && (
                    <div className="asst-actions">
                      <button className="asst-act-btn" onClick={() => copyMessage(i, m.content)} title="Copy" aria-label="Copy message">
                        {copiedIdx === i ? <Check size={13} /> : <Copy size={13} />}
                      </button>
                      {m.role === 'user' && (
                        <button className="asst-act-btn" onClick={() => editMessage(i)} disabled={busy} title="Edit & resend" aria-label="Edit message">
                          <Pencil size={13} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            ))}
          </div>

          <div className="asst-input-row">
            <textarea
              ref={inputRef}
              className="asst-input"
              dir="auto"
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
