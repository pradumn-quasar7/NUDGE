// Pinned third-party dependencies for all edge functions (single place to bump).
export { createClient } from "npm:@supabase/supabase-js@2.117.2";
export type { SupabaseClient, User } from "npm:@supabase/supabase-js@2.117.2";
export { corsHeaders } from "npm:@supabase/supabase-js@2.117.2/cors";

export { default as Anthropic } from "npm:@anthropic-ai/sdk@0.131.0";

export { z } from "npm:zod@4.6.5";
