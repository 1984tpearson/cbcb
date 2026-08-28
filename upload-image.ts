// VALDENMERE — UPLOAD IMAGE
// Supabase Edge Function: uploads a base64 image to Supabase Storage
// and returns the public URL.
//
// Deploy: supabase functions deploy upload-image
// Requires bucket: "character-images" (public)
// Uses built-in env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ═══════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = Deno.env.get('ALLOWED_ORIGIN') || '*';
const BUCKET = 'character-images';
// ~12MB of base64 ≈ 9MB of image bytes — comfortably above a 1024px PNG.
const MAX_BASE64_LENGTH = 12_000_000;
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGINS,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  let body: { dataUrl?: string; filename?: string; token?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Shared-token gate, matching data-proxy. Without this anyone who finds this
  // URL can write arbitrary files into the public bucket.
  const expectedToken = Deno.env.get('ACCESS_TOKEN');
  if (!expectedToken || body.token !== expectedToken) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { dataUrl, filename } = body;
  if (!dataUrl || !dataUrl.startsWith('data:')) {
    return new Response(JSON.stringify({ error: 'dataUrl must be a base64 data URL' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Parse "data:image/png;base64,XXXX"
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!match) {
    return new Response(JSON.stringify({ error: 'Malformed data URL' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const mime = match[1];
  const base64Data = match[2];

  // Cap before decoding — atob on an unbounded string allocates the whole
  // payload in memory and will take the function down.
  if (base64Data.length > MAX_BASE64_LENGTH) {
    return new Response(JSON.stringify({ error: 'Image too large' }), {
      status: 413,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!ALLOWED_MIME.has(mime)) {
    return new Response(JSON.stringify({ error: `Unsupported image type: ${mime}` }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let bytes: Uint8Array;
  try {
    const binary = atob(base64Data);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } catch {
    return new Response(JSON.stringify({ error: 'Failed to decode base64' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: 'Server misconfiguration' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const ext = mime.split('/')[1] || 'png';
  const safeName = (filename || `img_${Date.now()}_${Math.random().toString(36).slice(2)}`).replace(/[^a-zA-Z0-9_\-\.]/g, '');
  const path = `${safeName}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    // upsert stays off: filenames carry a timestamp + random suffix, so a
    // collision means someone is trying to overwrite an existing image.
    .upload(path, bytes, { contentType: mime, upsert: false });

  if (uploadError) {
    return new Response(JSON.stringify({ error: uploadError.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);

  return new Response(JSON.stringify({ url: urlData.publicUrl }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
