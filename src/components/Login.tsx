import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useSearchParams } from 'react-router-dom'

export function Login() {
  const [loading, setLoading] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [searchParams] = useSearchParams()
  const isSignUp = searchParams.get('mode') === 'signup'
  const authRedirectTo = import.meta.env.VITE_AUTH_REDIRECT_TO || `${window.location.origin}/`
  const googleCallbackUrl = `${import.meta.env.VITE_SUPABASE_URL || 'https://swoop.autoro.tech/supabase'}/auth/v1/callback`

  // Check for OAuth error in URL
  useEffect(() => {
    const errorParam = searchParams.get('error')
    const errorDesc = searchParams.get('error_description')
    if (errorParam) {
      setError(
        errorDesc 
          ? decodeURIComponent(errorDesc) 
          : 'Произошла ошибка при входе. Проверьте настройки OAuth в Supabase.'
      )
    }
  }, [searchParams])

  // Cloudflare Turnstile disabled — no verification at login
  // To re-enable: add turnstileToken state, load Turnstile script, show cf-turnstile widget, check token before login

  const handleGoogleLogin = async () => {
    try {
      setLoading(true)
      setError(null)
      setSuccess(null)
      
      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: authRedirectTo,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        }
      })
      
      if (oauthError) {
        console.error('OAuth error:', oauthError)
        setError(`Ошибка OAuth: ${oauthError.message}`)
        
        // Specific error messages
        if (oauthError.message.includes('redirect_uri') || oauthError.message.includes('redirect_uri_mismatch')) {
          setError(
            'Google OAuth misconfigured (redirect_uri_mismatch). ' +
            `Проверьте в Google Cloud Authorized redirect URI: ${googleCallbackUrl} и в Supabase Site URL/Redirect URLs: ${authRedirectTo}`
          )
        } else if (oauthError.message.includes('invalid_client')) {
          setError('Ошибка: Неверный Client ID или Secret. Проверьте настройки Google OAuth в Supabase.')
        }
      } else if (data) {
        // OAuth redirect will happen automatically
        console.log('OAuth initiated successfully')
        // Don't set loading to false here - redirect is coming
      }
    } catch (error: any) {
      console.error('Error logging in:', error)
      setError(error.message || 'Не удалось выполнить вход. Проверьте консоль браузера для деталей.')
      setLoading(false)
    }
  }

  const handleEmailAuth = async () => {
    try {
      setLoading(true)
      setError(null)
      setSuccess(null)

      if (!email.trim() || !password.trim()) {
        setError('Введите email и пароль.')
        return
      }

      if (isSignUp) {
        const { error: signUpError } = await supabase.auth.signUp({
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
        setSuccess('Login successful. Redirecting...')
      }
    } catch (authError: any) {
      setError(authError?.message || 'Authentication request failed.')
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
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors bg-white text-gray-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <img src="https://www.svgrepo.com/show/475656/google-color.svg" alt="Google" className="w-6 h-6" />
          {loading ? 'Connecting...' : 'Continue with Google'}
        </button>

        <div className="my-4 flex items-center">
          <div className="flex-1 border-t border-gray-200" />
          <span className="px-3 text-xs text-gray-400">or</span>
          <div className="flex-1 border-t border-gray-200" />
        </div>

        <div className="space-y-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-gray-300"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-gray-300"
          />
          <button
            onClick={handleEmailAuth}
            disabled={loading}
            className="w-full px-4 py-3 rounded-lg bg-gray-900 text-white font-medium hover:bg-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Please wait...' : isSignUp ? 'Create Account' : 'Sign In with Email'}
          </button>
        </div>

        <div className="mt-4 text-xs text-gray-500 text-center">
          <p>OAuth config hints:</p>
          <p className="mt-1">
            Supabase redirect target: <code className="bg-gray-100 px-1 rounded">{authRedirectTo}</code>
          </p>
          <p className="mt-1">
            Google Authorized redirect URI: <code className="bg-gray-100 px-1 rounded">{googleCallbackUrl}</code>
          </p>
        </div>
      </div>
    </div>
  )
}
