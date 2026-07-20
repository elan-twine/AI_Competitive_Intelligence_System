import { useState, useRef, useEffect, useCallback } from 'react'
import { Sparkles, X, ArrowUp, RotateCcw, FileText, Copy, Check, Pencil } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { askAssistant, fileIssue } from '../lib/assistant'
import './assistantChat.css'

// Markdown renderers: open links in a new tab (safely), and never render raw HTML
// (react-markdown's default — LLM output is untrusted).
const MD_COMPONENTS = {
  // Destructure `node` only to keep react-markdown's AST node off the DOM element.
  // eslint-disable-next-line no-unused-vars
  a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
}

// Floating "ask about this data" assistant. Lives on the dashboard; answers both
// specific questions ("why did Orchid spike?") and navigational ones ("where do
// I see AI visibility?"). It runs a server-side agentic loop (Claude Sonnet 4.5)
// that fetches its own data via tools — this component only sends a THIN UI-state
// header (what the user is currently looking at), not a data snapshot.
const SUGGESTIONS = [
  'Why did the top mover change this week?',
  'Who gained the most share recently, and why?',
  'Where do I see AI visibility?',
  'Report a data or weighting error',
]

export function AssistantChat({ platform = 'All', windowLabel = 'current', tab = null, drilledCompany = null }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([]) // { role:'user'|'assistant'|'error', content }
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [copiedIdx, setCopiedIdx] = useState(null)
  const [usage, setUsage] = useState(null) // { used, limit, remaining } — today's budget
  const inputRef = useRef(null)
  const scrollRef = useRef(null)
  // Server-side conversation id: the Worker remembers prior turns under it, so we
  // send this instead of the transcript. Created lazily on first send; rotated on
  // reset/edit (a new id = a fresh server conversation).
  const sessionIdRef = useRef(null)
  // Typewriter buffer: network chunks arrive in bursts, so painting them directly
  // reads splotchy. Incoming text lands in `target` and a rAF loop reveals it at
  // an adaptive pace — trickles at reading speed, accelerates when backlog grows —
  // so the answer flows smoothly regardless of how the frames were delivered.
  const typerRef = useRef({ target: '', shown: 0, raf: 0 })

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

  // Update the trailing assistant bubble in place (token/step frames + the typer).
  const patchAssistant = useCallback((fn) => setMessages(m => {
    const c = [...m]
    for (let i = c.length - 1; i >= 0; i--) { if (c[i].role === 'assistant') { c[i] = fn(c[i]); break } }
    return c
  }), [])

  // Stop the reveal loop; optionally flush whatever text is still buffered.
  const stopTyper = useCallback((flush) => {
    const t = typerRef.current
    if (t.raf) cancelAnimationFrame(t.raf)
    t.raf = 0
    if (flush && t.shown < t.target.length) {
      t.shown = t.target.length
      const text = t.target
      patchAssistant(a => ({ ...a, content: text }))
    }
  }, [patchAssistant])

  // Reveal buffered text smoothly. Two speed knobs (per ~60fps frame):
  //   floor (TYPER_MIN chars/frame) = steady-state pace → 1 ≈ 60 chars/s;
  //   divisor (TYPER_CATCHUP) = how hard a backlog accelerates the reveal.
  const TYPER_MIN = 1
  const TYPER_CATCHUP = 32
  const pumpTyper = useCallback(() => {
    if (typerRef.current.raf) return
    const tick = () => {
      const t = typerRef.current
      if (t.shown < t.target.length) {
        t.shown = Math.min(t.target.length, t.shown + Math.max(TYPER_MIN, Math.round((t.target.length - t.shown) / TYPER_CATCHUP)))
        const text = t.target.slice(0, t.shown)
        patchAssistant(a => ({ ...a, content: text }))
        t.raf = requestAnimationFrame(tick)
      } else { t.raf = 0 }
    }
    typerRef.current.raf = requestAnimationFrame(tick)
  }, [patchAssistant])

  // Cancel any in-flight reveal when the panel unmounts.
  useEffect(() => () => { if (typerRef.current.raf) cancelAnimationFrame(typerRef.current.raf) }, [])

  const send = useCallback(async (text) => {
    const question = String(text ?? input).trim()
    if (!question || busy) return
    setInput('')
    const history = messages.filter(m => m.role !== 'error').map(m => ({ role: m.role, content: m.content }))
    // If a previous answer is still typing out, land it before starting anew.
    stopTyper(true)
    typerRef.current = { target: '', shown: 0, raf: 0 }
    // Add the question + an empty assistant bubble the stream fills in place.
    setMessages(m => [...m, { role: 'user', content: question }, { role: 'assistant', content: '', steps: [] }])
    setBusy(true)
    let gotDraft = false
    const reducedMotion = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    try {
      // Thin UI-state header — deixis, not data. The agent fetches the rest itself.
      const context = { tab, window: windowLabel, platformFilter: platform, drilledCompany }
      if (!sessionIdRef.current) sessionIdRef.current = crypto.randomUUID()
      const out = await askAssistant({
        question, context, history, sessionId: sessionIdRef.current,
        // Buffer tokens and reveal via the typer (direct paint under reduced motion).
        onToken: (_chunk, full) => {
          if (gotDraft) return
          if (reducedMotion) { patchAssistant(a => ({ ...a, content: full })); return }
          typerRef.current.target = full
          pumpTyper()
        },
        // A tool step is running — surface it as live "thinking" above the answer.
        onProgress: (label) => { if (gotDraft || !label) return; patchAssistant(a => ({ ...a, steps: [...(a.steps || []), label] })) },
        // Today's question budget → footer counter.
        onUsage: (u) => setUsage(u),
        // Model wants to file feedback → replace the placeholder with a review card.
        // Nothing is filed until the user taps "File it".
        onDraft: (draft) => { gotDraft = true; stopTyper(false); setMessages(m => {
          const c = [...m]
          for (let i = c.length - 1; i >= 0; i--) { if (c[i].role === 'assistant') { c[i] = { role: 'assistant', kind: 'draft', draft, content: '' }; break } }
          return c
        }) },
      })
      // Nothing streamed back → show a fallback in the placeholder bubble.
      // (Check the returned text, not the rendered bubble — the typer may still be
      // mid-reveal when the network finishes.)
      if (!gotDraft && (typeof out !== 'string' || !out.trim())) {
        stopTyper(false)
        patchAssistant(a => (a.content ? a : { ...a, content: "I couldn't find an answer for that." }))
      }
    } catch (err) {
      // Drop the empty placeholder, surface the error.
      stopTyper(true)
      setMessages(m => {
        const c = [...m]
        if (c.length && c[c.length - 1].role === 'assistant' && !c[c.length - 1].content) c.pop()
        return [...c, { role: 'error', content: err?.message || 'Something went wrong.' }]
      })
    } finally {
      setBusy(false)
    }
  }, [input, busy, messages, platform, windowLabel, tab, drilledCompany, patchAssistant, stopTyper, pumpTyper])

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  // Clear the whole conversation: drop local messages AND rotate the server-side
  // session id, so the next send starts a genuinely fresh conversation.
  const reset = () => { stopTyper(false); setMessages([]); setInput(''); sessionIdRef.current = null; if (inputRef.current) inputRef.current.focus() }

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
  // (same as editing a prior message in Claude). Rotate the server session id —
  // the stored session still holds the dropped turns; the next send seeds a fresh
  // session from the kept local history instead.
  const editMessage = useCallback((idx) => {
    if (busy) return
    const msg = messages[idx]
    if (!msg || msg.role !== 'user') return
    setInput(msg.content)
    setMessages(prev => prev.slice(0, idx))
    sessionIdRef.current = null
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
                          ? (m.steps && m.steps.length
                              ? <div className="asst-steps" aria-label="Working">
                                  {m.steps.map((s, si) => (
                                    <div key={si} className={`asst-step ${si === m.steps.length - 1 ? 'active' : 'done'}`}>{s}</div>
                                  ))}
                                </div>
                              : <span className="asst-typing" aria-label="Thinking"><span></span><span></span><span></span></span>)
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
          <div className="asst-foot">
            The assistant looks up the board, posts, and pipeline status to answer. It can be wrong — verify anything important.
            {usage && usage.limit != null && (
              <span className={`asst-usage ${usage.remaining <= 5 ? 'low' : ''}`}> · {usage.used}/{usage.limit} today</span>
            )}
          </div>
        </div>
      )}
    </>
  )
}
