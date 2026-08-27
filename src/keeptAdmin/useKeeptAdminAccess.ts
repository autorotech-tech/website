import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const BOOTSTRAP_TOKEN_KEY = 'bookmarks_bro_bootstrap_token'

/** BB bootstrap token, baked agent API key, or Swoop profiles.role=admin */
export function useKeeptAdminAccess(): boolean | null {
  const navigate = useNavigate()
  const [allowed, setAllowed] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false

    const grant = () => {
      if (!cancelled) setAllowed(true)
    }

    const check = async () => {
      if (localStorage.getItem(BOOTSTRAP_TOKEN_KEY)?.trim()) {
        grant()
        return
      }
      if (import.meta.env.VITE_BOOKMARKS_API_KEY?.trim()) {
        grant()
        return
      }

      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        navigate('/login', { replace: true })
        return
      }

      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .single()

      if (data?.role === 'admin') {
        grant()
      } else {
        navigate('/login', { replace: true })
      }
    }

    void check()
    return () => {
      cancelled = true
    }
  }, [navigate])

  return allowed
}
