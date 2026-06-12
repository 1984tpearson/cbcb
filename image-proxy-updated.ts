// VALDENMERE — IMAGE PROXY
// Supabase Edge Function: proxies Dezgo requests
// so the API key never reaches the browser.
//
// Deploy: supabase functions deploy image-proxy
// Secret: supabase secrets set DEZGO_API_KEY=your-key
// ═══════════════════════════════════════════════════

const DEZGO_URL_DEFAULT = 'https://api.dezgo.com/text2image_sdxl';
const DEZGO_URL_LIGHTNING = 'https://api.dezgo.com/text2image_sdxl_lightning';
const DEZGO_URL_IMAGE2IMAGE = 'https://api.dezgo.com/image2image';
const ALLOWED_ORIGINS = Deno.env.get('ALLOWED_ORIGIN') || '*';

Deno.serve(async (req: Request) => {
  // ── CORS preflight ──────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': ALLOWED_ORIGINS,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
      }
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', {
      status: 405,
      headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGINS },
    });
  }

  // ── Read FormData from the browser ─────────────
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return new Response('Invalid form data', {
      status: 400,
      headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGINS },
    });
  }

  const apiKey = Deno.env.get('DEZGO_API_KEY');
  if (!apiKey) {
    return new Response('Server misconfiguration', {
      status: 500,
      headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGINS },
    });
  }

  // ── Forward to Dezgo ────────────────────────────
  // Allow caller to specify which endpoint via 'dezgo_endpoint' field
  const endpointHint = formData.get('dezgo_endpoint') as string | null;
  formData.delete('dezgo_endpoint'); // don't forward this to Dezgo

  let DEZGO_URL = DEZGO_URL_DEFAULT;
  if (endpointHint === 'lightning') DEZGO_URL = DEZGO_URL_LIGHTNING;
  else if (endpointHint === 'image2image') DEZGO_URL = DEZGO_URL_IMAGE2IMAGE;

  const upstream = await fetch(DEZGO_URL, {
    method: 'POST',
    headers: {
      'X-Dezgo-Key': apiKey,
    },
    body: formData,
  });

  if (!upstream.ok) {
    const errText = await upstream.text();
    return new Response(errText, {
      status: upstream.status,
      headers: {
        'Access-Control-Allow-Origin': ALLOWED_ORIGINS,
        'Content-Type': 'text/plain',
      },
    });
  }

  // ── Return the image blob ───────────────────────
  const imageBlob = await upstream.arrayBuffer();

  return new Response(imageBlob, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS,
    }
  });
});
