import { useState, useEffect, useRef, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate, useSearchParams } from 'react-router-dom'

const DEFAULT_AFTER_LOGIN = '/chat-agent'

function safeNextPath(raw: string | null, fallback: string): string {
  if (!raw) return fallback
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('://')) return fallback
  return raw
}

export function Login() {
  const [loading, setLoading] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const googleStarted = useRef(false)
  const isSignUp = searchParams.get('mode') === 'signup'
  const nextPath = safeNextPath(searchParams.get('next'), DEFAULT_AFTER_LOGIN)
  const authRedirectTo = `${window.location.origin}${nextPath}`

  useEffect(() => {
    const errorParam = searchParams.get('error')
    const errorDesc = searchParams.get('error_description')
    if (errorParam) {
      setError(
        errorDesc
          ? decodeURIComponent(errorDesc)
          : 'Произошла ошибка при входе. Попробуйте ещё раз или войдите по email.'
      )
    }
  }, [searchParams])

  useEffect(() => {
    let cancelled = false

    const boot = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (cancelled) return
      if (session) {
        navigate(nextPath, { replace: true })
        return
      }
      if (searchParams.get('google') === '1' && !searchParams.get('error')) {
        void handleGoogleLogin()
      }
    }

    void boot()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleGoogleLogin = async () => {
    if (googleStarted.current) return
    googleStarted.current = true
    try {
      setLoading(true)
      setError(null)
      setSuccess(null)

      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: authRedirectTo,
          queryParams: {
            access_type: 'offline',
            prompt: 'select_account',
          },
        },
      })

      if (oauthError) {
        googleStarted.current = false
        console.error('OAuth error:', oauthError)
        if (
          oauthError.message.includes('redirect_uri') ||
          oauthError.message.includes('redirect_uri_mismatch')
        ) {
          setError('Google OAuth misconfigured (redirect_uri_mismatch). Сообщите в поддержку Autoro.')
        } else if (oauthError.message.includes('invalid_client')) {
          setError('Ошибка входа через Google. Сообщите в поддержку Autoro.')
        } else {
          setError(`Ошибка OAuth: ${oauthError.message}`)
        }
        setLoading(false)
      }
    } catch (loginError: unknown) {
      googleStarted.current = false
      const message = loginError instanceof Error ? loginError.message : 'Не удалось выполнить вход.'
      console.error('Error logging in:', loginError)
      setError(message)
      setLoading(false)
    }
  }

  const handleEmailAuth = async (event: FormEvent) => {
    event.preventDefault()
    try {
      setLoading(true)
      setError(null)
      setSuccess(null)

      if (!email.trim() || !password.trim()) {
        setError('Введите email и пароль.')
        return
      }

      if (isSignUp) {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: authRedirectTo,
          },
        })
        if (signUpError) {
          setError(`Supabase sign up failed: ${signUpError.message}`)
          return
        }
        if (data.session) {
          navigate(nextPath, { replace: true })
          return
        }
        setSuccess('Registration successful. Check your email for confirmation.')
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        })
        if (signInError) {
          if (
            signInError.message.toLowerCase().includes('invalid login credentials') ||
            signInError.status === 401
          ) {
            setError('Supabase login failed: HTTP 401. Invalid email or password.')
          } else {
            setError(`Supabase login failed: ${signInError.message}`)
          }
          return
        }
        navigate(nextPath, { replace: true })
      }
    } catch (authError: unknown) {
      setError(authError instanceof Error ? authError.message : 'Authentication request failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold text-gray-900">
            {isSignUp ? 'Create Account' : 'Welcome Back'}
          </h2>
          <p className="text-gray-600 mt-2">
            {isSignUp ? 'Sign up to start automating' : 'Sign in to access your dashboard'}
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
            {success}
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            googleStarted.current = false
            void handleGoogleLogin()
          }}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors bg-white text-gray-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <img src="https://www.svgrepo.com/show/475656/google-color.svg" alt="" className="w-6 h-6" />
          {loading ? 'Connecting...' : 'Continue with Google'}
        </button>

        <div className="my-4 flex items-center">
          <div className="flex-1 border-t border-gray-200" />
          <span className="px-3 text-xs text-gray-400">or</span>
          <div className="flex-1 border-t border-gray-200" />
        </div>

        <form className="space-y-3" onSubmit={handleEmailAuth}>
          <label className="block text-sm font-medium text-gray-700" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-gray-300"
          />
          <label className="block text-sm font-medium text-gray-700" htmlFor={isSignUp ? 'new-password' : 'current-password'}>
            Password
          </label>
          <input
            id={isSignUp ? 'new-password' : 'current-password'}
            name="password"
            type="password"
            autoComplete={isSignUp ? 'new-password' : 'current-password'}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-gray-300"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full px-4 py-3 rounded-lg bg-gray-900 text-white font-medium hover:bg-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Please wait...' : isSignUp ? 'Create Account' : 'Sign In with Email'}
          </button>
        </form>
      </div>
    </div>
  )
}
