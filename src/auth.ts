import { getSupabase } from './supabaseClient'
import type { User, AuthChangeEvent, Session } from '@supabase/supabase-js'

export interface AuthUser {
  id: string
  email?: string
  displayName?: string
  avatarUrl?: string
  provider: 'google' | 'email'
}

export interface AuthState {
  user: AuthUser | null
  loading: boolean
}

let currentAuthState: AuthState = {
  user: null,
  loading: true
}

const authListeners: Array<(user: AuthUser | null) => void> = []

// Convert Supabase User to our AuthUser format
function mapSupabaseUser(user: User | null): AuthUser | null {
  if (!user) return null

  const metadata = user.user_metadata || {}
  const provider = user.app_metadata?.provider || 'email'

  return {
    id: user.id,
    email: user.email,
    displayName: metadata.full_name || metadata.name || user.email?.split('@')[0] || 'Player',
    avatarUrl: metadata.avatar_url || metadata.picture,
    provider: provider === 'google' ? 'google' : 'email'
  }
}

// Notify all listeners of auth state change
function notifyListeners(user: AuthUser | null) {
  authListeners.forEach((listener) => listener(user))
}

// Initialize auth and set up listener
export async function initAuth(): Promise<void> {
  const client = getSupabase()
  if (!client) {
    currentAuthState.loading = false
    return
  }

  // Get initial session
  const {
    data: { session }
  } = await client.auth.getSession()
  currentAuthState.user = mapSupabaseUser(session?.user ?? null)
  currentAuthState.loading = false

  // Listen for auth changes
  client.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
    currentAuthState.user = mapSupabaseUser(session?.user ?? null)
    notifyListeners(currentAuthState.user)
  })
}

export function getCurrentUser(): AuthUser | null {
  return currentAuthState.user
}

export function isAuthenticated(): boolean {
  return currentAuthState.user !== null
}

// Google OAuth sign in
export async function signInWithGoogle(): Promise<void> {
  const client = getSupabase()
  if (!client) throw new Error('Supabase not configured')

  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin
    }
  })

  if (error) throw error
}

// Email/Password sign up
export async function signUpWithEmail(email: string, password: string): Promise<void> {
  const client = getSupabase()
  if (!client) throw new Error('Supabase not configured')

  const { error } = await client.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: window.location.origin
    }
  })

  if (error) throw error
}

// Email/Password sign in
export async function signInWithEmail(email: string, password: string): Promise<void> {
  const client = getSupabase()
  if (!client) throw new Error('Supabase not configured')

  const { error } = await client.auth.signInWithPassword({
    email,
    password
  })

  if (error) throw error
}

// Sign out
export async function signOut(): Promise<void> {
  const client = getSupabase()
  if (!client) throw new Error('Supabase not configured')

  const { error } = await client.auth.signOut()
  if (error) throw error
}

// Subscribe to auth state changes
export function onAuthStateChange(callback: (user: AuthUser | null) => void): () => void {
  authListeners.push(callback)
  // Return unsubscribe function
  return () => {
    const index = authListeners.indexOf(callback)
    if (index > -1) authListeners.splice(index, 1)
  }
}
