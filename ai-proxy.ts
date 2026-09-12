// The language-model proxy. Keeps the OpenRouter key server-side; the app
// posts an OpenRouter chat-completions body and gets the reply back.
//
// Deploying is manual, exactly as with the other edge functions — this file is
// the source of what is deployed, not proof of what is running. Check the live
// version before assuming they match.
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const body = await req.json();
  const apiKey = Deno.env.get('OPENROUTER_API_KEY');

  const upstream = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://valdenmere.game',
    },
    body: JSON.stringify(body),
  });

  // A streaming request is handed straight back as the server-sent event
  // stream OpenRouter is already producing — no parsing here, so a change to
  // their event shape needs nothing redeployed. Buffering it with .json()
  // would defeat the entire point: the reply would still arrive in one piece,
  // just later.
  //
  // Only when the caller asked for it. Everything else — the trackers, the
  // scene and wardrobe readers, the openings — wants one JSON object and gets
  // exactly what it got before.
  if (body && body.stream === true && upstream.ok && upstream.body) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        ...CORS,
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        // Supabase sits behind a proxy that will happily buffer a response and
        // hand it over whole, which looks exactly like no streaming at all.
        'X-Accel-Buffering': 'no',
      },
    });
  }

  // An upstream error on a streaming request lands here too, so the client
  // reads a normal JSON error rather than an empty stream.
  const data = await upstream.json();
  return new Response(JSON.stringify(data), {
    status: upstream.status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
