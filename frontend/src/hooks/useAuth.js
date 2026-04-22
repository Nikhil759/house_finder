import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { identifyUser, resetPostHog, posthog } from '../lib/posthog'

const OWNER_EMAIL = 'bn5799@gmail.com'

function applyOwnerFlag(user) {
  if (user?.email === OWNER_EMAIL) {
    posthog.register({ internal_user: true })
    localStorage.setItem('posthog_internal_user', 'true')
  }
}

export function useAuth() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
      if (session?.user) {
        identifyUser(session.user.id, { email: session.user.email })
        applyOwnerFlag(session.user)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setUser(session?.user ?? null)
        setLoading(false)
        if (session?.user) {
          identifyUser(session.user.id, { email: session.user.email })
          applyOwnerFlag(session.user)
        } else if (event === 'SIGNED_OUT') {
          resetPostHog()
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  const signInWithGoogle = async (redirectPath) => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + (redirectPath ?? window.location.pathname),
      }
    })
  }

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  return { user, loading, signInWithGoogle, signOut }
}
