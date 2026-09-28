import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider, useAuth, useClerk, useUser } from '@clerk/react'
import App, { type PoolSession } from './App'
import './style.css'

const key = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined
const demo = import.meta.env.DEV && !key

function ClerkApp() {
  const { isSignedIn, userId, getToken } = useAuth()
  const { user } = useUser()
  const clerk = useClerk()
  const [isAdmin, setIsAdmin] = useState(false)
  useEffect(() => {
    if (!isSignedIn) { setIsAdmin(false); return }
    let cancelled = false
    void getToken().then((token) => fetch('/api/me', { headers: token ? { authorization: `Bearer ${token}` } : {} }))
      .then((response) => response.ok ? response.json() as Promise<{ isAdmin: boolean }> : null)
      .then((result) => { if (!cancelled) setIsAdmin(!!result?.isAdmin) })
      .catch(() => { if (!cancelled) setIsAdmin(false) })
    return () => { cancelled = true }
  }, [isSignedIn, userId, getToken])
  const session: PoolSession = {
    signedIn: !!isSignedIn,
    userId: userId ?? null,
    username: user?.username ?? null,
    isAdmin,
    getToken: async () => getToken(),
    signIn: () => clerk.openSignIn(),
    signOut: () => { void clerk.signOut() },
    setUsername: async (username) => { await user?.update({ username }); await user?.reload() },
  }
  return <App session={session} demo={false} />
}

function DemoApp() {
  const [signedIn, setSignedIn] = useState(true)
  const [username, setUsername] = useState('rinkside_77')
  const session: PoolSession = {
    signedIn,
    userId: signedIn ? 'demo-user' : null,
    username: signedIn ? username : null,
    isAdmin: false,
    getToken: async () => null,
    signIn: () => setSignedIn(true),
    signOut: () => setSignedIn(false),
    setUsername: async (next) => setUsername(next),
  }
  return <App session={session} demo />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {key ? <ClerkProvider publishableKey={key} afterSignOutUrl="/"><ClerkApp /></ClerkProvider>
      : demo ? <DemoApp /> : <div className="configuration-error">Clerk is not configured for this site.</div>}
  </StrictMode>,
)
