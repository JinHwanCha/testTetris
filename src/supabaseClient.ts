import { createClient, SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

let client: SupabaseClient | undefined

export function getSupabase(): SupabaseClient | undefined {
  if (!url || !anonKey) return undefined
  if (!client) {
    client = createClient(url, anonKey)
  }
  return client
}
