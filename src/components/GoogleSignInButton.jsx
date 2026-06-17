import { useState } from 'react'
import { signInWithGoogle } from '../lib/auth'
import './google-button.css'

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  )
}

// Shared "Continue with Google" button. Used on the Login page and the Landing
// login modal. On success the browser redirects to Google, so the component
// unmounts — we only reset loading on error.
export function GoogleSignInButton({ label = 'Continue with Google' }) {
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState(null)

  const handleClick = async () => {
    setErrorMsg(null)
    setLoading(true)
    const { error } = await signInWithGoogle()
    if (error) {
      setLoading(false)
      setErrorMsg(error.message || 'Google sign-in failed')
    }
  }

  return (
    <>
      <button type="button" className="btn-google" onClick={handleClick} disabled={loading}>
        <GoogleIcon />
        {loading ? 'Redirecting…' : label}
      </button>
      {errorMsg && <div className="auth-error">{errorMsg}</div>}
    </>
  )
}
