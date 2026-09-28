export interface PoolSession {
  signedIn: boolean
  userId: string | null
  username: string | null
  isAdmin: boolean
  getToken: () => Promise<string | null>
  signIn: () => void
  signOut: () => void
  setUsername: (username: string) => Promise<void>
}
