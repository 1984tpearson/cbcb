// VALDENMERE — DATA PROXY
// Supabase Edge Function: CRUD for characters / chats / galleries,
// gated by a shared access token (ACCESS_TOKEN secret).
//
// Deploy: supabase functions deploy data-proxy
// Secrets: ACCESS_TOKEN, (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are auto-injected)
//
// Request body: { action, token, ...payload }
//
// Actions:
//   get_characters        -> { characters: [...] }
//   save_characters       { characters: [...] } -> { ok: true }
//   get_chat               { characterId } -> { messages: [...] }
//   save_chat              { characterId, messages: [...] } -> { ok: true }
//   delete_chat            { characterId } -> { ok: true }
//   get_gallery            { characterId } -> { gallery: [...] }
//   save_gallery           { characterId, gallery: [...] } -> { ok: true }
//   delete_gallery         { characterId } -> { ok: true }
//   delete_character       { characterId } -> { ok: true } (also deletes chat + gallery)
// ═══════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = Deno.env.get('ALLOWED_ORIGIN') || '*';
const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGINS,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const expectedToken = Deno.env.get('ACCESS_TOKEN');
  if (!expectedToken || body.token !== expectedToken) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server misconfiguration' }, 500);
  const supabase = createClient(supabaseUrl, serviceKey);

  const { action } = body;

  try {
    switch (action) {
      case 'get_characters': {
        const { data, error } = await supabase.from('characters').select('id, data');
        if (error) return json({ error: error.message }, 500);
        return json({ characters: (data || []).map((row: any) => row.data) });
      }

      case 'save_characters': {
        const characters = body.characters || [];
        // Replace entire set: delete all, then insert
        const { error: delErr } = await supabase.from('characters').delete().neq('id', '');
        if (delErr) return json({ error: delErr.message }, 500);
        if (characters.length > 0) {
          const rows = characters.map((c: any) => ({ id: c.id, data: c, updated_at: new Date().toISOString() }));
          const { error: insErr } = await supabase.from('characters').insert(rows);
          if (insErr) return json({ error: insErr.message }, 500);
        }
        return json({ ok: true });
      }

      case 'delete_character': {
        const { characterId } = body;
        await supabase.from('characters').delete().eq('id', characterId);
        await supabase.from('chats').delete().eq('character_id', characterId);
        await supabase.from('galleries').delete().eq('character_id', characterId);
        return json({ ok: true });
      }

      case 'get_chat': {
        const { characterId } = body;
        const { data, error } = await supabase.from('chats').select('data').eq('character_id', characterId).maybeSingle();
        if (error) return json({ error: error.message }, 500);
        return json({ messages: data?.data || [] });
      }

      case 'save_chat': {
        const { characterId, messages } = body;
        const { error } = await supabase.from('chats').upsert({
          character_id: characterId,
          data: messages,
          updated_at: new Date().toISOString(),
        });
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      case 'delete_chat': {
        const { characterId } = body;
        await supabase.from('chats').delete().eq('character_id', characterId);
        return json({ ok: true });
      }

      case 'get_gallery': {
        const { characterId } = body;
        const { data, error } = await supabase.from('galleries').select('data').eq('character_id', characterId).maybeSingle();
        if (error) return json({ error: error.message }, 500);
        return json({ gallery: data?.data || [] });
      }

      case 'save_gallery': {
        const { characterId, gallery } = body;
        const { error } = await supabase.from('galleries').upsert({
          character_id: characterId,
          data: gallery,
          updated_at: new Date().toISOString(),
        });
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      case 'delete_gallery': {
        const { characterId } = body;
        await supabase.from('galleries').delete().eq('character_id', characterId);
        return json({ ok: true });
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
