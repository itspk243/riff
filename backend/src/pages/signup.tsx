// /signup — primary auth page.
//
// Modes (controlled by `mode` state):
//   signin — email + password (default)
//   signup — email + password + confirm (creates Supabase user)
//   forgot — email only, fires a password-reset email
//   magic  — email only, fires a one-shot magic link (kept as escape hatch
//            for users who don't want to set a password)
//
// Google OAuth stays as the one-click primary option above the form.
//
// All paths land on /auth/callback (or /auth/reset-password for password
// resets). The callback page now redirects immediately to /dashboard —
// no more "copy your token" interstitial. The dashboard-bridge content
// script auto-hands the token off to the extension if it's installed.

import { useState } from 'react';
import Head from 'next/head';
import { createClient } from '@supabase/supabase-js';

type Mode = 'signin' | 'signup' | 'forgot' | 'magic';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export default function SignupPage() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  function origin() {
    return typeof window !== 'undefined' ? window.location.origin : '';
  }

  async function handleGoogle() {
    setState('busy');
    setErrorMsg('');
    try {
      const supabase = getSupabase();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${origin()}/auth/callback`,
          scopes: 'email profile',
        },
      });
      if (error) {
        setErrorMsg(error.message);
        setState('error');
      }
    } catch (e: any) {
      setErrorMsg(e?.message || 'Google sign-in failed');
      setState('error');
    }
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setState('busy');
    setErrorMsg('');
    try {
      const supabase = getSupabase();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setErrorMsg(error.message || 'Wrong email or password.');
        setState('error');
        return;
      }
      // Successful sign-in. Land on dashboard. The dashboard-bridge
      // auto-detects the session and shows the user signed in.
      window.location.replace('/dashboard');
    } catch (e: any) {
      setErrorMsg(e?.message || 'Could not sign in. Try again.');
      setState('error');
    }
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setErrorMsg('Password must be at least 8 characters.');
      setState('error');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      setState('error');
      return;
    }
    setState('busy');
    setErrorMsg('');
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${origin()}/auth/callback` },
      });
      if (error) {
        setErrorMsg(error.message);
        setState('error');
        return;
      }
      // If email confirmations are turned on in Supabase, data.session is null
      // and the user has to verify their email first. If confirmations are off,
      // we can sign them straight in.
      if (data.session) {
        window.location.replace('/dashboard');
      } else {
        setState('sent');
      }
    } catch (e: any) {
      setErrorMsg(e?.message || 'Could not create your account.');
      setState('error');
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setState('busy');
    setErrorMsg('');
    try {
      const supabase = getSupabase();
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${origin()}/auth/reset-password`,
      });
      if (error) {
        setErrorMsg(error.message);
        setState('error');
        return;
      }
      setState('sent');
    } catch (e: any) {
      setErrorMsg(e?.message || 'Could not send reset email.');
      setState('error');
    }
  }

  async function handleMagic(e: React.FormEvent) {
    e.preventDefault();
    setState('busy');
    setErrorMsg('');
    try {
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErrorMsg(data.error || 'Could not send magic link.');
        setState('error');
        return;
      }
      setState('sent');
    } catch (e: any) {
      setErrorMsg(e?.message || 'Network error');
      setState('error');
    }
  }

  function switchMode(m: Mode) {
    setMode(m);
    setState('idle');
    setErrorMsg('');
    setPassword('');
    setConfirmPassword('');
  }

  // ---------- "Check your email" success states ----------

  if (state === 'sent' && mode === 'signup') {
    return (
      <SuccessShell title="Check your email.">
        We sent a confirmation link to <strong>{email}</strong>. Click it to finish creating your account, then come back and sign in.
      </SuccessShell>
    );
  }
  if (state === 'sent' && mode === 'forgot') {
    return (
      <SuccessShell title="Reset link sent.">
        If <strong>{email}</strong> has a Riffly account, you'll get a reset link in the next minute. Click it and you'll be able to set a new password.
      </SuccessShell>
    );
  }
  if (state === 'sent' && mode === 'magic') {
    return (
      <SuccessShell title="Check your email.">
        We sent a one-shot sign-in link to <strong>{email}</strong>. Click it and you'll come back here signed in. The link expires in an hour.
      </SuccessShell>
    );
  }

  // ---------- Form views ----------

  const titleByMode: Record<Mode, string> = {
    signin: 'Sign in to Riffly.',
    signup: 'Create your Riffly account.',
    forgot: 'Reset your password.',
    magic: 'Sign in with a magic link.',
  };

  return (
    <>
      <Head>
        <title>Sign in — Riffly</title>
        <meta name="description" content="Sign in to Riffly." />
      </Head>
      <main style={pageStyle}>
        <div style={cardStyle}>
          <a href="/" style={brandStyle}>
            <span style={dotStyle} />Riffly
          </a>

          {/* Beta-disclosure banner — sets honest expectations BEFORE the
              user authenticates. Until the Chrome Web Store listing
              publishes, every signup is effectively private-beta. */}
          {(mode === 'signin' || mode === 'signup') && (
            <div style={betaBannerStyle}>
              <strong style={{ color: '#b14a1a' }}>Private beta · Chrome Web Store listing in review.</strong>
              <span style={{ color: '#555' }}>
                &nbsp;Sign in now to claim your spot — we'll email you the moment the extension publishes (usually 1–7 days). The dashboard is live; the extension installs on top.
              </span>
            </div>
          )}

          <h1 style={h1Style}>{titleByMode[mode]}</h1>

          {/* Google button — always visible at the top for one-click sign-in */}
          {(mode === 'signin' || mode === 'signup') && (
            <>
              <button
                onClick={handleGoogle}
                disabled={state === 'busy'}
                style={googleButtonStyle}
              >
                <GoogleLogo />
                {state === 'busy' ? 'Redirecting…' : `Continue with Google`}
              </button>
              <div style={dividerStyle}><span style={dividerLineStyle} /><span style={dividerTextStyle}>or</span><span style={dividerLineStyle} /></div>
            </>
          )}

          {/* ---------- Signin form ---------- */}
          {mode === 'signin' && (
            <form onSubmit={handleSignIn}>
              <label style={labelStyle}>
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="you@company.com"
                  style={inputStyle}
                  disabled={state === 'busy'}
                />
              </label>
              <label style={labelStyle}>
                Password
                <PasswordInput
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  disabled={state === 'busy'}
                />
              </label>
              <button type="submit" disabled={state === 'busy'} style={primaryButtonStyle}>
                {state === 'busy' ? 'Signing in…' : 'Sign in'}
              </button>
              <div style={altRowStyle}>
                <button type="button" onClick={() => switchMode('forgot')} style={linkButtonStyle}>
                  Forgot password?
                </button>
                <button type="button" onClick={() => switchMode('signup')} style={linkButtonStyle}>
                  Create account
                </button>
              </div>
            </form>
          )}

          {/* ---------- Signup form ---------- */}
          {mode === 'signup' && (
            <form onSubmit={handleSignUp}>
              <label style={labelStyle}>
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="you@company.com"
                  style={inputStyle}
                  disabled={state === 'busy'}
                />
              </label>
              <label style={labelStyle}>
                Password (8+ characters)
                <PasswordInput
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  disabled={state === 'busy'}
                />
              </label>
              <label style={labelStyle}>
                Confirm password
                <PasswordInput
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  disabled={state === 'busy'}
                />
              </label>
              <button type="submit" disabled={state === 'busy'} style={primaryButtonStyle}>
                {state === 'busy' ? 'Creating account…' : 'Create account'}
              </button>
              <div style={altRowStyle}>
                <button type="button" onClick={() => switchMode('signin')} style={linkButtonStyle}>
                  Already have an account? Sign in
                </button>
              </div>
            </form>
          )}

          {/* ---------- Forgot password form ---------- */}
          {mode === 'forgot' && (
            <form onSubmit={handleForgot}>
              <p style={pStyle}>Enter the email on your account. We'll send you a link to set a new password.</p>
              <label style={labelStyle}>
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  autoFocus
                  placeholder="you@company.com"
                  style={inputStyle}
                  disabled={state === 'busy'}
                />
              </label>
              <button type="submit" disabled={state === 'busy'} style={primaryButtonStyle}>
                {state === 'busy' ? 'Sending…' : 'Send reset link'}
              </button>
              <div style={altRowStyle}>
                <button type="button" onClick={() => switchMode('signin')} style={linkButtonStyle}>
                  Back to sign in
                </button>
              </div>
            </form>
          )}

          {/* ---------- Magic link form (escape hatch) ---------- */}
          {mode === 'magic' && (
            <form onSubmit={handleMagic}>
              <p style={pStyle}>We'll email you a one-shot sign-in link. Don't need a password.</p>
              <label style={labelStyle}>
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  autoFocus
                  placeholder="you@company.com"
                  style={inputStyle}
                  disabled={state === 'busy'}
                />
              </label>
              <button type="submit" disabled={state === 'busy'} style={primaryButtonStyle}>
                {state === 'busy' ? 'Sending…' : 'Send magic link'}
              </button>
              <div style={altRowStyle}>
                <button type="button" onClick={() => switchMode('signin')} style={linkButtonStyle}>
                  Back to sign in
                </button>
              </div>
            </form>
          )}

          {state === 'error' && <div style={errorStyle}>{errorMsg}</div>}

          {/* "Other ways to sign in" footer — only on signin/signup screens */}
          {(mode === 'signin' || mode === 'signup') && (
            <p style={otherStyle}>
              Other ways:{' '}
              <button type="button" onClick={() => switchMode('magic')} style={linkButtonStyle}>
                magic link
              </button>
            </p>
          )}

          <p style={smallStyle}>
            By continuing you agree to the <a href="/terms" style={linkStyle}>Terms</a> and{' '}
            <a href="/privacy" style={linkStyle}>Privacy</a>.
          </p>
        </div>
      </main>
    </>
  );
}

// ---------- helpers ----------

function SuccessShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <Head><title>{title} — Riffly</title></Head>
      <main style={pageStyle}>
        <div style={cardStyle}>
          <a href="/" style={brandStyle}><span style={dotStyle} />Riffly</a>
          <h1 style={h1Style}>{title}</h1>
          <p style={pStyle}>{children}</p>
          <p style={hintStyle}>
            Don't see it? Check spam, or{' '}
            <a href="/signup" style={linkStyle}>start again</a>.
          </p>
        </div>
      </main>
    </>
  );
}

// Reusable password field with a tiny Show / Hide toggle. Each instance keeps
// its own visibility state so the signup-mode "Password" and "Confirm password"
// fields can be revealed independently. tabIndex={-1} keeps the toggle out of
// the keyboard tab order so Tab still moves between form fields normally.
function PasswordInput({
  value,
  onChange,
  placeholder,
  autoComplete,
  disabled,
  autoFocus,
  minLength,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  autoComplete?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  minLength?: number;
}) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: 'relative', marginTop: 6 }}>
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        required
        minLength={minLength}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        placeholder={placeholder}
        disabled={disabled}
        style={{ ...inputStyle, marginTop: 0, paddingRight: 64 }}
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        tabIndex={-1}
        aria-label={show ? 'Hide password' : 'Show password'}
        style={showHideButtonStyle}
      >
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  );
}

// ---------- Styles ----------

const pageStyle: React.CSSProperties = {
  minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: '#fafafa',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  padding: 24,
};
const cardStyle: React.CSSProperties = {
  background: '#fff', border: '1px solid #e5e5e7', borderRadius: 16, padding: 36,
  width: '100%', maxWidth: 420,
};
const brandStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  fontWeight: 800, fontSize: 22, letterSpacing: '-0.03em',
  color: '#0a0a0a', textDecoration: 'none', marginBottom: 24,
};
const dotStyle: React.CSSProperties = { width: 9, height: 9, background: '#0a0a0a', borderRadius: '50%' };
const betaBannerStyle: React.CSSProperties = {
  background: '#fdf6f3', border: '1px solid #f0d8cd', borderRadius: 8,
  padding: '12px 14px', marginBottom: 22, fontSize: 13, lineHeight: 1.5, color: '#555',
};
const h1Style: React.CSSProperties = { margin: '0 0 18px', fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em' };
const pStyle: React.CSSProperties = { margin: '0 0 16px', fontSize: 14.5, color: '#555', lineHeight: 1.55 };
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 13, color: '#444', marginBottom: 14 };
const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 15,
  border: '1px solid #d8d8dc', borderRadius: 8, marginTop: 6,
  fontFamily: 'inherit', background: '#fff',
};
const googleButtonStyle: React.CSSProperties = {
  width: '100%', padding: '11px', background: '#fff', color: '#3c4043',
  border: '1px solid #dadce0', borderRadius: 8, fontSize: 14.5, fontWeight: 500,
  cursor: 'pointer', fontFamily: 'inherit',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10,
};
const dividerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, margin: '20px 0 16px',
};
const dividerLineStyle: React.CSSProperties = { flex: 1, height: 1, background: '#e5e5e7' };
const dividerTextStyle: React.CSSProperties = { fontSize: 12, color: '#999', textTransform: 'uppercase', letterSpacing: '0.08em' };
const primaryButtonStyle: React.CSSProperties = {
  width: '100%', padding: '11px', marginTop: 4,
  background: '#0a0a0a', color: '#fff', border: 'none', borderRadius: 8,
  fontSize: 14.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
};
const altRowStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', marginTop: 14,
  fontSize: 13, color: '#555',
};
const otherStyle: React.CSSProperties = {
  margin: '20px 0 0', fontSize: 12.5, color: '#777', textAlign: 'center',
};
const errorStyle: React.CSSProperties = {
  background: '#fef2f0', border: '1px solid #f4c4ba', color: '#b8331a',
  padding: '8px 12px', borderRadius: 6, fontSize: 13, marginTop: 12,
};
const hintStyle: React.CSSProperties = { fontSize: 13, color: '#777', marginTop: 16 };
const smallStyle: React.CSSProperties = { fontSize: 12, color: '#999', marginTop: 18, textAlign: 'center' };
const linkStyle: React.CSSProperties = { color: '#0a0a0a' };
const linkButtonStyle: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, color: '#0a0a0a',
  textDecoration: 'underline', cursor: 'pointer', font: 'inherit',
};
const showHideButtonStyle: React.CSSProperties = {
  position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
  background: 'none', border: 'none', padding: '6px 10px',
  fontSize: 12, color: '#555', cursor: 'pointer', fontFamily: 'inherit',
};
