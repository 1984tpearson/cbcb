// PersonaChat — IMAGE PROXY
// Supabase Edge Function: runs a Wiro AI image generation task and proxies
// the result back, so the API key never reaches the browser.
//
// Deploy: supabase functions deploy image-proxy
// Secret: supabase secrets set WIRO_API_KEY=your-key
// ═══════════════════════════════════════════════════
//
// Three actions, selected by `action` in the JSON body:
//
//   submit  → start a Wiro task, return { taskId } immediately
//   status  → check a task: 202 while running, { imageUrl } when done
//   dezgo   → run a Dezgo generation and return { dataUrl } in one call
//   imagesearch → search the web for images, return { results }
//   (none)  → legacy blocking mode: submit, then poll inline until done
//
// The split exists because this function has a wall-clock limit. Blocking mode
// polls inline, so a generation slower than the budget returned 504 while Wiro
// went on to finish AND BILL the image — the result was simply lost, and
// retrying paid for it twice. With submit/status the waiting happens in the
// browser, which has no such limit, so a slow generation is just more polls.
// Legacy mode is kept only so an un-updated client keeps working.

// Allowlisted models. The slug is never interpolated into the URL from the
// request directly — a caller could otherwise point this at any Wiro endpoint
// and spend the key on it. Keep in step with models.image in site-config.js.
const WIRO_MODELS: Record<string, string> = {
  'seedream-v5-pro-uncensored': 'https://api.wiro.ai/v1/Run/bytedance/seedream-v5-pro-uncensored',
  'seedream-v5-lite-uncensored': 'https://api.wiro.ai/v1/Run/bytedance/seedream-v5-lite-uncensored',
  'seedream-v4-5-uncensored': 'https://api.wiro.ai/v1/Run/bytedance/seedream-v4-5-uncensored',
};
const DEFAULT_MODEL = 'seedream-v5-pro-uncensored';

// ── Dezgo ──────────────────────────────────────────────────────────────
// A second provider, used by wardrobe.html for garment flat lays. Dezgo has no
// task queue: the request blocks and comes back with the image bytes, so there
// is nothing to poll and the whole thing is one call. That also means the
// edge function's wall-clock limit is the ceiling on generation time — fine
// for the endpoints below, which finish in seconds, and the reason a slow
// Dezgo model has no business being added here.
//
// Endpoints are allowlisted for the same reason the Wiro models are: the path
// is never interpolated from the request, or a caller could point this at any
// URL on the host and spend the key on it.
const DEZGO_ENDPOINTS: Record<string, string> = {
  text2image: 'https://api.dezgo.com/text2image',
  text2image_sdxl: 'https://api.dezgo.com/text2image_sdxl',
  text2image_flux: 'https://api.dezgo.com/text2image_flux',
  // SDXL Lightning: 1024px at a handful of steps, so it prices below plain
  // SDXL for the same resolution. Dezgo's catalogue lists five models on it,
  // two of them photoreal, and none of them were reachable while this endpoint
  // was missing from the allowlist.
  text2image_sdxl_lightning: 'https://api.dezgo.com/text2image_sdxl_lightning',
};
const DEZGO_DEFAULT_ENDPOINT = 'text2image_flux';

// Where Dezgo publishes its own model catalogue. Tried in order, because the
// path is documented rather than verified from here — the first one that
// answers with JSON wins, and the response says which did, so a wrong guess is
// visible instead of silent. Hardcoded, never taken from the request: a
// caller-supplied path would make this an open proxy for the API key.
const DEZGO_INFO_PATHS = ['/info', '/models'];

// ── Image search ───────────────────────────────────────────────────────
// Finding a flat lay that already exists, rather than generating one. Behind a
// provider switch because the free search landscape is unstable: Google's
// Custom Search is closed to new signups and ends in 2027, and Brave dropped
// its free tier. Openverse needs no key at all, which is why it is the
// default; a keyed provider can be added here without touching the client.
//
// SERPAPI_KEY is optional. When it is absent the provider simply is not
// offered, rather than the whole action failing.
const SEARCH_PROVIDERS = ['auto', 'openverse', 'wikimedia', 'serpapi', 'serper'] as const;

// Sent on every search. An API refusing an unidentified caller is ordinary,
// and Deno's default agent string is exactly the kind a WAF turns away — which
// is one of the two explanations for Openverse answering 401 to a request its
// own documentation says should work anonymously.
const SEARCH_UA = 'ValdenmereWardrobe/1.0 (personal wardrobe tool)';

async function searchOpenverse(query: string, limit: number) {
  const url = 'https://api.openverse.org/v1/images/?q=' + encodeURIComponent(query) +
    '&page_size=' + limit;
  const headers: Record<string, string> = { 'Accept': 'application/json', 'User-Agent': SEARCH_UA };
  // Optional: registering an Openverse application is free and raises the rate
  // limit. If the credentials are present they are exchanged for a bearer
  // token; if they are not, the request goes out anonymously as before.
  const clientId = Deno.env.get('OPENVERSE_CLIENT_ID');
  const clientSecret = Deno.env.get('OPENVERSE_CLIENT_SECRET');
  if (clientId && clientSecret) {
    try {
      const tokenRes = await fetch('https://api.openverse.org/v1/auth_tokens/token/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': SEARCH_UA },
        body: new URLSearchParams({
          grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret,
        }).toString(),
      });
      if (tokenRes.ok) {
        const t = await tokenRes.json();
        if (t?.access_token) headers['Authorization'] = 'Bearer ' + t.access_token;
      }
    } catch { /* anonymous is still worth trying */ }
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    // The body is the diagnosis. A 401 that says "invalid token" is a
    // different problem from one that says nothing at all, and without it the
    // only way to tell them apart is another deploy.
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`Openverse returned HTTP ${res.status}${detail ? ': ' + detail : ''}`);
  }
  const body = await res.json();
  const results = Array.isArray(body?.results) ? body.results : [];
  return results.map((r: Record<string, unknown>) => ({
    // thumbnail for the picker, url for the copy that gets kept: the full
    // image can be many megabytes and the grid only needs something small.
    url: r.url as string,
    thumbnail: (r.thumbnail as string) || (r.url as string),
    title: (r.title as string) || '',
    source: (r.source as string) || '',
    license: (r.license as string) || '',
    // Where the image actually lives, so its terms can be checked by a human.
    page: (r.foreign_landing_url as string) || '',
  })).filter((r: { url: string }) => typeof r.url === 'string' && r.url);
}

// Wikimedia Commons. No key, no account, no token — the one image source that
// cannot develop an authentication requirement, which after Openverse is worth
// something. Coverage of commercial-style product photography is thin, but a
// thin result beats a 401.
async function searchWikimedia(query: string, limit: number) {
  const url = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({
    action: 'query', format: 'json', origin: '*',
    generator: 'search', gsrsearch: 'filetype:bitmap ' + query,
    gsrnamespace: '6', gsrlimit: String(limit),
    prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '320',
  }).toString();
  const res = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': SEARCH_UA } });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`Wikimedia returned HTTP ${res.status}${detail ? ': ' + detail : ''}`);
  }
  const body = await res.json();
  const pages = body?.query?.pages && typeof body.query.pages === 'object'
    ? Object.values(body.query.pages) as Array<Record<string, unknown>>
    : [];
  return pages.map((p) => {
    const info = (p.imageinfo as Array<Record<string, unknown>>)?.[0] || {};
    const meta = (info.extmetadata as Record<string, { value?: string }>) || {};
    return {
      url: (info.url as string) || '',
      thumbnail: (info.thumburl as string) || (info.url as string) || '',
      title: String(p.title || '').replace(/^File:/, ''),
      source: 'wikimedia',
      license: meta.LicenseShortName?.value || '',
      page: (info.descriptionurl as string) || '',
    };
  }).filter((r) => r.url);
}

// Serper: Google Images behind a key. The keyless indexes are openly-licensed
// corpora — an encyclopedia's media library and a Creative Commons catalogue —
// and neither carries commercial product photography, which is what a flat lay
// of a specific garment is. No amount of falling back between them fixes that;
// only a real image search has the range.
async function searchSerper(query: string, limit: number, key: string) {
  const res = await fetch('https://google.serper.dev/images', {
    method: 'POST',
    headers: { 'X-API-KEY': key, 'Content-Type': 'application/json', 'User-Agent': SEARCH_UA },
    body: JSON.stringify({ q: query, num: limit }),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`Serper returned HTTP ${res.status}${detail ? ': ' + detail : ''}`);
  }
  const body = await res.json();
  // Defensive: this shape has not been seen from here, so anything missing an
  // image URL is dropped rather than turned into a broken tile.
  const results = Array.isArray(body?.images) ? body.images : [];
  return results.slice(0, limit).map((r: Record<string, unknown>) => ({
    url: (r.imageUrl as string) || (r.thumbnailUrl as string) || '',
    thumbnail: (r.thumbnailUrl as string) || (r.imageUrl as string) || '',
    title: (r.title as string) || '',
    source: (r.source as string) || 'google',
    license: '',
    page: (r.link as string) || '',
  })).filter((r: { url: string }) => typeof r.url === 'string' && r.url);
}

async function searchSerpapi(query: string, limit: number, key: string) {
  const url = 'https://serpapi.com/search.json?engine=google_images&ijn=0&q=' +
    encodeURIComponent(query) + '&api_key=' + encodeURIComponent(key);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SerpApi returned HTTP ${res.status}`);
  const body = await res.json();
  const results = Array.isArray(body?.images_results) ? body.images_results : [];
  return results.slice(0, limit).map((r: Record<string, unknown>) => ({
    url: (r.original as string) || (r.thumbnail as string),
    thumbnail: (r.thumbnail as string) || (r.original as string),
    title: (r.title as string) || '',
    source: (r.source as string) || '',
    license: '',
    page: (r.link as string) || '',
  })).filter((r: { url: string }) => typeof r.url === 'string' && r.url);
}

// Which body parameters may be forwarded. The client decides the values and
// which of them apply to the model it picked — that table lives in
// site-config.js, so a parameter Dezgo renames or a model that turns out not
// to accept one is a config edit rather than a redeploy of this function.
// The allowlist is here because the client is not trusted to name fields.
const DEZGO_ALLOWED_PARAMS = new Set([
  'prompt', 'negative_prompt', 'model', 'width', 'height',
  'steps', 'guidance', 'sampler', 'seed', 'format', 'transparent_background', 'upscale',
]);
const WIRO_TASK_DETAIL_URL = 'https://api.wiro.ai/v1/Task/Detail';
const ALLOWED_ORIGINS = Deno.env.get('ALLOWED_ORIGIN') || '*';

// Only used by legacy blocking mode. Kept well inside the edge function's
// wall-clock limit — raising it is not a fix, it just moves the cliff.
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 45; // ~90s budget

// Per Wiro's docs the terminal statuses are task_postprocess_end and
// task_cancel; task_error is kept as a defensive extra. Everything else
// (task_queue, task_accept, task_assign, task_preprocess_*, task_start,
// task_output) means keep polling.
const TERMINAL_STATUSES = ['task_postprocess_end', 'task_cancel', 'task_error'];

function corsHeaders(extra: Record<string, string> = {}) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
    ...extra,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders({ 'Content-Type': 'application/json' }),
  });
}

// Ask Wiro about one task. Returns the task record, or null if the response
// was unusable (transient hiccup — the caller decides whether to retry), plus
// whether Wiro is rate limiting us.
//
// The throttle flag exists because this used to read the body and nothing
// else: a 429 has no tasklist, so it came back as null, which the status
// action reads as "no record yet, still pending". Being throttled was
// therefore indistinguishable from generating — the browser kept polling
// once a second at the exact moment it was being told to stop, and the wait
// was attributed to Wiro being slow, because nothing anywhere said otherwise.
async function fetchTask(taskId: string, apiKey: string) {
  const detailRes = await fetch(WIRO_TASK_DETAIL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ taskid: taskId }),
  });
  if (detailRes.status === 429) {
    // Retry-After is seconds or an HTTP date; only the numeric form is worth
    // honouring here, and an absent or unparseable one just means "back off".
    const header = Number(detailRes.headers.get('retry-after'));
    return { task: null, throttled: true, retryAfterSeconds: header > 0 ? header : null };
  }
  const detailJson = await detailRes.json().catch(() => null);
  const task = (detailJson?.tasklist?.[0] as Record<string, unknown> | undefined) || null;
  return { task, throttled: false, retryAfterSeconds: null };
}

// The finished task's image URL, or an error response. Handing back the URL
// rather than the bytes keeps the image off this function's critical path
// entirely — it used to download the whole file from Wiro's CDN and re-serve
// it, which is a second full transfer for no benefit.
function taskImageUrl(task: Record<string, unknown>) {
  // pexit is absent from the Task/Detail response of some models, so it can
  // only be treated as a failure when it is actually present and non-zero —
  // requiring it to equal '0' reported every successful run as a failure.
  const pexit = task.pexit;
  const failed = pexit !== undefined && pexit !== null && String(pexit) !== '0';
  if (task.status !== 'task_postprocess_end' || failed) {
    const debugErr = (task.debugerror as string) || (task.status as string) || 'unknown error';
    return { error: `Wiro generation failed: ${debugErr}` };
  }
  const outputs = (task.outputs as Array<Record<string, unknown>>) || [];
  const imageUrl = outputs[0]?.url as string | undefined;
  if (!imageUrl) return { error: 'Wiro task completed with no output' };
  return { imageUrl };
}

// Legacy blocking mode only: pipe the actual bytes back, as the old client expects.
async function respondWithImage(task: Record<string, unknown>, outputFormat: unknown) {
  const result = taskImageUrl(task);
  if (result.error) {
    return new Response(result.error, { status: 502, headers: corsHeaders() });
  }

  let imgRes: Response;
  try {
    imgRes = await fetch(result.imageUrl as string);
  } catch (e) {
    return new Response(`Failed to fetch generated image: ${e instanceof Error ? e.message : String(e)}`, {
      status: 502,
      headers: corsHeaders(),
    });
  }

  if (!imgRes.ok) {
    return new Response('Failed to fetch generated image from Wiro CDN', {
      status: 502,
      headers: corsHeaders(),
    });
  }

  const imageBuffer = await imgRes.arrayBuffer();
  const contentType = outputFormat === 'jpeg' ? 'image/jpeg' : 'image/png';
  return new Response(imageBuffer, {
    status: 200,
    headers: corsHeaders({ 'Content-Type': contentType }),
  });
}

Deno.serve(async (req: Request) => {
  // ── CORS preflight ──────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', {
      status: 405,
      headers: corsHeaders(),
    });
  }

  // ── Read JSON payload from the browser ──────────
  // Expected shape: { action?, taskId?, model?, prompt, inputImage?, resolution?, aspectRatio?, outputFormat?, watermark?, seed? }
  // For action 'dezgo': { action, endpoint?, params: { prompt, model, ... } }
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return new Response('Invalid JSON body', {
      status: 400,
      headers: corsHeaders(),
    });
  }

  const action = typeof payload.action === 'string' ? payload.action : '';

  // ── action: imagesearch ──────────────────────────
  // Ahead of every provider key check: this one may need no key at all.
  if (action === 'imagesearch') {
    const query = typeof payload.query === 'string' ? payload.query.trim() : '';
    if (!query) {
      return new Response('query is required', { status: 400, headers: corsHeaders() });
    }
    const requested = typeof payload.provider === 'string' ? payload.provider : 'openverse';
    if (!SEARCH_PROVIDERS.includes(requested as typeof SEARCH_PROVIDERS[number])) {
      return new Response(`Unknown search provider: ${requested}`, { status: 400, headers: corsHeaders() });
    }
    // Bounded here rather than trusted from the request: this is a page size
    // sent to somebody else's API, and an unbounded one is their problem
    // becoming ours.
    const limit = Math.max(1, Math.min(40, Number(payload.limit) || 20));

    try {
      if (requested === 'serper') {
        const key = Deno.env.get('SERPER_KEY');
        if (!key) {
          return new Response('Serper is not configured on the server (SERPER_KEY is not set)', {
            status: 503,
            headers: corsHeaders(),
          });
        }
        return json({ provider: 'serper', results: await searchSerper(query, limit, key) }, 200);
      }
      if (requested === 'serpapi') {
        const key = Deno.env.get('SERPAPI_KEY');
        if (!key) {
          return new Response('SerpApi is not configured on the server (SERPAPI_KEY is not set)', {
            status: 503,
            headers: corsHeaders(),
          });
        }
        return json({ provider: 'serpapi', results: await searchSerpapi(query, limit, key) }, 200);
      }
      if (requested === 'openverse') {
        return json({ provider: 'openverse', results: await searchOpenverse(query, limit) }, 200);
      }
      if (requested === 'wikimedia') {
        return json({ provider: 'wikimedia', results: await searchWikimedia(query, limit) }, 200);
      }

      // auto: the keyless providers in turn. One of them refusing should not
      // be the end of a search when the other is sitting there working, and
      // which one answered is reported rather than hidden — a result set is
      // only judgeable if you know where it came from. Every failure along the
      // way is carried, so a total miss says what each one actually said
      // instead of just "nothing".
      //
      // Keyed providers first, and not as a preference: the keyless ones index
      // openly-licensed material only, so their coverage of clothing is
      // whatever happens to have been donated. Setting one key is therefore
      // the entire configuration — no client change follows it, because this
      // order picks the better source the moment it can.
      const serperKey = Deno.env.get('SERPER_KEY');
      const serpapiKey = Deno.env.get('SERPAPI_KEY');
      const chain: Array<[string, () => Promise<unknown[]>]> = [];
      if (serperKey) chain.push(['serper', () => searchSerper(query, limit, serperKey)]);
      if (serpapiKey) chain.push(['serpapi', () => searchSerpapi(query, limit, serpapiKey)]);
      chain.push(['openverse', () => searchOpenverse(query, limit)]);
      chain.push(['wikimedia', () => searchWikimedia(query, limit)]);

      const tried: string[] = [];
      for (const [name, run] of chain) {
        try {
          const results = await run();
          if (results.length) return json({ provider: name, results, tried }, 200);
          tried.push(`${name}: no results`);
        } catch (e) {
          tried.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      return json({ provider: 'auto', results: [], tried }, 200);
    } catch (e) {
      return new Response(`Image search failed: ${e instanceof Error ? e.message : String(e)}`, {
        status: 502,
        headers: corsHeaders(),
      });
    }
  }

  // ── action: dezgo ────────────────────────────────
  // One call in, one image out. Handled before the Wiro key is looked at, so a
  // deployment holding only one of the two provider keys still serves the
  // provider it can.
  if (action === 'dezgo') {
    const dezgoKey = Deno.env.get('DEZGO_API_KEY');
    if (!dezgoKey) {
      return new Response('Dezgo is not configured on the server (DEZGO_API_KEY is not set)', {
        status: 503,
        headers: corsHeaders(),
      });
    }

    // ── dezgo: list ──
    // Dezgo's own catalogue, so the model dropdown stops being a list of ids
    // someone remembered. Returned as-is for the client to normalise: the
    // shape is not verified from here, and reshaping something unseen would
    // just hide whatever it actually is.
    if (payload.list === true) {
      const tried: string[] = [];
      for (const path of DEZGO_INFO_PATHS) {
        let infoRes: Response;
        try {
          infoRes = await fetch('https://api.dezgo.com' + path, { headers: { 'X-Dezgo-Key': dezgoKey } });
        } catch (e) {
          tried.push(path + ': ' + (e instanceof Error ? e.message : String(e)));
          continue;
        }
        if (!infoRes.ok) { tried.push(path + ': HTTP ' + infoRes.status); continue; }
        const text = await infoRes.text();
        try {
          return json({ source: path, info: JSON.parse(text) }, 200);
        } catch {
          tried.push(path + ': not JSON');
        }
      }
      return new Response('Could not read Dezgo\'s model list. Tried ' + tried.join('; '), {
        status: 502,
        headers: corsHeaders(),
      });
    }

    const endpointName = typeof payload.endpoint === 'string' ? payload.endpoint : DEZGO_DEFAULT_ENDPOINT;
    const endpointUrl = DEZGO_ENDPOINTS[endpointName];
    if (!endpointUrl) {
      return new Response(`Unknown Dezgo endpoint: ${endpointName}`, { status: 400, headers: corsHeaders() });
    }

    const params = (payload.params && typeof payload.params === 'object' && !Array.isArray(payload.params))
      ? payload.params as Record<string, unknown>
      : {};
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (!DEZGO_ALLOWED_PARAMS.has(key)) continue;
      if (value === undefined || value === null || value === '') continue;
      form.set(key, String(value));
    }
    if (!form.get('prompt')) {
      return new Response('prompt is required', { status: 400, headers: corsHeaders() });
    }

    let dezgoRes: Response;
    try {
      dezgoRes = await fetch(endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Dezgo-Key': dezgoKey,
        },
        body: form.toString(),
      });
    } catch (e) {
      return new Response(`Dezgo request failed: ${e instanceof Error ? e.message : String(e)}`, {
        status: 502,
        headers: corsHeaders(),
      });
    }

    if (!dezgoRes.ok) {
      // Passed through verbatim rather than summarised. Dezgo answers a wrong
      // parameter name with a message that says which one, and that message is
      // the whole diagnostic — the parameter table it refers to is editable in
      // site-config.js, so the person reading the error can act on it.
      const detail = await dezgoRes.text().catch(() => '');
      return new Response(`Dezgo error ${dezgoRes.status}: ${detail.slice(0, 500)}`, {
        status: dezgoRes.status >= 400 ? dezgoRes.status : 502,
        headers: corsHeaders(),
      });
    }

    // Dezgo answers with the image itself, not a URL, so the bytes have to
    // come back through here. Returned as a data URL for the browser to hand
    // to upload-image, which already takes one — the alternative is teaching
    // this function to write to Storage, which is upload-image's whole job.
    const contentType = dezgoRes.headers.get('content-type')?.split(';')[0] || 'image/png';
    if (!contentType.startsWith('image/')) {
      const detail = await dezgoRes.text().catch(() => '');
      return new Response(`Dezgo returned ${contentType}: ${detail.slice(0, 500)}`, {
        status: 502,
        headers: corsHeaders(),
      });
    }
    const bytes = new Uint8Array(await dezgoRes.arrayBuffer());
    // Chunked so a megabyte-scale image does not blow the argument limit on
    // String.fromCharCode, which takes one argument per byte.
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return json({ dataUrl: `data:${contentType};base64,${btoa(binary)}`, bytes: bytes.length }, 200);
  }

  const apiKey = Deno.env.get('WIRO_API_KEY');
  if (!apiKey) {
    return new Response('Server misconfiguration', {
      status: 500,
      headers: corsHeaders(),
    });
  }

  // ── action: status ───────────────────────────────
  // Poll an existing task. 202 while it is still running, the image URL when
  // it finishes. This is the call the browser repeats, so it must stay cheap.
  if (action === 'status') {
    const taskId = typeof payload.taskId === 'string' ? payload.taskId : '';
    if (!taskId) {
      return new Response('taskId is required', { status: 400, headers: corsHeaders() });
    }

    let detail: { task: Record<string, unknown> | null; throttled: boolean; retryAfterSeconds: number | null };
    try {
      detail = await fetchTask(taskId, apiKey);
    } catch (e) {
      return new Response(`Wiro task detail request failed: ${e instanceof Error ? e.message : String(e)}`, {
        status: 502,
        headers: corsHeaders(),
      });
    }

    // Still 202 — the task IS still running, and failing the generation over a
    // rate limit would throw away an image Wiro is going to finish and bill
    // for. But it is now labelled, so the client can back off instead of
    // adding to the traffic that caused it.
    if (detail.throttled) {
      return json({ status: 'pending', taskId, throttled: true, retryAfterSeconds: detail.retryAfterSeconds }, 202);
    }
    const task = detail.task;

    // No usable record yet. Treat as pending rather than an error — the task
    // may simply not be visible yet, and the client will ask again.
    if (!task) return json({ status: 'pending', taskId }, 202);

    if (!TERMINAL_STATUSES.includes(String(task.status))) {
      return json({ status: 'pending', taskId, taskStatus: task.status }, 202);
    }

    const result = taskImageUrl(task);
    if (result.error) {
      return new Response(result.error, { status: 502, headers: corsHeaders() });
    }
    // Wiro's own timings, so slowness can be attributed rather than guessed at:
    // queued is time spent waiting for a worker, generating is the model
    // actually running. If queued dominates there is nothing to tune here.
    const num = (v: unknown) => Number(v) || 0;
    const timing = {
      queuedSeconds: Math.max(0, num(task.starttime) - num(task.createtime)),
      generatingSeconds: num(task.elapsedseconds),
      postprocessSeconds: Math.max(0, num(task.postprocessendtime) - num(task.postprocessstarttime)),
    };
    return json({ status: 'done', imageUrl: result.imageUrl, timing }, 200);
  }

  // ── submit / legacy: build the run ───────────────
  const prompt = typeof payload.prompt === 'string' ? payload.prompt : '';
  if (!prompt.trim()) {
    return new Response('prompt is required', {
      status: 400,
      headers: corsHeaders(),
    });
  }

  const requestedModel = typeof payload.model === 'string' ? payload.model : DEFAULT_MODEL;
  const runUrl = WIRO_MODELS[requestedModel];
  if (!runUrl) {
    return new Response(`Unknown image model: ${requestedModel}`, {
      status: 400,
      headers: corsHeaders(),
    });
  }

  // Defaults deliberately conservative: 2k and 9:16 are accepted by every
  // model in the allowlist, where the old '1k' default was Pro-only.
  const runBody: Record<string, unknown> = {
    prompt,
    resolution: payload.resolution || '2k',
    aspectRatio: payload.aspectRatio || '9:16',
    maxImages: payload.maxImages ?? 1,
    watermark: payload.watermark ?? 'false',
  };
  // outputFormat is not a parameter on Lite or v4.5 — only forward it when the
  // caller actually asked for one.
  if (payload.outputFormat) {
    runBody.outputFormat = payload.outputFormat;
  }
  // inputImage is optional — a reference image URL (or comma-joined list of
  // URLs) for consistency. Omit entirely rather than sending an empty value.
  if (payload.inputImage) {
    runBody.inputImage = payload.inputImage;
  }
  // seed is optional — passed through so the client can force a fresh seed
  // per generation (e.g. on "Regenerate") instead of Wiro falling back to
  // whatever it defaults to when seed is omitted, which was producing
  // near-identical images across repeated calls with the same prompt.
  if (payload.seed !== undefined && payload.seed !== null) {
    runBody.seed = payload.seed;
  }

  // ── Kick off the run ─────────────────────────────
  let runRes: Response;
  try {
    runRes = await fetch(runUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(runBody),
    });
  } catch (e) {
    return new Response(`Wiro run request failed: ${e instanceof Error ? e.message : String(e)}`, {
      status: 502,
      headers: corsHeaders(),
    });
  }

  const runJson = await runRes.json().catch(() => null);
  if (!runRes.ok || !runJson?.result || !runJson?.taskid) {
    const errMsg = runJson?.errors?.[0]?.message || `HTTP ${runRes.status}`;
    return new Response(`Wiro run error: ${errMsg}`, {
      status: runRes.status >= 400 ? runRes.status : 502,
      headers: corsHeaders(),
    });
  }

  const taskId = runJson.taskid as string;

  // ── action: submit ───────────────────────────────
  // Hand the task id straight back and let the browser wait. This returns in
  // about a second, so it can never hit the wall-clock limit.
  if (action === 'submit') {
    return json({ taskId }, 200);
  }

  // ── legacy blocking mode ─────────────────────────
  let finalTask: Record<string, unknown> | null = null;
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);
    try {
      const { task, throttled, retryAfterSeconds } = await fetchTask(taskId, apiKey);
      if (throttled) {
        await sleep(Math.max(POLL_INTERVAL_MS, (retryAfterSeconds || 5) * 1000));
        continue;
      }
      if (!task) continue;
      if (TERMINAL_STATUSES.includes(String(task.status))) {
        finalTask = task;
        break;
      }
    } catch {
      continue; // transient network hiccup — try again next tick
    }
  }

  if (!finalTask) {
    // The task is still running and will finish and bill regardless. Return
    // the id so the caller can poll for it with action: "status" instead of
    // paying to generate the same image again.
    return json(
      { error: 'Wiro task timed out', taskId, recoverable: true },
      504,
    );
  }

  return await respondWithImage(finalTask, payload.outputFormat);
});
