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
//   save_characters       { characters: [...] } -> { ok: true }   (full set replace)
//   upsert_characters      { characters: [...] } -> { ok: true }   (partial, no removals)
//   get_chat               { characterId } -> { messages: [...] }
//   save_chat              { characterId, messages: [...] } -> { ok: true }
//   delete_chat            { characterId } -> { ok: true }
//   get_gallery            { characterId } -> { gallery: [...] }
//   save_gallery           { characterId, gallery: [...] } -> { ok: true }
//   delete_gallery         { characterId } -> { ok: true }
//   delete_character       { characterId } -> { ok: true } (also deletes chat + gallery)
//   get_site_config        -> { config: {...} }
//   save_site_config       { config: {...} } -> { ok: true }
// ═══════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = Deno.env.get('ALLOWED_ORIGIN') || '*';
const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGINS,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

const SITE_CONFIG_ID = '__site_config__';

function toRows(characters: any[]) {
  const updated_at = new Date().toISOString();
  return characters.map((c: any) => ({ id: c.id, data: c, updated_at }));
}

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

      case 'upsert_characters': {
        // Partial write: only touches the rows supplied, never removes anything.
        // This is the hot path — a single character changing mid-conversation
        // should not rewrite the whole table.
        const characters = (body.characters || []).filter((c: any) => c && c.id);
        if (characters.length === 0) return json({ ok: true });
        const { error } = await supabase.from('characters').upsert(toRows(characters));
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      case 'save_characters': {
        // Full set replace. Writes first and prunes second, so a failure part
        // way through leaves the table stale rather than empty — the previous
        // delete-all-then-insert had a window where every character was gone,
        // and a failed insert made that permanent.
        const characters = (body.characters || []).filter((c: any) => c && c.id);
        if (characters.length > 0) {
          const { error: upErr } = await supabase.from('characters').upsert(toRows(characters));
          if (upErr) return json({ error: upErr.message }, 500);
        }

        const { data: existing, error: exErr } = await supabase.from('characters').select('id');
        if (exErr) return json({ error: exErr.message }, 500);

        const keep = new Set(characters.map((c: any) => c.id));
        const stale = (existing || []).map((r: any) => r.id).filter((id: string) => !keep.has(id));
        if (stale.length > 0) {
          const { error: delErr } = await supabase.from('characters').delete().in('id', stale);
          if (delErr) return json({ error: delErr.message }, 500);
        }
        return json({ ok: true });
      }

      case 'delete_character': {
        const { characterId } = body;
        if (!characterId) return json({ error: 'characterId required' }, 400);
        const { error } = await supabase.from('characters').delete().eq('id', characterId);
        if (error) return json({ error: error.message }, 500);
        await supabase.from('chats').delete().eq('character_id', characterId);
        await supabase.from('galleries').delete().eq('character_id', characterId);
        return json({ ok: true });
      }

      // Site config — the editable prompts, slider definitions and tier
      // phrases that settings.html writes and index.html reads at boot. It is
      // a single document, so it rides in the chats table under a reserved
      // character_id rather than needing a table of its own; the id is
      // prefixed so it can never collide with a real character.
      case 'get_site_config': {
        const { data, error } = await supabase.from('chats').select('data').eq('character_id', SITE_CONFIG_ID).maybeSingle();
        if (error) return json({ error: error.message }, 500);
        const config = data?.data;
        return json({ config: (config && !Array.isArray(config) && typeof config === 'object') ? config : {} });
      }

      case 'save_site_config': {
        const { config } = body;
        if (!config || typeof config !== 'object' || Array.isArray(config)) {
          return json({ error: 'config must be an object' }, 400);
        }
        const { error } = await supabase.from('chats').upsert({
          character_id: SITE_CONFIG_ID,
          data: config,
          updated_at: new Date().toISOString(),
        });
        if (error) return json({ error: error.message }, 500);
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
