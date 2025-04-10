import { createClient } from "@supabase/supabase-js";
import { Database } from "@/lib/types/supabase"; // Generate types from your schema: npx supabase gen types typescript --project-id <your-project-ref> --schema public > src/lib/types/supabase.ts

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://xowburlimatwsdwqmasj.supabase.co";
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhvd2J1cmxpbWF0d3Nkd3FtYXNqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NDI1MzQyNywiZXhwIjoyMDU5ODI5NDI3fQ.wX5ojvV0Gcfht2Blr7KYvZULJL2_kDdk2AVJRE-E91E";

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Supabase URL or Service Role Key is missing in env variables."
  );
}

// Create a single supabase client for interacting with your database
export const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
  auth: {
    // Required for RLS using service key, but doesn't persist user sessions
    persistSession: false,
    autoRefreshToken: false
  }
});
