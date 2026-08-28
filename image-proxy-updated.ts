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
const DEZGO_URL_IMAGE2IMAGE_SDXL = 'https://api.dezgo.com/image2image_sdxl';
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

  // Shared-token gate, matching data-proxy. Without this anyone who finds this
  // URL can spend the Dezgo key indefinitely.
  const expectedToken = Deno.env.get('ACCESS_TOKEN');
  const token = formData.get('token');
  formData.delete('token'); // never forward to Dezgo
  if (!expectedToken || token !== expectedToken) {
    return new Response('Unauthorized', {
      status: 401,
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
  // Every model in the client's list is SDXL, so img2img has to go to the SDXL
  // variant — the plain image2image endpoint only accepts SD1.5-family models.
  else if (endpointHint === 'image2image_sdxl') DEZGO_URL = DEZGO_URL_IMAGE2IMAGE_SDXL;

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
