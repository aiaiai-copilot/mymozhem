import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

// Load .env for Node.js scripts (no-op in browser)
if (typeof process !== 'undefined' && process.env) {
  config()
}

// Support both Vite (import.meta.env) and Node.js (process.env)
const supabaseUrl =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) ||
  (typeof process !== 'undefined' && process.env.VITE_SUPABASE_URL) ||
  'https://placeholder.supabase.co'

const supabaseAnonKey =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY) ||
  (typeof process !== 'undefined' && process.env.VITE_SUPABASE_ANON_KEY) ||
  'placeholder-key'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
