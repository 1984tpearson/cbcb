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
const WIRO_TASK_DETAIL_URL = 'https://api.wiro.ai/v1/Task/Detail';
const ALLOWED_ORIGINS = Deno.env.get('ALLOWED_ORIGIN') || '*';

// Only used by legacy blocking mode. Kept well inside the edge function's
// wall-clock limit — raising it is not a fix, it just moves the cliff.
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 45; // ~90s budget

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
// was unusable (transient hiccup — the caller decides whether to retry).
async function fetchTask(taskId: string, apiKey: string) {
  const detailRes = await fetch(WIRO_TASK_DETAIL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ taskid: taskId }),
  });
  const detailJson = await detailRes.json().catch(() => null);
  return (detailJson?.tasklist?.[0] as Record<string, unknown> | undefined) || null;
}

// The finished task's image URL, or an error response. Handing back the URL
// rather than the bytes keeps the image off this function's critical path
// entirely — it used to download the whole file from Wiro's CDN and re-serve
// it, which is a second full transfer for no benefit.
function taskImageUrl(task: Record<string, unknown>) {
  if (task.status !== 'task_postprocess_end' || String(task.pexit) !== '0') {
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

  const apiKey = Deno.env.get('WIRO_API_KEY');
  if (!apiKey) {
    return new Response('Server misconfiguration', {
      status: 500,
      headers: corsHeaders(),
    });
  }

  // ── Read JSON payload from the browser ──────────
  // Expected shape: { action?, taskId?, model?, prompt, inputImage?, resolution?, aspectRatio?, outputFormat?, watermark?, seed? }
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

  // ── action: status ───────────────────────────────
  // Poll an existing task. 202 while it is still running, the image URL when
  // it finishes. This is the call the browser repeats, so it must stay cheap.
  if (action === 'status') {
    const taskId = typeof payload.taskId === 'string' ? payload.taskId : '';
    if (!taskId) {
      return new Response('taskId is required', { status: 400, headers: corsHeaders() });
    }

    let task: Record<string, unknown> | null;
    try {
      task = await fetchTask(taskId, apiKey);
    } catch (e) {
      return new Response(`Wiro task detail request failed: ${e instanceof Error ? e.message : String(e)}`, {
        status: 502,
        headers: corsHeaders(),
      });
    }

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
    return json({ status: 'done', imageUrl: result.imageUrl }, 200);
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

  const runBody: Record<string, unknown> = {
    prompt,
    resolution: payload.resolution || '1k',
    aspectRatio: payload.aspectRatio || '9:16',
    outputFormat: payload.outputFormat || 'png',
    watermark: payload.watermark ?? 'false',
  };
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
      const task = await fetchTask(taskId, apiKey);
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
