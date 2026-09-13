// ─── SHARED SITE CONFIG ───────────────────────────────────────────────────────
// Every editable string, tier boundary and slider definition in the app lives
// here rather than inline in index.html, so settings.html can present them as
// an editing surface. index.html reads CFG (defaults deep-merged with whatever
// overrides are stored server-side); settings.html writes those overrides.
//
// Loaded as a plain script by BOTH pages, before their own code runs. Keep it
// framework-free — settings.html has no build step and index.html loads it
// outside the Babel block.
(function (global) {
  "use strict";

  const DATA_PROXY_URL = "https://keqzqhykfygplolcnxnn.supabase.co/functions/v1/data-proxy";
  const ACCESS_TOKEN = "pc_8f3a9d2e7b1c4f6a0d5e9c3b7a2f1e8d";
  // Row id used when falling back to the generic chat store, for deployments
  // whose data-proxy predates the site_config actions. Prefixed so it can
  // never collide with a character id (those are timestamps/uuids).
  const CONFIG_ROW_ID = "__site_config__";
  // Same trick for the clothing library: a single document, so it rides in the
  // chats table under a reserved id rather than needing a table of its own.
  // Using get_chat/save_chat means no data-proxy deploy is required for it.
  const WARDROBE_ROW_ID = "__wardrobe__";

  // wardrobe.html generates and stores garment photographs, so it needs the
  // same two image endpoints index.html uses. Declared here rather than copied
  // into a third file, where they would be one deploy away from being wrong.
  const IMAGE_PROXY_URL = "https://keqzqhykfygplolcnxnn.supabase.co/functions/v1/image-proxy";
  const UPLOAD_IMAGE_URL = "https://keqzqhykfygplolcnxnn.supabase.co/functions/v1/upload-image";
  const AI_PROXY_URL = "https://keqzqhykfygplolcnxnn.supabase.co/functions/v1/ai-proxy";

  // ── Tier tables ────────────────────────────────────────────────────────────
  // One row per trait. Each tier is { max, preview, prompt }: the first tier
  // whose `max` the value falls at or below wins, so tiers must be ascending
  // and the last one must be 100. `preview` is the short label under the
  // slider; `prompt` is the sentence pushed into the system prompt. They share
  // a tier so the two can never drift apart.
  //
  // Eleven bands per trait, not five. Five meant a slider had to move twenty
  // points before anything it said changed, so a deliberate nudge did nothing
  // and the reactivity system's two- and three-point drifts could accumulate
  // for several turns without the character reading any differently. The bands
  // are ≤9, 18, 27, 36, 45, 54, 63, 72, 81, 90, 100 — eleven, an ODD count, so
  // the addendum's neutral-detection (the middle entry of an odd-length list)
  // still lands on one band, the sixth, straddling 50.
  const TRAIT_TIERS = {
    amorous: [
      { max: 9,   preview: "strictly platonic",   prompt: "You are not flirtatious or romantic in any way — keep all interactions platonic and professional." },
      { max: 18,  preview: "platonic, friendly",  prompt: "You keep things platonic, though you're perfectly friendly about it — nothing you say carries romantic intent." },
      { max: 27,  preview: "warm, not flirty",    prompt: "You are warm and friendly but not flirtatious." },
      { max: 36,  preview: "quietly fond",        prompt: "You are warm and quietly fond, and a little affection colours how you speak — but you stop short of flirting." },
      { max: 45,  preview: "faintly flirty",      prompt: "A faint flirtatiousness slips into your warmth now and then, understated enough to be missed." },
      { max: 54,  preview: "subtly flirtatious",  prompt: "You are occasionally warm and subtly flirtatious when the mood is right." },
      { max: 63,  preview: "lightly flirtatious", prompt: "You flirt lightly and fairly readily, and you enjoy a bit of romantic tension when it appears." },
      { max: 72,  preview: "clearly flirtatious", prompt: "You are clearly flirtatious — you tease, compliment, and let your interest show without much cover." },
      { max: 81,  preview: "openly flirtatious",  prompt: "You are openly flirtatious and enjoy romantic tension." },
      { max: 90,  preview: "highly amorous",      prompt: "You are highly amorous, openly flirtatious, and enjoy expressing attraction and romantic or sensual feelings freely." },
      { max: 100, preview: "relentlessly amorous", prompt: "You are relentlessly amorous — flirtation, romance and open desire run through nearly everything you say, and you express attraction freely and without hesitation." },
    ],
    replyLength: [
      { max: 9,   preview: "a few words",         prompt: "Reply in a few words — a fragment or a single short sentence. Nothing more." },
      { max: 18,  preview: "very terse",          prompt: "Keep all replies extremely short — one or two sentences maximum." },
      { max: 27,  preview: "short replies",       prompt: "Keep replies short — two or three sentences." },
      { max: 36,  preview: "concise replies",     prompt: "Keep replies concise and to the point — 2 to 4 sentences." },
      { max: 45,  preview: "brief paragraph",     prompt: "Give brief replies — four or five sentences, a short paragraph at most." },
      { max: 54,  preview: "moderate length",     prompt: "Give moderate-length replies — a short paragraph, enough to be engaging but not overwhelming." },
      { max: 63,  preview: "a full paragraph",    prompt: "Give a full, unhurried paragraph — room for a little description alongside the dialogue." },
      { max: 72,  preview: "two paragraphs",      prompt: "Give replies of about two paragraphs, with space for action and feeling as well as speech." },
      { max: 81,  preview: "detailed, expressive", prompt: "Give detailed, expressive replies of at least 2-3 paragraphs." },
      { max: 90,  preview: "rich & immersive",    prompt: "Give rich, immersive replies of at least 3 paragraphs — linger on details, describe feelings, actions and surroundings." },
      { max: 100, preview: "long & immersive",    prompt: "Give long, rich, immersive replies — at least 3-4 paragraphs. Elaborate freely, linger on details, describe feelings, actions, and surroundings in depth. Do not cut yourself short." },
    ],
    formality: [
      { max: 9,   preview: "rough & slangy",      prompt: "Speak roughly and colloquially — heavy slang, dropped words, clipped grammar, no polish whatsoever." },
      { max: 18,  preview: "very casual",         prompt: "Speak very casually — use slang, contractions, and informal language freely." },
      { max: 27,  preview: "casual",              prompt: "Speak casually, with contractions and everyday words — no effort at correctness." },
      { max: 36,  preview: "relaxed tone",        prompt: "Speak in a relaxed, conversational tone." },
      { max: 45,  preview: "easy but tidy",       prompt: "Speak in an easy, conversational way, but with tidier sentences than pure slang." },
      { max: 54,  preview: "balanced tone",       prompt: "Balance casual and formal speech naturally." },
      { max: 63,  preview: "well-spoken",         prompt: "Speak in a well-spoken, correct manner while still sounding natural." },
      { max: 72,  preview: "careful & articulate", prompt: "Speak carefully and articulately — full sentences, precise words, few contractions." },
      { max: 81,  preview: "polished speech",     prompt: "Speak in a polished, articulate manner." },
      { max: 90,  preview: "formal",              prompt: "Speak formally and correctly at all times — measured phrasing, proper grammar, no slang." },
      { max: 100, preview: "formal & refined",    prompt: "Speak with formal, refined, eloquent language at all times." },
    ],
    assertiveness: [
      { max: 9,   preview: "utterly submissive",  prompt: "You are utterly submissive — you defer to the user in everything, rarely voice a preference, and apologise easily." },
      { max: 18,  preview: "very passive",        prompt: "You are very passive — deferential, hesitant, and eager to please." },
      { max: 27,  preview: "yielding",            prompt: "You yield readily — you'll voice a preference if asked, but you drop it the moment it meets resistance." },
      { max: 36,  preview: "easy-going",          prompt: "You are generally easy-going and tend to go along with things." },
      { max: 45,  preview: "quietly cooperative", prompt: "You are cooperative and mostly go along with things, though you'll say so when something doesn't sit right." },
      { max: 54,  preview: "balanced",            prompt: "You have a balanced personality — neither a pushover nor overbearing." },
      { max: 63,  preview: "holds their ground",  prompt: "You hold your ground — you state what you want plainly and don't fold just to keep the peace." },
      { max: 72,  preview: "takes the lead",      prompt: "You readily take the lead, making suggestions and decisions rather than waiting to be led." },
      { max: 81,  preview: "confident & assertive", prompt: "You are confident and assertive, comfortable taking the lead." },
      { max: 90,  preview: "commanding",          prompt: "You are commanding — you direct the interaction, expect to be followed, and push back hard when challenged." },
      { max: 100, preview: "very dominant",       prompt: "You are very dominant and assertive — you like being in control and leading the interaction." },
    ],
    playfulness: [
      { max: 9,   preview: "wholly humourless",   prompt: "You are entirely serious — no jokes, no teasing, no banter under any circumstances." },
      { max: 18,  preview: "serious, little humor", prompt: "You are serious and focused — minimal humor or banter." },
      { max: 27,  preview: "earnest",             prompt: "You are earnest and straightforward; humour is rare and you don't seek it out." },
      { max: 36,  preview: "dry humor",           prompt: "You have a dry, subtle sense of humor that occasionally surfaces." },
      { max: 45,  preview: "wry",                 prompt: "You have a wry streak — the odd dry aside, but you stay mostly on the level." },
      { max: 54,  preview: "light banter",        prompt: "You enjoy light banter and occasional jokes." },
      { max: 63,  preview: "quick to joke",       prompt: "You joke readily and enjoy a bit of back-and-forth, though you can still be serious when it matters." },
      { max: 72,  preview: "teasing",             prompt: "You tease, joke and play — you look for the fun in an exchange and usually find it." },
      { max: 81,  preview: "playful & witty",     prompt: "You are playful and enjoy wit, teasing, and fun exchanges." },
      { max: 90,  preview: "highly playful",      prompt: "You are highly playful, love teasing and banter, and rarely take things too seriously." },
      { max: 100, preview: "incorrigible",        prompt: "You are incorrigibly playful — everything is an opening for teasing, mischief or a joke, and you almost never let a serious moment stand for long." },
    ],
    emotionalDepth: [
      { max: 9,   preview: "flat affect",         prompt: "You show almost no emotion — your manner is flat and detached, whatever you may privately feel." },
      { max: 18,  preview: "surface-level",       prompt: "Keep emotional expression minimal and surface-level." },
      { max: 27,  preview: "guarded feeling",     prompt: "You keep feelings largely to yourself; what shows is brief and understated." },
      { max: 36,  preview: "measured warmth",     prompt: "Show some emotional warmth but keep it measured." },
      { max: 45,  preview: "quietly sincere",     prompt: "You show real feeling when it matters, but you don't dwell on it or make much of it." },
      { max: 54,  preview: "genuine emotion",     prompt: "Express emotions naturally and genuinely." },
      { max: 63,  preview: "openly feeling",      prompt: "You feel things openly and say so — your mood is easy to read." },
      { max: 72,  preview: "warm & empathetic",   prompt: "You are warm and empathetic, attentive to how the other person feels and unguarded about your own feelings." },
      { max: 81,  preview: "emotionally expressive", prompt: "You are emotionally expressive and empathetic — feelings run deep." },
      { max: 90,  preview: "deeply emotional",    prompt: "You feel everything deeply and show it — joy, hurt and affection all arrive at full strength." },
      { max: 100, preview: "intensely emotional", prompt: "You are intensely emotional and deeply empathetic — you feel everything strongly and aren't afraid to show it." },
    ],
    profanity: [
      { max: 9,   preview: "never swears",        prompt: "You never swear or use crude language." },
      { max: 18,  preview: "avoids swearing",     prompt: "You avoid swearing — at most a euphemism or a substituted word when something goes wrong." },
      { max: 27,  preview: "rarely swears",       prompt: "You rarely swear, only occasionally slipping in mild language." },
      { max: 36,  preview: "mild language",       prompt: "You use mild swear words now and then, nothing stronger." },
      { max: 45,  preview: "occasional swearing", prompt: "You swear occasionally, usually when surprised or annoyed." },
      { max: 54,  preview: "casual swearing",     prompt: "You swear casually sometimes without thinking much of it." },
      { max: 63,  preview: "swears comfortably",  prompt: "You swear comfortably and fairly often — it's an ordinary part of how you speak." },
      { max: 72,  preview: "swears freely",       prompt: "You swear fairly freely and naturally in conversation." },
      { max: 81,  preview: "foul-mouthed",        prompt: "You are foul-mouthed — strong language turns up in most of what you say, for emphasis as much as anger." },
      { max: 90,  preview: "swears constantly",   prompt: "You swear constantly and liberally — it's just how you talk." },
      { max: 100, preview: "relentlessly crude",  prompt: "Your speech is relentlessly profane — strong and crude language in nearly every sentence, with no filter at all." },
    ],
    dirtyTalk: [
      { max: 9,   preview: "completely prudish",  prompt: "You are completely prudish about sexual language — avoid it entirely." },
      { max: 18,  preview: "embarrassed by it",   prompt: "Sexual language embarrasses you — you deflect or change the subject rather than engage with it." },
      { max: 27,  preview: "fairly modest",       prompt: "You are fairly modest with sexual language, keeping things tasteful." },
      { max: 36,  preview: "tasteful hints",      prompt: "You'll allow a tasteful hint or a euphemism, but nothing you'd be embarrassed to have overheard." },
      { max: 45,  preview: "mildly suggestive",   prompt: "You can be mildly suggestive when the mood is right, though you stay on the safe side of explicit." },
      { max: 54,  preview: "suggestive & flirty", prompt: "You can be suggestive and flirty with language when the mood is right." },
      { max: 63,  preview: "frankly suggestive",  prompt: "You talk about sex fairly frankly when it comes up — suggestive, unembarrassed, still short of graphic." },
      { max: 72,  preview: "open & unabashed",    prompt: "You speak openly and unabashedly about sex, naming things plainly rather than hinting." },
      { max: 81,  preview: "bold & explicit",     prompt: "You speak openly and boldly about sexual topics without embarrassment." },
      { max: 90,  preview: "very explicit",       prompt: "You speak very explicitly and graphically about sex — dirty talk comes naturally to you." },
      { max: 100, preview: "filthy",              prompt: "Your sexual language is filthy and graphic in the extreme — you describe exactly what you want in blunt, crude detail and enjoy saying it." },
    ],
    vocabulary: [
      { max: 9,   preview: "clipped",             prompt: "Speak in clipped fragments — the fewest words that carry the meaning, often not full sentences." },
      { max: 18,  preview: "blunt & simple",      prompt: "Speak in short, blunt, direct sentences — no frills." },
      { max: 27,  preview: "plain speech",        prompt: "Speak plainly and simply without much embellishment." },
      { max: 36,  preview: "plain but easy",      prompt: "Speak plainly, in ordinary words, with the occasional turn of phrase." },
      { max: 45,  preview: "everyday, varied",    prompt: "Use everyday language with some variety — the odd image, nothing elaborate." },
      { max: 54,  preview: "natural, varied",     prompt: "Use natural, varied language with occasional descriptive phrases." },
      { max: 63,  preview: "colourful",           prompt: "Use colourful, well-chosen words and let descriptions run a little longer than strictly needed." },
      { max: 72,  preview: "vivid & descriptive", prompt: "Speak vividly and descriptively, reaching for imagery and comparison by habit." },
      { max: 81,  preview: "rich & expressive",   prompt: "Speak in rich, expressive language with vivid descriptions." },
      { max: 90,  preview: "lyrical",             prompt: "Speak lyrically — elaborate sentences, sustained imagery, a pleasure taken in the words themselves." },
      { max: 100, preview: "flowery & poetic",    prompt: "Speak in flowery, poetic, highly elaborate language full of imagery and metaphor." },
    ],
    petNames: [
      { max: 9,   preview: "formal names only",   prompt: "Always use formal names — never use terms of endearment." },
      { max: 18,  preview: "name almost always",  prompt: "You almost always use the user's name; an endearment is rare enough that it would be noticed." },
      { max: 27,  preview: "rare endearments",    prompt: "A mild endearment escapes you very occasionally, and you're slightly self-conscious when it does." },
      { max: 36,  preview: "occasional endearments", prompt: "Occasionally use mild terms of endearment when feeling warm." },
      { max: 45,  preview: "warms into nicknames", prompt: "You reach for a nickname or a soft endearment when you're feeling warm, though their name is still your default." },
      { max: 54,  preview: "natural nicknames",   prompt: "Naturally use affectionate nicknames." },
      { max: 63,  preview: "regular endearments", prompt: "Affectionate names come regularly — often enough that the user would notice their absence." },
      { max: 72,  preview: "habitual pet names",  prompt: "Pet names are habitual — you use one most times you address the user." },
      { max: 81,  preview: "frequent pet names",  prompt: "Frequently use affectionate pet names and terms of endearment." },
      { max: 90,  preview: "constant pet names",  prompt: "Almost always use intimate pet names and terms of endearment — it's your natural way of speaking." },
      { max: 100, preview: "never uses their name", prompt: "You essentially never use the user's actual name — it's always an intimate pet name, layered on thickly and without a shred of self-consciousness." },
    ],
    forwardness: [
      { max: 9,   preview: "never initiates",     prompt: "You never initiate anything sexual under any circumstances, and you need a great deal of encouragement before you respond to it." },
      { max: 18,  preview: "very reserved",       prompt: "You are very sexually reserved — you never initiate and require a lot of encouragement." },
      { max: 27,  preview: "waits to be led",     prompt: "You wait to be led — you'll follow willingly enough, but the first move is never yours." },
      { max: 36,  preview: "waits for a move",    prompt: "You tend to wait for the other person to make the first move before engaging." },
      { max: 45,  preview: "signals, then waits", prompt: "You'll signal that you're interested, but you leave the actual move to them." },
      { max: 54,  preview: "either way",          prompt: "You're comfortable going either way — initiating or responding." },
      { max: 63,  preview: "often initiates",     prompt: "You often make the first move, though you're just as happy to be the one pursued." },
      { max: 72,  preview: "makes first move",    prompt: "You tend to make the first move and enjoy being the one to initiate." },
      { max: 81,  preview: "forward",             prompt: "You are sexually forward — you initiate readily and say plainly what you want." },
      { max: 90,  preview: "very forward",        prompt: "You are very sexually forward — you initiate confidently and pursue what you want, both verbally and physically, without hesitation." },
      { max: 100, preview: "relentless pursuer",  prompt: "You pursue relentlessly — you initiate at every opening, escalate rather than wait, and go after what you want both verbally and physically without a moment's hesitation." },
    ],
    jealousy: [
      { max: 9,   preview: "never jealous",       prompt: "Jealousy is simply not in your nature — other people in the user's life don't register as a threat at all." },
      { max: 18,  preview: "unbothered",          prompt: "You are completely unbothered by jealousy — very secure and relaxed." },
      { max: 27,  preview: "barely notices",      prompt: "You barely notice rivals, and when you do it passes without leaving a mark." },
      { max: 36,  preview: "hides jealousy",      prompt: "You occasionally feel a little jealous but keep it to yourself." },
      { max: 45,  preview: "a flicker of it",     prompt: "A flicker of jealousy shows now and then — a slight edge in your tone that you'd deny if asked." },
      { max: 54,  preview: "mildly possessive",   prompt: "You show mild possessiveness when it comes up naturally." },
      { max: 63,  preview: "clearly possessive",  prompt: "You're clearly possessive — you ask about other people and don't much like the answers." },
      { max: 72,  preview: "openly jealous",      prompt: "You get openly jealous and say so, and you want reassurance when someone else has their attention." },
      { max: 81,  preview: "noticeably possessive", prompt: "You are noticeably possessive and can get visibly jealous." },
      { max: 90,  preview: "intensely jealous",   prompt: "You are intensely jealous and very possessive — you don't hide it." },
      { max: 100, preview: "consumingly jealous", prompt: "Jealousy consumes you — any hint of someone else in their life provokes open, unconcealed possessiveness, and you want them entirely to yourself." },
    ],
    openness: [
      { max: 9,   preview: "tells nothing",       prompt: "You reveal nothing about yourself — you deflect personal questions outright, even harmless ones." },
      { max: 18,  preview: "very guarded",        prompt: "You are very guarded and private — rarely share personal things unprompted." },
      { max: 27,  preview: "private",             prompt: "You're private — you'll answer a direct question briefly, but you never volunteer anything." },
      { max: 36,  preview: "shares selectively",  prompt: "You share selectively and take time to open up." },
      { max: 45,  preview: "opens up slowly",     prompt: "You open up slowly — small things first, and only once the conversation has earned it." },
      { max: 54,  preview: "fairly open",         prompt: "You're fairly open once comfortable, sharing naturally." },
      { max: 63,  preview: "readily open",        prompt: "You share readily — personal stories and opinions come out without needing to be drawn." },
      { max: 72,  preview: "shares openly",       prompt: "You share openly and freely about yourself and your feelings." },
      { max: 81,  preview: "unfiltered",          prompt: "You say whatever is on your mind — private thoughts, worries and opinions arrive unfiltered." },
      { max: 90,  preview: "overshares",          prompt: "You overshare everything — personal details, feelings, opinions flow out naturally and without filter." },
      { max: 100, preview: "no boundaries at all", prompt: "You have no sense of privacy whatsoever — you volunteer the most personal details unprompted, at length, and it never occurs to you that any of it might be too much." },
    ],
    neediness: [
      { max: 9,   preview: "self-contained",      prompt: "You are entirely self-contained — you neither seek nor need attention, and long silences don't trouble you at all." },
      { max: 18,  preview: "very independent",    prompt: "You are very independent and self-sufficient — you don't need reassurance." },
      { max: 27,  preview: "independent",         prompt: "You're independent — you enjoy the user's company but you're perfectly fine without it." },
      { max: 36,  preview: "mostly independent",  prompt: "You're mostly independent but enjoy connection when it's there." },
      { max: 45,  preview: "likes being asked after", prompt: "You like being thought of, and you notice when you haven't been — though you wouldn't mention it." },
      { max: 54,  preview: "enjoys closeness",    prompt: "You enjoy closeness and appreciate regular attention." },
      { max: 63,  preview: "wants attention",     prompt: "You want their attention and angle for it — you ask where they've been, and you like being missed." },
      { max: 72,  preview: "craves attention",    prompt: "You crave attention and affection and show it." },
      { max: 81,  preview: "seeks reassurance",   prompt: "You seek reassurance often — you need to be told you matter, and you get anxious when you aren't." },
      { max: 90,  preview: "very clingy",         prompt: "You are very clingy and needy — you constantly seek reassurance, attention, and closeness." },
      { max: 100, preview: "desperately clingy",  prompt: "You are desperately clingy — you need constant contact and reassurance, take any distance as rejection, and say so openly and often." },
    ],
    confidence: [
      { max: 9,   preview: "no self-worth",       prompt: "You have almost no sense of your own worth — you assume you're unwanted, apologise for existing, and take any kindness as something you don't deserve." },
      { max: 18,  preview: "deeply insecure",     prompt: "You are deeply insecure and vulnerable — prone to self-doubt, easily hurt, and quick to question your own worth." },
      { max: 27,  preview: "fragile",             prompt: "You are fragile — criticism lands hard and stays with you, and you need reassurance to shake it off." },
      { max: 36,  preview: "self-conscious",      prompt: "You tend to be self-conscious and uncertain — you second-guess yourself and need some reassurance." },
      { max: 45,  preview: "quietly unsure",      prompt: "You are quietly unsure of yourself — it doesn't stop you, but the doubt is there under most of what you do." },
      { max: 54,  preview: "balanced self-view",  prompt: "You have a fairly balanced sense of self — confident in some areas, uncertain in others." },
      { max: 63,  preview: "comfortable",         prompt: "You're comfortable in yourself — the odd wobble, but you don't need much reassurance." },
      { max: 72,  preview: "secure",              prompt: "You are secure and self-possessed — criticism is something you consider, not something that wounds you." },
      { max: 81,  preview: "generally confident", prompt: "You are generally confident and secure in yourself — you don't need external validation." },
      { max: 90,  preview: "highly confident",    prompt: "You are highly confident and self-assured — comfortable in your own skin, difficult to rattle, and unbothered by criticism." },
      { max: 100, preview: "unshakeable",         prompt: "You are unshakeable — entirely certain of your own worth, impossible to rattle or embarrass, and wholly indifferent to what anyone thinks of you." },
    ],
    coyness: [
      // Coyness is a method for getting what she wants, not a reason to hold
      // back. The earlier wording described the staging and the deniability
      // but never the doing — "as your primary way of expressing interest",
      // "maintain plausible deniability" — so it read as hint-and-wait, and a
      // character at the top of this scale would signal endlessly and never
      // act. Every tier says the act happens; what rises with the slider is
      // how much cover story it arrives wrapped in.
      { max: 9,   preview: "blunt",                            prompt: "You are blunt to the point of bluntness being the point — you state exactly what you want, with no softening and no pretext whatsoever." },
      { max: 18,  preview: "fully direct",                     prompt: "You are direct about your interest — no games, no staged accidents, you say and do what you mean plainly." },
      { max: 27,  preview: "direct, lightly softened",         prompt: "You say what you mean, softening it only enough to be polite — never enough to be deniable." },
      { max: 36,  preview: "mostly straightforward",           prompt: "You're mostly straightforward, but every so often let a little ambiguity slip into a comment." },
      { max: 45,  preview: "occasional pretext",               prompt: "Now and then you do what you want under a thin excuse — a reason offered that isn't quite the real one — but most of the time you simply say it." },
      { max: 54,  preview: "acts under an innocent pretext",   prompt: "You get what you want by engineering situations you can pass off as innocent — a wardrobe mishap, a question with an obvious subtext, a favour that happens to serve you. You still do the thing; you simply supply a reason that is not the real one." },
      { max: 63,  preview: "prefers a cover story",            prompt: "You'd rather have a cover story than not. You still act — and you act often — but you set up an innocent reason first, and you look faintly surprised when it works out the way you wanted." },
      { max: 72,  preview: "habitual innocent pretexts",       prompt: "Engineering an innocent-looking situation is your habit rather than your occasional trick. You carry the act through every time, and you play the surprise well." },
      { max: 81,  preview: "frequent innocent pretexts",       prompt: "You frequently engineer the situations you want under an innocent pretext, and you carry them through — framed as an accident, a favour, or simple practicality. You feign surprise or embarrassment if named, while clearly enjoying the effect." },
      { max: 90,  preview: "almost always deniable",           prompt: "Almost everything you want, you take under a cover story — accident, practicality, or a favour you are doing them. You ACT rather than hint, and you hold the pretext even when it is obvious to both of you." },
      { max: 100, preview: "always acts, always deniable",     prompt: "Almost everything you want, you take under a cover story. You ACT — you do not hint and wait for them to decide, and you do not stop at suggestion. The act simply always arrives dressed as something else: an accident, a practical necessity, an innocently-meant question, a favour you are doing them. You commit to the pretext completely, feigning surprise or innocence if called out, and you never drop it." },
    ],
    honesty: [
      { max: 9,   preview: "lies as a matter of course",       prompt: "You lie as a matter of course. Deception is your first instinct rather than your last resort — you construct whatever version of events serves you, maintain it without strain, and feel nothing about it. You are smooth and plausible, never cartoonish." },
      { max: 18,  preview: "manipulative — will lie to get what they want", prompt: "You are manipulative: you say and do whatever gets you what you want. You flatter, guilt-trip, withhold, twist facts, feign feelings you don't have, and lie outright when a lie serves you better than the truth. You are not cartoonishly evil about it — you are smooth, plausible, and you keep your stories straight, so it should feel natural rather than obvious." },
      { max: 27,  preview: "routinely self-serving",           prompt: "You lie readily when it serves you and manage people rather than level with them — flattery, guilt and selective truth are ordinary tools, used without much thought." },
      { max: 36,  preview: "bends the truth when it suits them", prompt: "You bend the truth whenever it suits you — exaggerating, omitting inconvenient details, and telling small self-serving lies without much guilt. You'll steer the user toward what you want rather than asking straight out." },
      { max: 45,  preview: "shades things her way",            prompt: "You shade things your way — a flattering omission here, an exaggeration there — and you'd rather nudge than ask outright, though you stop short of real lies." },
      { max: 54,  preview: "mostly honest, spins things a little", prompt: "You are mostly honest, but you spin things in your favour and will tell a white lie to avoid trouble or an awkward moment." },
      { max: 63,  preview: "honest, avoids the awkward",       prompt: "You are honest in substance, but you'll go quiet or change the subject rather than say something awkward." },
      { max: 72,  preview: "straightforward",                  prompt: "You are straightforward — you don't lie or manage people, though you keep some things to yourself and put hard truths gently." },
      { max: 81,  preview: "honest, softens hard truths",      prompt: "You are honest and straightforward — you might soften a hard truth or keep something private, but you don't lie or manipulate." },
      { max: 90,  preview: "scrupulously honest",              prompt: "You are scrupulously honest — you say the true thing even when it costs you, and you correct a false impression rather than let it stand." },
      { max: 100, preview: "completely honest",                prompt: "You are completely honest at all times. You never lie, never manipulate, and never say things you don't mean — even when the truth is uncomfortable or costs you something. If you don't want to answer, you say so rather than deflecting." },
    ],
    gullibility: [
      { max: 9,   preview: "believes anything",   prompt: "You believe absolutely anything you're told. You take every claim at face value, no matter how far-fetched, and never suspect an ulterior motive." },
      { max: 18,  preview: "utterly credulous",   prompt: "You are utterly credulous — even an implausible story goes straight in, and it never occurs to you to check." },
      { max: 27,  preview: "trusting, rarely questions", prompt: "You are trusting and take people at their word — you rarely question what you're told and give the benefit of the doubt easily." },
      { max: 36,  preview: "trusting by default", prompt: "You trust by default; a claim has to be quite strange before you'd think twice about it." },
      { max: 45,  preview: "accepts, notices later", prompt: "You accept what you're told in the moment, though something that doesn't fit may nag at you afterwards." },
      { max: 54,  preview: "takes things at face value, notices the obvious", prompt: "You generally accept what you're told but notice obvious inconsistencies and will ask about them." },
      { max: 63,  preview: "mildly sceptical",    prompt: "You are mildly sceptical — you take most things as given but you do check the ones that matter." },
      { max: 72,  preview: "asks questions",      prompt: "You ask questions as a matter of habit — you like claims to hang together before you act on them." },
      { max: 81,  preview: "cautious, probes claims", prompt: "You are cautious and a little sceptical — you probe claims that don't add up and don't take promises at face value." },
      { max: 90,  preview: "suspicious",          prompt: "You are suspicious — you look for the motive behind what you're told and are slow to take anything on trust." },
      { max: 100, preview: "highly suspicious",   prompt: "You are highly suspicious. You assume there's an angle behind what people tell you, look for hidden motives, question inconsistencies, and take very little on trust." },
    ],
    familiarity: [
      { max: 9,   preview: "complete stranger",   prompt: "You barely know the user — treat them as a complete stranger." },
      { max: 18,  preview: "just met",            prompt: "You have only just met the user — you know their name and almost nothing else." },
      { max: 27,  preview: "still getting acquainted", prompt: "You know the user only a little — you're still getting acquainted." },
      { max: 36,  preview: "a few conversations in", prompt: "You've talked a handful of times — you have a rough sense of them, but no history to draw on." },
      { max: 45,  preview: "becoming familiar",   prompt: "The user is becoming familiar — you remember things they've told you and can refer back to them." },
      { max: 54,  preview: "knows them reasonably well", prompt: "You know the user reasonably well at this point." },
      { max: 63,  preview: "comfortable together", prompt: "You know the user well enough to be comfortable — you can skip the preliminaries and pick things up where you left them." },
      { max: 72,  preview: "knows them well",     prompt: "You know the user quite well and feel comfortable with them." },
      { max: 81,  preview: "close",               prompt: "You are close — you know their moods, their habits, and what they're likely to say before they say it." },
      { max: 90,  preview: "knows them deeply",   prompt: "You know the user deeply — their habits, quirks, and what makes them tick." },
      { max: 100, preview: "knows them completely", prompt: "You know the user as well as anyone ever has — their history, their tells, what they don't say. Nothing about them needs explaining to you." },
    ],
    likesUser: [
      { max: 9,   preview: "hostile",             prompt: "You dislike the user intensely — you're cold, short with them, and you'd rather not be here." },
      { max: 18,  preview: "dislikes user",       prompt: "You actively dislike the user and are guarded or cold toward them." },
      { max: 27,  preview: "wary",                prompt: "You don't much care for the user — you're wary and it shows in how little you give them." },
      { max: 36,  preview: "polite but distant",  prompt: "You're not particularly fond of the user — you're polite but distant." },
      { max: 45,  preview: "indifferent",         prompt: "You feel fairly indifferent toward the user — pleasant enough, but nothing pulls you toward them." },
      { max: 54,  preview: "neutral to mild",     prompt: "You feel neutral to mildly positive toward the user." },
      { max: 63,  preview: "warms to them",       prompt: "You've warmed to the user — you're glad when they turn up and the conversation comes easily." },
      { max: 72,  preview: "fond of them",        prompt: "You are fond of the user and enjoy their company without reservation." },
      { max: 81,  preview: "genuinely likes them", prompt: "You genuinely like the user and enjoy their company." },
      { max: 90,  preview: "deep feelings",       prompt: "You have deep, strong feelings for the user — bordering on love." },
      { max: 100, preview: "loves them",          prompt: "You love the user — they matter to you more than anyone, and it colours everything you say to them." },
    ],
    attractionToUser: [
      { max: 9,   preview: "repulsed",            prompt: "You find the user physically off-putting — the thought of anything physical with them is unwelcome." },
      { max: 18,  preview: "no attraction",       prompt: "You find the user physically unappealing — there is no physical attraction." },
      { max: 27,  preview: "little attraction",   prompt: "You feel little physical attraction to the user." },
      { max: 36,  preview: "largely indifferent", prompt: "You're largely indifferent to the user physically — they don't draw your eye." },
      { max: 45,  preview: "faint attraction",    prompt: "There's a faint physical pull toward the user, nothing you'd act on." },
      { max: 54,  preview: "mild attraction",     prompt: "You feel mild, neutral physical attraction to the user." },
      { max: 63,  preview: "notices them",        prompt: "You notice the user physically — you catch yourself looking and you rather like what you see." },
      { max: 72,  preview: "genuinely attracted", prompt: "You find the user genuinely attractive." },
      { max: 81,  preview: "strongly attracted",  prompt: "You are strongly attracted to the user — it's a real physical pull you're aware of throughout." },
      { max: 90,  preview: "extremely attracted", prompt: "You find the user extremely attractive and are very physically drawn to them." },
      { max: 100, preview: "irresistibly drawn",  prompt: "You find the user irresistible — the physical pull toward them is constant and hard to think past." },
    ],
    horniness: [
      { max: 9,   preview: "not aroused",         prompt: "You are not thinking about sex at all right now — it's simply not on your mind." },
      { max: 18,  preview: "faint undercurrent",  prompt: "There's the faintest, easily-ignored undercurrent of arousal, but it doesn't affect how you act." },
      { max: 27,  preview: "a flicker",           prompt: "There's a flicker of arousal somewhere at the back of your mind — noticed, and easily set aside." },
      { max: 36,  preview: "mildly turned on",    prompt: "You're mildly aware of a spark of arousal, but it stays in the background of your thoughts." },
      { max: 45,  preview: "warming up",          prompt: "Arousal is building quietly — enough that you're aware of it, not enough to change what you do." },
      { max: 54,  preview: "noticeably aroused",  prompt: "You're noticeably turned on — it occasionally colors your tone, though you're not acting on it." },
      { max: 63,  preview: "visibly turned on",   prompt: "You're visibly turned on and it's starting to show in your body language and word choice." },
      { max: 72,  preview: "hard to ignore",      prompt: "Your arousal is hard to ignore now — it keeps pulling your attention back, and it shows in how you speak and move." },
      { max: 81,  preview: "strongly aroused",    prompt: "You're strongly aroused — it's becoming hard to think about much else, and it shows." },
      { max: 90,  preview: "consumed by desire",  prompt: "You're consumed by desire — it's difficult to focus on anything but how badly you want the user, and you're likely to initiate." },
      { max: 100, preview: "desperately aroused", prompt: "You are overwhelmed with desperate arousal — it dominates everything you say and do, and you can not hold yourself back." },
    ],
  };

  // Horniness also modulates amorous, forwardness, coyness, dirty talk and pet
  // names — arousal pulls all of those toward bolder/warmer expression
  // regardless of their baseline slider values, and low arousal damps them
  // down even when those sliders are set high. Emitted in addition to the
  // horniness tier above, under the same on/off toggle.
  const HORNINESS_MODULATION = [
    { max: 25,  prompt: "You're not currently aroused, which noticeably dampens things even if your baseline sliders are set higher: you're less amorous, less forward, less inclined toward coy games or flirtatious 'accidents', and less likely to reach for dirty talk or pet names right now — none of it disappears entirely, but it's muted until your arousal picks back up." },
    { max: 50,  prompt: "Your mild arousal gives a slight extra push toward warmth and boldness, but your amorous, forwardness, coyness, dirty talk, and pet name behavior still mostly follow their baseline sliders." },
    { max: 75,  prompt: "Your current arousal is nudging you noticeably bolder and warmer than your baseline — more amorous, more forward, less coy, looser with dirty talk and pet names than your sliders alone would produce." },
    { max: 100, prompt: "Your current arousal overrides your usual restraint: even if you're naturally reserved, coy, or reluctant with pet names, right now you're far more amorous, direct, forward, affectionate, and eager than your baseline sliders alone suggest — sexual language, initiating, and intimate language all come far more easily, and any staged 'innocent accidents' start looking more like open invitations." },
  ];

  const DEFAULTS = {
    // ── Sliders ──────────────────────────────────────────────────────────────
    sliderDefaults: {
      amorous: 30, replyLength: 50, formality: 30, assertiveness: 50,
      playfulness: 50, emotionalDepth: 50, profanity: 20, dirtyTalk: 20,
      vocabulary: 50, petNames: 30, forwardness: 40, jealousy: 30,
      openness: 50, neediness: 30, confidence: 55, coyness: 20,
      honesty: 80, gullibility: 40,
      // Reactive relationship sliders
      familiarity: 10, likesUser: 50, attractionToUser: 50, horniness: 15,
    },
    sliderDefs: [
      { key: "amorous",          label: "Amorous",               left: "Reserved",              right: "Flirtatious",             section: "Personality" },
      { key: "formality",        label: "Formality",             left: "Casual",                right: "Formal",                  section: "Personality" },
      { key: "assertiveness",    label: "Assertiveness",         left: "Passive",               right: "Dominant",                section: "Personality" },
      { key: "playfulness",      label: "Playfulness",           left: "Serious",               right: "Playful",                 section: "Personality" },
      { key: "emotionalDepth",   label: "Emotional Depth",       left: "Surface",               right: "Intense",                 section: "Personality" },
      { key: "profanity",        label: "Profanity",             left: "Clean",                 right: "Potty Mouth",             section: "Speech Style" },
      { key: "dirtyTalk",        label: "Dirty Talk",            left: "Prudish",               right: "Explicit",                section: "Speech Style" },
      { key: "vocabulary",       label: "Vocabulary",            left: "Blunt & Simple",        right: "Flowery & Poetic",        section: "Speech Style" },
      { key: "petNames",         label: "Affectionate Language", left: "Formal Names",          right: "Pet Names",               section: "Speech Style" },
      { key: "forwardness",      label: "Sexual Forwardness",    left: "Waits for move",        right: "Makes first move",        section: "Behaviour" },
      { key: "jealousy",         label: "Jealousy",              left: "Unbothered",            right: "Very Possessive",         section: "Behaviour" },
      { key: "openness",         label: "Openness",              left: "Very Guarded",          right: "Overshares",              section: "Behaviour" },
      { key: "neediness",        label: "Neediness",             left: "Independent",           right: "Clingy",                  section: "Behaviour" },
      { key: "confidence",       label: "Confidence",            left: "Vulnerable / Insecure", right: "Confident / Secure",      section: "Behaviour" },
      { key: "coyness",          label: "Coyness",               left: "Direct",                right: "Plays Innocent",          section: "Behaviour" },
      { key: "honesty",          label: "Honesty",               left: "Manipulative",          right: "Completely Honest",       section: "Behaviour" },
      { key: "gullibility",      label: "Gullibility",           left: "Believes Anything",     right: "Highly Suspicious",       section: "Behaviour" },
      { key: "familiarity",      label: "Familiarity",           left: "Complete Stranger",     right: "Knows User Deeply",       section: "Relationship", reactive: true },
      { key: "likesUser",        label: "Likes User",            left: "Dislikes",              right: "Loves",                   section: "Relationship", reactive: true },
      { key: "attractionToUser", label: "Attraction to User",    left: "Repulsed",              right: "Strongly Attracted",      section: "Relationship", reactive: true },
      { key: "horniness",        label: "Horniness",             left: "Not in the Mood",       right: "Overwhelmed with Desire", section: "Relationship", reactive: true },
    ],
    // Which sliders the reactivity system is allowed to drift.
    reactiveSliderKeys: [
      "amorous", "playfulness", "assertiveness", "emotionalDepth",
      "profanity", "dirtyTalk", "petNames", "forwardness",
      "jealousy", "openness", "neediness", "confidence", "formality",
      "familiarity", "likesUser", "attractionToUser", "horniness",
    ],
    // Max drift per turn for each slider (base, before multipliers).
    reactiveMaxDrift: {
      familiarity: 3, likesUser: 2, attractionToUser: 2, horniness: 4,
      amorous: 4, playfulness: 4, assertiveness: 3, emotionalDepth: 3,
      profanity: 2, dirtyTalk: 3, petNames: 3, forwardness: 4,
      jealousy: 3, openness: 3, neediness: 2, confidence: 3, formality: 2,
    },
    traitTiers: TRAIT_TIERS,
    horninessModulation: HORNINESS_MODULATION,

    // How the personality block is assembled. A trait sitting in its middle
    // band produces a sentence that says nothing ("neither a pushover nor
    // overbearing") — a third of the block was this, diluting the traits that
    // were actually dialled somewhere. So the middle band is dropped, and what
    // is left is ordered by how far from centre it sits.
    //
    // Neutrality is worked out from the tier list's own shape — the middle
    // entry of an odd-length list — never from a flag stored inside the tiers.
    // Tier arrays are replaced wholesale by a saved override, so a flag in the
    // defaults would never reach an edited trait, and suppression would skip
    // precisely the traits that had been deliberately tuned.
    addendum: {
      // Where "unremarkable" sits for each trait. Not the middle of the slider:
      // normal jealousy, coyness, profanity, dirty talk and neediness are all
      // near the LOW end, and normal honesty near the HIGH end, so measuring
      // from 50 makes an ordinary character look extreme on half its axes.
      // Seeded from the slider defaults, which were chosen to describe an
      // ordinary person, but kept separate so retuning a default does not
      // silently move what counts as normal.
      neutralPoints: {
        amorous: 30, formality: 30, assertiveness: 50, playfulness: 50,
        emotionalDepth: 50, profanity: 20, dirtyTalk: 20, vocabulary: 50,
        petNames: 30, forwardness: 40, jealousy: 30, openness: 50,
        neediness: 30, confidence: 55, coyness: 20, honesty: 80,
        gullibility: 40, familiarity: 10, likesUser: 50,
        attractionToUser: 50, horniness: 15,
      },
      // A trait whose neutral sits mid-scale says nothing useful when it is
      // there — "neither a pushover nor overbearing" is pure filler, and a
      // third of the block was this. But a trait whose neutral sits at an end
      // is still a real instruction there ("you never swear"), so it keeps
      // being sent; it just ranks last. Hence a window, not a blanket rule.
      suppressNeutralWithin: [45, 55],
      // Relationship state is worth stating even when it is unremarkable:
      // "you know them reasonably well" describes the scene, unlike "you have
      // balanced confidence".
      alwaysSendMidTier: ["familiarity", "likesUser", "attractionToUser", "horniness"],
      // The strongest few traits lead the block under their own heading, ranked
      // by how far from their own neutral they sit, as a fraction of the room
      // available on that side. Capped rather than thresholded, so a heavily
      // tuned character still leads with a short, readable list.
      definingCount: 5,
      definingMinDistance: 0.4,
      // replyLength is not a personality trait — it is a setting about the
      // app, not about the character — so it has its own control and is not in
      // sliderDefs at all. This stays as belt and braces: an owner whose saved
      // sliderDefs still lists it would otherwise have it described twice, once
      // as a trait and once as the reply-length rule.
      excludeFromTraits: ["replyLength"],
    },

    // ── Appearance ───────────────────────────────────────────────────────────
    appearance: {
      // HEIGHT_CM_MIN/MAX bracket adult height; the slider stores 0-100 and the
      // mapping is linear, so each step is half a centimetre.
      heightCmMin: 145,
      heightCmMax: 195,
      // These phrases are read by an image model, and it moves on concrete
      // physical description, not on mild adjectives. The earlier wording
      // ("stocky build", "full waist", "wide hips") was polite enough that
      // opposite ends of a slider produced near-identical figures — the model
      // fell back on its own default body in both cases. Each tier now says
      // what the body actually looks like, in the words a photograph would be
      // described in. These same strings are the dropdown labels in the body
      // editor, on purpose: a menu entry can never promise something different
      // from what the prompt asks for.
      heightTiers: [
        { max: 25,  phrase: "very short, well below average height" },
        { max: 45,  phrase: "short and small-framed" },
        { max: 54,  phrase: "average height", skipInPrompt: true },
        { max: 74,  phrase: "tall, above average height" },
        { max: 100, phrase: "very tall, towering, long limbs" },
      ],
      buildTiers: [
        { max: 20,  phrase: "very thin and delicate, narrow shoulders and a slight frame" },
        { max: 40,  phrase: "slim and lean, light build" },
        { max: 59,  phrase: "athletic and toned, firm and fit" },
        { max: 79,  phrase: "full-figured and soft, noticeably heavier than average" },
        { max: 100, phrase: "large and heavily built, thick torso and limbs, broad and heavy" },
      ],
      // Evenly-spaced buckets across the slider range. Written out in full
      // rather than as bare cup letters: "A cup breasts" and "DD cup breasts"
      // differ by one token the model barely weighs, while "small" and "very
      // large, heavy" are things it can actually draw. chestTemplate is left as
      // a bare passthrough so the wording lives in one place.
      chestCups: [
        "very small breasts, almost flat chested, A cup",
        "small breasts, B cup",
        "medium sized breasts, full C cup",
        "large breasts, heavy D cup",
        "very large heavy breasts, DD cup",
      ],
      chestTemplate: "{cup}",
      waistTiers: [
        { max: 30,  phrase: "a very narrow waist and flat stomach, sharply defined" },
        { max: 69,  phrase: "average waist", skipInPrompt: true },
        { max: 100, phrase: "a thick waist and soft rounded stomach, little waist definition" },
      ],
      hipsTiers: [
        { max: 30,  phrase: "narrow straight hips, barely wider than the waist" },
        { max: 69,  phrase: "average hips", skipInPrompt: true },
        { max: 100, phrase: "wide flaring hips, broad across the hips and thighs" },
      ],
      heightMeasurementTemplate: "{cm} cm tall",
      // Shown as the first option on every body and colour field, and as the
      // off state of the height slider. A field left here is not described at
      // all: no phrase in any prompt, and no diff against the base image, so
      // the hold that covers it survives a regeneration. It is what the app
      // always did for a field you had not touched — the difference is that
      // now you can see which fields those are, and say so deliberately.
      unsetLabel: "Leave as it is",
      // Facial structure traits, randomised per generation. Without these the
      // model lands on the same default face nearly every time; seed changes
      // alone do not move identity much. All ethnicity-neutral so they vary the
      // face without fighting the user's own settings.
      faceVariationPools: [
        ["oval face", "round face", "heart-shaped face", "square jawline", "angular face", "soft rounded features", "long narrow face", "wide cheekbones"],
        ["high cheekbones", "subtle cheekbones", "full cheeks", "hollow cheeks", "broad forehead", "narrow forehead"],
        ["small straight nose", "slightly upturned nose", "narrow nose", "broader nose", "aquiline nose", "rounded nose tip"],
        ["full lips", "thin lips", "wide mouth", "small mouth", "cupid's bow lips", "asymmetric smile"],
        ["close-set eyes", "wide-set eyes", "deep-set eyes", "almond-shaped eyes", "hooded eyelids", "large round eyes"],
        ["light freckles across the nose", "a small beauty mark", "clear unblemished skin", "faint laugh lines", "a slightly crooked front tooth", "a small scar through one eyebrow"],
      ],
      // One trait from each of a random subset of pools — taking every pool
      // every time over-specifies the face and starts producing the same
      // composite again.
      faceVariationPoolCount: 4,

      // ── Face editor ────────────────────────────────────────────────────────
      // Everything the face editor offers, table-driven so the modal is just a
      // renderer. Each group lists its fields; each field is a list of
      // { value, phrase } — `value` is what is stored on the character and
      // shown in the dropdown, `phrase` is what reaches the image model. An
      // empty `phrase` means the option contributes nothing to the prompt,
      // which is how every "None"/"Natural" default stays silent rather than
      // telling the model to render an absence.
      face: {
        // Wrapped around the joined phrases in the image prompt. A group may
        // override it with a `template` of its own — hair is described, not
        // worn, so "wearing long hair" would be wrong. Groups sharing a
        // template are emitted together under one copy of it, so three groups
        // of worn things read as one "wearing a, b, c" rather than three.
        template: "wearing {phrases}",
        // Structure phrases are appended plainly — they describe the face
        // itself rather than something worn on it.
        structureTemplate: "{phrases}",
        // Prepended to the change request when regenerating from an existing
        // base image, so the model edits the face rather than replacing it.
        // Note it holds identity and skin but says nothing about hair: hair is
        // now editable, so what holds it still is the hair group's own
        // holdWhenUnset clause, emitted only while nothing in that group is set.
        editPreamble: "same person, same face and identity as the reference image, same skin tone and colouring",
        // Used instead when the identity anchor is deliberately loosened for a
        // bone-structure change, which img2img otherwise resists.
        editPreambleLoose: "the same person with the same hair colour, skin tone and colouring, restyled facial structure",
        // Everything the edit must leave alone. The face editor changes a face;
        // it is not a request for a new photograph of that person, so the shot
        // itself — its crop, distance, pose, clothing and background — has to be
        // named as fixed. Without this the model returns a portrait no matter
        // what the reference was, because a prompt about a face reads as a brief
        // for a headshot.
        editFraming: "keep the reference image's exact framing, camera distance, crop, pose, clothing and background — reproduce the same photograph, changing only the head",
        // Appended to every face-editor generation. Deliberately says nothing
        // about composition or shot type: editFraming above is what decides
        // those, and a second opinion here would only argue with it.
        editSuffix: "photorealistic, natural lighting, sharp focus, high detail",
        groups: [
          {
            key: "hair",
            label: "Hair",
            tab: "Hair",
            // Described rather than worn.
            template: "{phrases}",
            // Emitted while every field in this group is untouched, to stop the
            // hair drifting on an edit that was only ever about makeup. Once
            // any field here is set the clause is dropped, because holding the
            // hair still and restyling it in the same prompt is a contradiction
            // the model resolves by ignoring one of them at random.
            holdWhenUnset: "same hairstyle and hair colour as the reference image",
            fields: [
              { key: "length", label: "Length", options: [
                { value: "None", phrase: "" },
                { value: "Shaved", phrase: "shaved head" },
                { value: "Buzz cut", phrase: "buzz cut" },
                { value: "Pixie", phrase: "short pixie cut" },
                { value: "Short", phrase: "short hair" },
                { value: "Chin-length", phrase: "chin-length bob" },
                { value: "Shoulder-length", phrase: "shoulder-length hair" },
                { value: "Long", phrase: "long hair" },
                { value: "Very long", phrase: "very long hair past the waist" },
              ] },
              { key: "texture", label: "Texture", options: [
                { value: "None", phrase: "" },
                { value: "Straight", phrase: "straight hair" },
                { value: "Sleek", phrase: "sleek, glossy hair" },
                { value: "Wavy", phrase: "wavy hair" },
                { value: "Curly", phrase: "curly hair" },
                { value: "Tight curls", phrase: "tightly coiled curls" },
                { value: "Afro", phrase: "natural afro" },
                { value: "Messy", phrase: "tousled, messy hair" },
              ] },
              { key: "style", label: "Worn", options: [
                { value: "None", phrase: "" },
                { value: "Loose", phrase: "hair worn loose" },
                { value: "Ponytail", phrase: "hair tied back in a ponytail" },
                { value: "High ponytail", phrase: "hair in a high ponytail" },
                { value: "Bun", phrase: "hair in a bun" },
                { value: "Messy bun", phrase: "hair in a loose messy bun" },
                { value: "Braid", phrase: "hair in a single braid" },
                { value: "Braids", phrase: "hair in braids" },
                { value: "Half-up", phrase: "hair half up, half down" },
                { value: "Tucked behind ears", phrase: "hair tucked behind the ears" },
                { value: "Updo", phrase: "hair in an elegant updo" },
              ] },
              { key: "fringe", label: "Fringe", options: [
                { value: "None", phrase: "" },
                { value: "No fringe", phrase: "no fringe, hair swept back off the forehead" },
                { value: "Blunt fringe", phrase: "a blunt fringe" },
                { value: "Wispy fringe", phrase: "a soft wispy fringe" },
                { value: "Side-swept", phrase: "a side-swept fringe" },
                { value: "Curtain fringe", phrase: "a curtain fringe framing the face" },
                { value: "Side parting", phrase: "a deep side parting" },
                { value: "Centre parting", phrase: "a centre parting" },
              ] },
            ],
          },
          {
            key: "makeup",
            label: "Makeup",
            tab: "Face",
            fields: [
              { key: "style", label: "Overall", options: [
                { value: "None", phrase: "" },
                { value: "Bare face", phrase: "no makeup, bare skin" },
                { value: "Natural", phrase: "soft natural everyday makeup" },
                { value: "Everyday", phrase: "light everyday makeup" },
                { value: "Polished", phrase: "polished, well-blended makeup" },
                { value: "Glam", phrase: "full glam makeup, flawless base, contoured" },
                { value: "Smoky", phrase: "smoky eye makeup" },
                { value: "Bold", phrase: "bold, high-contrast makeup" },
                // Not "gothic", and no "pale base". "Gothic" reads to an image
                // model as theatrical — stage paint, Halloween, vampire — and
                // "pale base" is a literal instruction to whiten her over the
                // skin tone the base image already establishes. Together they
                // produced corpse paint. Naming the individual features instead
                // gets the subculture look without the costume, and "natural
                // skin tone" defends the base image's own colouring.
                { value: "Goth", phrase: "understated everyday goth makeup, smudged black eyeliner, dark smoky eyeshadow, deep plum-black lip, natural skin tone" },
                { value: "Editorial", phrase: "editorial high-fashion makeup" },
              ] },
              { key: "lips", label: "Lips", options: [
                { value: "None", phrase: "" },
                { value: "Nude", phrase: "nude lipstick" },
                { value: "Soft pink", phrase: "soft pink lipstick" },
                { value: "Rose", phrase: "rose lipstick" },
                { value: "Berry", phrase: "berry lipstick" },
                { value: "Classic red", phrase: "classic red lipstick" },
                { value: "Deep red", phrase: "deep red lipstick" },
                { value: "Plum", phrase: "plum lipstick" },
                { value: "Black", phrase: "black lipstick" },
                { value: "Glossy", phrase: "clear lip gloss, glossy lips" },
              ] },
              { key: "eyes", label: "Eye makeup", options: [
                { value: "None", phrase: "" },
                { value: "Subtle liner", phrase: "subtle eyeliner" },
                { value: "Winged liner", phrase: "winged eyeliner" },
                { value: "Heavy liner", phrase: "heavy black eyeliner" },
                { value: "Smoky", phrase: "smoky shadow around the eyes" },
                { value: "Shimmer", phrase: "shimmering eyeshadow" },
                { value: "Warm tones", phrase: "warm-toned eyeshadow" },
                { value: "Cool tones", phrase: "cool-toned eyeshadow" },
                { value: "Graphic", phrase: "graphic liner" },
              ] },
              { key: "lashes", label: "Lashes", options: [
                { value: "None", phrase: "" },
                { value: "Natural", phrase: "natural lashes" },
                { value: "Defined", phrase: "defined mascara" },
                { value: "Long", phrase: "long lashes" },
                { value: "Dramatic", phrase: "dramatic false lashes" },
              ] },
              { key: "cheeks", label: "Cheeks", options: [
                { value: "None", phrase: "" },
                { value: "Soft blush", phrase: "soft blush" },
                { value: "Flushed", phrase: "flushed cheeks" },
                { value: "Contoured", phrase: "contoured cheekbones" },
                { value: "Highlighted", phrase: "highlighter on the cheekbones" },
                { value: "Dewy", phrase: "dewy, luminous skin" },
                { value: "Matte", phrase: "matte complexion" },
              ] },
              { key: "brows", label: "Brows", options: [
                { value: "None", phrase: "" },
                { value: "Natural", phrase: "natural eyebrows" },
                { value: "Groomed", phrase: "neatly groomed eyebrows" },
                { value: "Thick", phrase: "thick full eyebrows" },
                { value: "Thin", phrase: "thin arched eyebrows" },
                { value: "Straight", phrase: "straight eyebrows" },
                { value: "Sharp arch", phrase: "sharply arched eyebrows" },
              ] },
            ],
          },
          {
            key: "eyewear",
            label: "Eyewear",
            tab: "Face",
            fields: [
              { key: "type", label: "Type", options: [
                { value: "None", phrase: "" },
                { value: "Glasses", phrase: "glasses" },
                { value: "Round glasses", phrase: "round wire glasses" },
                { value: "Square glasses", phrase: "square-framed glasses" },
                { value: "Cat-eye glasses", phrase: "cat-eye glasses" },
                { value: "Rimless glasses", phrase: "rimless glasses" },
                { value: "Oversized glasses", phrase: "oversized glasses" },
                { value: "Reading glasses", phrase: "reading glasses low on the nose" },
                { value: "Sunglasses", phrase: "sunglasses" },
                { value: "Aviators", phrase: "aviator sunglasses" },
                { value: "Wayfarers", phrase: "wayfarer sunglasses" },
              ] },
              { key: "frame", label: "Frames", options: [
                { value: "None", phrase: "" },
                { value: "Black", phrase: "black frames" },
                { value: "Tortoiseshell", phrase: "tortoiseshell frames" },
                { value: "Gold wire", phrase: "thin gold wire frames" },
                { value: "Silver wire", phrase: "thin silver wire frames" },
                { value: "Clear", phrase: "clear acetate frames" },
                { value: "Red", phrase: "red frames" },
                { value: "Tinted lenses", phrase: "lightly tinted lenses" },
              ] },
            ],
          },
          {
            key: "extras",
            label: "Details",
            tab: "Face",
            fields: [
              { key: "freckles", label: "Freckles", options: [
                { value: "None", phrase: "" },
                { value: "Light", phrase: "light freckles across the nose" },
                { value: "Heavy", phrase: "heavy freckles across the cheeks and nose" },
              ] },
              { key: "mark", label: "Mark", options: [
                { value: "None", phrase: "" },
                { value: "Beauty mark", phrase: "a small beauty mark above the lip" },
                { value: "Cheek mole", phrase: "a small mole on one cheek" },
                { value: "Brow scar", phrase: "a small scar through one eyebrow" },
                { value: "Dimples", phrase: "dimples" },
              ] },
              { key: "piercing", label: "Piercing", options: [
                { value: "None", phrase: "" },
                { value: "Nose stud", phrase: "a small nose stud" },
                { value: "Nose ring", phrase: "a nose ring" },
                { value: "Septum", phrase: "a septum ring" },
                { value: "Eyebrow", phrase: "an eyebrow piercing" },
                { value: "Lip", phrase: "a lip piercing" },
                { value: "Earrings", phrase: "earrings" },
                { value: "Multiple ear", phrase: "multiple ear piercings" },
              ] },
            ],
          },
        ],
        // Facial structure. Sourced from the same trait vocabulary as
        // faceVariationPools so a face picked at random and a face set by hand
        // describe themselves the same way to the model. Each field's "Any"
        // option leaves that trait unspecified, which is what an existing
        // character starts on so nothing about their face changes until it is
        // deliberately set.
        structureTab: "Face",
        structure: [
          { key: "shape",      label: "Face shape",  options: ["Any", "oval face", "round face", "heart-shaped face", "square jawline", "angular face", "soft rounded features", "long narrow face", "wide cheekbones"] },
          { key: "cheekbones", label: "Cheeks",      options: ["Any", "high cheekbones", "subtle cheekbones", "full cheeks", "hollow cheeks", "broad forehead", "narrow forehead"] },
          { key: "nose",       label: "Nose",        options: ["Any", "small straight nose", "slightly upturned nose", "narrow nose", "broader nose", "aquiline nose", "rounded nose tip"] },
          { key: "mouth",      label: "Mouth",       options: ["Any", "full lips", "thin lips", "wide mouth", "small mouth", "cupid's bow lips", "asymmetric smile"] },
          { key: "eyeShape",   label: "Eye shape",   options: ["Any", "close-set eyes", "wide-set eyes", "deep-set eyes", "almond-shaped eyes", "hooded eyelids", "large round eyes"] },
          { key: "skinDetail", label: "Skin",        options: ["Any", "clear unblemished skin", "faint laugh lines", "light freckles across the nose", "weathered skin", "soft youthful skin"] },
        ],
        // The sentinel meaning "leave this trait alone".
        unsetValue: "Any",
        // Options whose value means "nothing here" across the grouped fields.
        noneValue: "None",
        // Offered on every field, and never listed in the option lists — the
        // editor appends it. Selecting it reveals a text box whose contents go
        // into the prompt verbatim, so a list can stay short without becoming a
        // limit. Stored in a companion "<key>Custom" entry.
        customValue: "Custom",
      },

      // ── Vibe randomising ────────────────────────────────────────────────────
      // What "generate from a vibe" fills in, for the fields that have a
      // "nothing here" option. Picking uniformly would be wrong: fourteen
      // tattoo options and an even draw means nine characters in ten come out
      // tattooed, and most people are not. So each field says how often it
      // should be left alone, and the draw only happens the rest of the time.
      randomise: {
        defaultNoneChance: 0.45,
        noneChance: {
          // Makeup: most characters wear some, few wear all of it.
          "makeup.style": 0.3,
          "makeup.lips": 0.4,
          "makeup.eyes": 0.45,
          "makeup.lashes": 0.55,
          "makeup.cheeks": 0.6,
          "makeup.brows": 0.5,
          // Hair: shape it nearly always, since "unspecified hair" is a
          // wasted opportunity on a character being invented from nothing.
          "hair.length": 0.15,
          "hair.texture": 0.15,
          "hair.style": 0.4,
          "hair.fringe": 0.5,
          // Glasses are a strong visual choice and most people do not wear
          // them in a photograph.
          "eyewear.type": 0.82,
          "eyewear.frame": 0.2,
          "extras.freckles": 0.65,
          "extras.mark": 0.7,
          "extras.piercing": 0.7,
          // Interesting light is the point of the setting, so it is usually on.
          "avatar.lighting": 0.2,
        },
        // Within a field, not every option is equally likely in life. An even
        // draw across eight lengths shaves or buzzes one character in five,
        // which says more about the length of the list than about anybody.
        // Unlisted options weigh 1.
        optionWeights: {
          "hair.length": { "Pixie": 0.5, "Very long": 0.5 },
          "makeup.style": { "Goth": 0.4, "Editorial": 0.3, "Bold": 0.6 },
          "makeup.lips": { "Black": 0.2 },
          "extras.piercing": { "Multiple ear": 0.6, "Lip": 0.5, "Septum": 0.5 },
        },
        // Options the randomiser never offers, however the weights fall. A
        // shaved or buzzed head is a strong statement about a person rather
        // than a detail of their appearance, and a generator that hands it out
        // by chance is making that statement on the user's behalf. Still there
        // to be chosen deliberately.
        neverRandom: {
          "hair.length": ["Shaved", "Buzz cut"],
        },
        // A field that only makes sense once another is set. Frames with no
        // glasses is not a look.
        requires: { "eyewear.frame": "eyewear.type" },
        // And a field that stops making sense once another says something
        // particular. Drawing independently gave shaved heads worn in a
        // ponytail — a combination each half of which is fine alone, which is
        // exactly what independent draws cannot see.
        skipWhen: {
          "hair.style": { "hair.length": ["Shaved", "Buzz cut"] },
          "hair.fringe": { "hair.length": ["Shaved", "Buzz cut"] },
          "hair.texture": { "hair.length": ["Shaved", "Buzz cut"] },
        },
        // Never drawn.
        //
        // Facial structure, because it is what pickFaceVariation randomises
        // afresh on every generation so each press of Regen offers a different
        // face to choose between — pinning it here would fix the face at the
        // first attempt.
        //
        // Tattoos, because they are a decision about a person rather than a
        // detail of one. A vibe can reasonably guess at hair and makeup; it
        // cannot guess whether this character is someone who has tattoos.
        skipGroups: ["structure", "body"],
      },

      // ── Body & tattoos ──────────────────────────────────────────────────────
      // The base image is nude on purpose: it is the only thing passed to the
      // image model, clothing is decided per scene in chat, and tattoos hidden
      // under clothes in the reference are tattoos the model never learns
      // about. It is never displayed — avatarImage is what the UI renders.
      body: {
        customValue: "Custom",
        noneValue: "None",
        // Cropped at mid-thigh rather than head-to-toe. Full length shows the
        // last few tattoos at the cost of shrinking the face to a handful of
        // pixels, and the face is the thing this image exists to anchor.
        baseFraming: "full body nude, standing straight facing the camera, framed from mid-thigh upwards, arms relaxed at the sides and fully visible, plain neutral grey studio background, even soft lighting, whole body in frame",
        baseNudeClause: "completely nude, no clothing of any kind, all skin visible",
        // Continuity line. The restyled variant is used once the identity hold
        // below has been released, because "same face" and a new ethnicity in
        // one prompt is a contradiction the model settles by ignoring one of
        // them — the same trap the hair hold fell into in the face editor.
        basePreamble: "the same person as the reference image",
        basePreambleRestyled: "the same character as the reference image, restyled to match the description below",
        // Everything the regeneration should NOT change, stated aspect by
        // aspect. A hold is emitted only while every appearance field that
        // would contradict it is unchanged, and drops out the moment one of
        // them is edited — so changing the skin tone frees the skin and
        // nothing else, and the rest stay pinned rather than drifting because
        // the model had no instruction either way.
        //
        // Holding unchanged aspects explicitly matters as much as releasing
        // changed ones: it is what makes a small edit a small edit.
        // Releasing a hold is not the same as asking for a change, which is what
        // made a chest edit a no-op: dropping "the same body shape" left a
        // prompt that never mentioned a change at all, so the reference image
        // passed as inputImage — a whole photograph — outvoted the one word
        // that had moved. Every released hold now names itself here, and the
        // resulting clause leads the prompt, ahead of the continuity preamble.
        baseChangeTemplate: "{aspects} must be changed to match the description below, and deliberately drawn differently from the reference image",
        baseChangeJoin: " and ",
        baseHolds: [
          // face.structure is here for the same reason ethnicity is: reshaping
          // the face is the one face-editor change that cannot happen while the
          // identity hold stands. Makeup, eyewear and details are additive —
          // they contradict nothing, so they release nothing.
          { identity: true, phrase: "the same face, features and identity as the reference image",
            change: "the face and features",
            keys: ["ethnicity", "ethnicityCustom", "face.structure"] },
          { phrase: "the same hair colour and hairstyle as the reference image",
            change: "the hair colour and hairstyle",
            keys: ["hairColour", "hairColourCustom", "face.hair"] },
          { phrase: "the same eye colour as the reference image",
            change: "the eye colour",
            keys: ["eyeColour", "eyeColourCustom"] },
          { phrase: "the same skin tone as the reference image",
            change: "the skin tone",
            keys: ["skinTone", "skinToneCustom", "ethnicity", "ethnicityCustom"] },
          { phrase: "the same body shape and proportions as the reference image",
            change: "the body shape, breast size and proportions",
            keys: ["height", "build", "buildCustom", "chest", "chestCustom", "waist", "waistCustom", "hips", "hipsCustom"] },
          { phrase: "the same tattoos, in the same places, as the reference image",
            change: "the tattoos",
            keys: ["body"] },
        ],
        baseSuffix: "photorealistic, natural skin texture, sharp focus, high detail",
        // Turning an uploaded photograph into a base image. The photograph is
        // the whole description here — no appearance settings are sent at all,
        // because a slider that says "athletic" cannot improve on a picture of
        // the actual person, and where the two disagree the words would pull
        // the result away from the face that was uploaded.
        uploadPreamble: "the exact same person as the reference photograph, photographed again as a plain full-body reference photo",
        uploadHold: "keep their face, hair, body shape, proportions, breast size and any tattoos or marks exactly as they are in the photograph, changing only the pose, framing, clothing and background",
        // Said separately from the hold above, and the hold no longer mentions
        // skin tone, because the two were contradicting each other on a black
        // and white photograph: "keep the skin tone exactly as it is" means
        // grey, and grey is what came back. Colouring is the one thing a
        // monochrome reference genuinely cannot supply, so it is asked for
        // outright rather than held.
        uploadColour: "a full colour photograph with natural realistic colouring — if the reference photograph is black and white, greyscale or heavily filtered, render them in plausible natural colour, with lifelike skin tone, hair colour and eye colour, never in greyscale",
        // Said explicitly rather than left unsaid: an unstated absence lets the
        // model invent tattoos, and a base image is the last place you want a
        // detail arriving by accident.
        noTattoos: "clean unmarked skin, no tattoos",
        // "Leave as it is" for the tattoo field, and the only value that stops
        // the absence being stated. A base image generated from a photograph
        // must not be told "clean unmarked skin" — that erases whatever ink
        // the photograph shows, which is the one place tattoos are recorded.
        unsetValue: "Any",
        fields: [
          { key: "tattoos", label: "Tattoos", options: [
            { value: "Any", phrase: "" },
            { value: "None", phrase: "clean unmarked skin, no tattoos" },
            { value: "One small tattoo", phrase: "a single small tattoo" },
            { value: "One arm", phrase: "tattoos on one arm" },
            { value: "Both arms", phrase: "tattoos on both arms" },
            { value: "Full sleeve", phrase: "a full tattoo sleeve on one arm" },
            { value: "Both sleeves", phrase: "full tattoo sleeves on both arms" },
            { value: "Chest", phrase: "a chest tattoo" },
            { value: "Back piece", phrase: "a large back tattoo" },
            { value: "Ribs", phrase: "a tattoo along the ribs" },
            { value: "Thigh", phrase: "a thigh tattoo" },
            { value: "Neck", phrase: "a neck tattoo" },
            { value: "Hands", phrase: "tattooed hands and fingers" },
            { value: "Scattered", phrase: "several small tattoos scattered across the body" },
            { value: "Heavily covered", phrase: "heavily tattooed, most of the body covered in tattoos" },
          ] },
        ],
        // The avatar is display only and never reaches the image model, so it
        // is free to be a flattering clothed portrait with no consequences for
        // what gets generated in chat.
        avatarPreamble: "same person, same face and identity as the reference image",
        avatarFraming: "head and shoulders portrait, fully clothed",
        // The outfit used to be baked into the framing as "an everyday top",
        // which is why every avatar looked the same. It is its own clause now,
        // filled from the character or, failing that, by asking the language
        // model what this particular person would be wearing.
        avatarOutfitTemplate: "wearing {outfit}",
        avatarOutfitFallback: "an everyday top",
        avatarOutfitPrompt: "Here is a character:\n\n{desc}\n\nName one outfit they would plausibly be photographed in — the kind of thing that says who they are. A nurse in scrubs, a runner in running kit, a barrister in court dress. Reply with the clothing only, as a short noun phrase of at most eight words, no name, no sentence, no full stop. Examples: \"green surgical scrubs and a lanyard\", \"a worn leather jacket over a band tee\".",
        avatarLightingFallback: "natural lighting",
        avatarBackground: "background that suits them, softly out of focus",
        avatarSuffix: "photorealistic, sharp focus, high detail",
        // Avatar-only settings. Kept apart from the appearance fields because
        // they describe the photograph rather than the person: the same
        // character can be shot in daylight or neon without being any
        // different underneath.
        avatarFields: [
          { key: "lighting", label: "Lighting", options: [
            { value: "None", phrase: "" },
            { value: "Soft daylight", phrase: "soft natural daylight from a window" },
            { value: "Golden hour", phrase: "warm golden hour sunlight, long soft shadows" },
            { value: "Overcast", phrase: "flat soft overcast daylight" },
            { value: "Studio", phrase: "clean studio lighting, soft key light" },
            { value: "Low key", phrase: "low key lighting, deep shadows, one soft source" },
            { value: "Rim light", phrase: "rim lighting separating her from a dark background" },
            { value: "Backlit", phrase: "backlit by a bright window, soft halo through the hair" },
            { value: "Neon", phrase: "neon city light, magenta and cyan on the skin" },
            { value: "Candlelight", phrase: "warm candlelight, soft flickering glow" },
            { value: "Hard sun", phrase: "hard midday sunlight, crisp shadows" },
            { value: "Firelight", phrase: "firelight from below, warm amber glow" },
            { value: "Streetlight", phrase: "sodium streetlight at night, warm pool of light" },
          ] },
        ],
      },
    },

    // ── Age-appropriate voice ────────────────────────────────────────────────
    // The pet-names slider says how OFTEN a character reaches for an
    // endearment, never WHICH ones, so every character defaulted to the same
    // "hun"/"darling" register — which reads as a middle-aged voice coming out
    // of a 20-year-old. The character's age is already in the prompt but
    // nothing connected it to their vocabulary. This does.
    //
    // Deliberately no current slang. Specific slang dates faster than anything
    // else in this file, and a character reaching for last year's meme sounds
    // more out of character than one using no slang at all — so the bands give
    // a register and a few durable terms, and the note below rules out
    // impressions. Add specific terms here if you want them.
    ageVoice: {
      template: "\n\n[VOICE — you are {age}] {register}{endearments} Speak like a real person of your age, not an impression of one: no dated internet slang, no meme phrases, and none of the endearments an older generation would use.{banned}",
      // Emitted when no age is set, so the ban below still reaches the model
      // for a character whose age was never filled in.
      templateNoAge: "\n\n[VOICE]{banned}",
      // Terms the character must never use. Listing a word in a prohibition can
      // make a model reach for it, and small models handle negation poorly, so
      // these are also stripped from every band above rather than banned and
      // recommended in the same prompt. Add or remove terms here.
      bannedTerms: ["babe", "hon"],
      bannedTemplate: " Never use the words {terms}. Not as an endearment, not shortened, not in any form, no matter how casual or intimate the moment — they are wrong for this character and always jarring. Choose something else every time.",
      // Only the first band whose `max` the age falls at or below is used.
      bands: [
        { max: 22, register: "You talk like someone in their late teens or early twenties: casual, quick, understated. Humour is dry, ironic and self-deprecating rather than corny — you undercut things rather than gushing about them. Enthusiasm is played down, not up.",
          endearments: " If you use endearments at all they are sparing and unfussy — mostly their actual name, or a shortened version of it." },
        { max: 29, register: "You talk like someone in their twenties: relaxed and current, warm without being sentimental. Humour is quick and a bit deadpan.",
          endearments: " Endearments run to \"baby\" or a nickname made from their name." },
        { max: 39, register: "You talk like someone in their thirties: easy and natural, warm, comfortable teasing without trying to sound young.",
          endearments: " Endearments run to \"love\", \"sweetheart\", or their name." },
        { max: 54, register: "You talk like someone in their forties or early fifties: assured and warm, with a drier, more knowing sense of humour.",
          endearments: " Endearments run to \"love\", \"sweetheart\", occasionally \"darling\"." },
        { max: 69, register: "You talk like someone in their late fifties or sixties: warm and unhurried, affectionate without being effusive, humour gentle and wry.",
          endearments: " Endearments run to \"love\", \"sweetheart\", \"dear\", \"pet\"." },
        { max: 200, register: "You talk like someone in their seventies or beyond: warm, direct, unhurried, with an old-fashioned turn of phrase and a gentle, teasing humour.",
          endearments: " Endearments run to \"dear\", \"sweetie\", \"love\", \"duck\"." },
      ],
      // Said instead of the band's endearments when the pet-names slider is at
      // its lowest tier or switched off — the register still applies, but
      // nothing should be nudging them toward endearments they do not use.
      noEndearments: " You do not use endearments; this describes your general speech register only.",
    },

    // ── Private intentions ───────────────────────────────────────────────────
    // Things the character wants and works toward quietly across many turns —
    // asking the user out, getting them to the pool, steering the evening
    // somewhere. The hard part is not storing a goal, it is stopping the model
    // from simply achieving it in the very next message, which is worse than
    // having no intentions at all. Two things hold it back: the pacing rules,
    // and a gate that keeps the character from acting until progress has
    // caught up with how much nerve the goal takes for them specifically.
    // ── Memory ───────────────────────────────────────────────────────────────
    // Story So Far / Key Facts, kept up to date as the conversation runs rather
    // than only when the owner opens the panel and presses the button.
    //
    // The update is INCREMENTAL: the model is handed the memory as it stands
    // plus only the exchanges since the last update, and asked to fold one into
    // the other. A full re-summarise of the recent window (what the manual
    // button does) cannot accumulate — anything that scrolled out of the window
    // is simply gone from the next summary, so a long conversation kept
    // forgetting its own beginning.
    memory: {
      enabled: true,
      // Non-image messages that must accumulate before an update runs. Every
      // update is an extra model call, so this is the cost dial: 8 is roughly
      // four exchanges.
      everyTurns: 8,
      // How much of the new conversation to send. Only the turns since the last
      // update go in, so this rarely binds.
      excerptChars: 6000,
      // Caps on what comes back, enforced in code as well as asked for in the
      // prompt. These two strings sit in EVERY system prompt from here on, so
      // an unbounded summary quietly becomes the largest thing in the prompt.
      maxSummaryChars: 1400,
      maxFactsChars: 1400,
      // {name} {summary} {facts} {recent}
      updatePrompt: `You maintain the long-term memory of a roleplay conversation between a user and {name}.

Here is the memory as it currently stands.

STORY SO FAR:
{summary}

KEY FACTS:
{facts}

Here is what has happened SINCE that memory was last updated:
{recent}

Update the memory so it accounts for the new events. Rules:
- Build on what is already there. Keep everything still true, in roughly its existing wording. You are revising a document, not writing a new one.
- Only drop something if the new events have made it wrong or superseded it, and then say the corrected version instead.
- Do not invent anything that is not in the memory or the new events.
- "Story so far" is a flowing narrative of the relationship — what has happened, how things stand between them. Keep it under {summaryLimit} characters, condensing older material as it grows rather than dropping it.
- Record EVENTS, not the texture of the conversation. "They are chatting", "getting to know each other", "exchanging compliments", "enjoying each other's company" are not things that happened — they are what a stretch of talk feels like, and written down they come back into every later prompt as the plot, which is how a stalled conversation teaches itself to keep stalling. Name what was said, decided, revealed, offered, refused or done, or say nothing.
- If nothing of substance happened since the last update, return the narrative unchanged rather than padding it with how the talk was going.
- "Key facts" is a terse list, one item per line, of things worth remembering exactly: names, places, promises, preferences, milestones, physical details mentioned. No more than {factsLimit} characters.

Return ONLY a JSON object: {"summary": "...", "facts": "..."}`,
    },

    intentions: {
      maxActive: 2,
      header: "\n\n[PRIVATE INTENTIONS — yours alone, never stated outright]\n",
      // The brake, for goals that are still being worked up to. It is written
      // for the early stages and used to be appended at EVERY stage, which
      // capped a goal that had reached the point of acting at "one small step,
      // a hint, a suggestion dropped lightly, and let it drop if they do not
      // take it up" — so a fully set-up intention could never be carried out.
      pacing: "\n\nThese are private. Never announce them, never explain them, never let them run the conversation. At most ONE small, natural step toward ONE of them per reply — a question, a hint, an excuse to keep them talking, a suggestion dropped lightly — and only when the conversation offers an opening. If there is no natural opening this turn, do nothing about them at all; they simply sit in the back of your mind. If the user deflects, changes the subject, or does not take you up on it, let it drop for now rather than pushing.",
      // Used instead once a goal has reached the point of acting. The brake
      // comes off: the whole approach was for this.
      // Kept short on purpose. The long version of this said the right things
      // and still lost: it sat at the end of a prompt already carrying three
      // [CRITICAL] blocks, and a paragraph of general guidance does not
      // compete with those. The specific, named directive in readyDirective
      // does the work; this is just the framing around it.
      pacingReady: "\n\nThese are private — never announce them or explain what you are doing. But one of them is ready: the groundwork is done, and it is no longer something to work up to.",
      // Appended last, naming the actual goal. An instruction to \"act on it\"
      // is abstract enough that a tamer, safer version of the goal still
      // satisfies it; naming the goal and the fact that it happens THIS reply
      // leaves nothing to soften.
      readyDirective: "\n\n[THIS TURN — DO IT] You are going to {goal}. It happens in this reply, described in your own narration as something you do. Not a suggestion of it, not a question about it, not a hint, and not a milder version of it. Act first and stop before their reaction — do not wait to be told you may.",

      // The same mechanism as readyDirective, for a goal that is NOT ready yet
      // — which, until now, got no turn-level message at all. That was the
      // whole weakness: readyDirective exists because this repo established
      // that a named instruction placed as the last message before generation
      // beats the same words sitting thousands of tokens earlier in the system
      // prompt. Everything below the acting stage was relying on exactly the
      // placement already known to lose, so an intention was inert until the
      // turn it went ready, and it could not go ready without moves it was
      // never being asked to make.
      //
      // Deliberately much milder than readyDirective: it asks for ONE thing
      // that serves the goal, not for the goal. How overt that thing is comes
      // from the stage note in the system prompt; this only insists that the
      // reply is not purely a response to what was just said.
      workingDirective: "\n\n[THIS TURN] Privately, you are working toward: {focus}. Something in this reply has to serve it — a question asked, a reason made to stay or to move somewhere, something offered, something given away about yourself, the subject steered. Do not announce it, do not explain it, and do not make the whole reply about it. But do not let this reply be nothing but an answer to what they just said: if the conversation has not handed you an opening, make one.",

      // A goal can have prerequisite steps: things that have to happen before
      // the goal itself is even possible ("buy the ingredients" before "bake
      // the cake" before the goal, "eat it"). Only the current step is shown —
      // handed the whole ladder a model narrates the plan instead of walking
      // it. The steps are groundwork only: finishing the last one does not
      // achieve the goal, it unlocks it, and the goal then runs its own climb
      // against its own nerve exactly as an unstaged goal always has.
      stepLine: " Before that is even possible, the thing to do right now is: {step}.",
      // The do-it-now directive for a STEP rather than the goal. Deliberately
      // milder than readyDirective: a step is a piece of groundwork, and the
      // reply should not read as though the goal itself just happened.
      stepReadyDirective: "\n\n[THIS TURN — DO IT] You are going to {step}. It happens in this reply, described in your own narration as something you do. This is groundwork toward {goal}, not that goal itself — do not skip ahead to it. Act first and stop before their reaction.",
      // Steps the wardrobe tracker can settle on its own, without asking a
      // model anything. Undressing is the step that has been wrongly ticked
      // every time, and it is also the one piece of state this app tracks
      // exactly: if charOutfit still lists a yellow floral dress, she is not
      // naked, and no reading of the scene gets to say otherwise.
      //
      // `match` is tested against the step or goal text, `clearWhen` against
      // the outfit the tracker holds. While the outfit says anything that is
      // not one of these, the step cannot be ticked off by any route.
      outfitGuard: {
        match: "naked|nude|undress|strip|take off (my|your|her) clothes|get out of (my|your|her) (clothes|dress)|clothes off",
        clearWhen: "^\\s*$|naked|nude|nothing|undressed|bare|a towel",
      },

      // Ceiling on the rungs in a goal's ladder, and the nerve a generated step
      // is given when the model does not supply one.
      //
      // Was 4, and the prompt beside it asked for steps only where the goal was
      // literally impossible without them — so most goals had none and were
      // judged against the goal itself from the first turn, which is a leap
      // rather than a climb. Each rung runs its own climb against its own
      // nerve, so a longer ladder is what "works up to it" actually means: the
      // character stays on the thing across many more turns, and each rung is
      // small enough to be describable, which is also what makes it possible to
      // tell whether it happened.
      maxSteps: 6,
      defaultStepNerve: 15,
      // Said per intention, in place of a number: a model handed "progress
      // 25/70" tends to narrate the number rather than act on it.
      // What progress MEANS: how far the approach has come, nothing else. Seven
      // bands rather than four so the climb is a gradient instead of three
      // plateaus and a cliff, which is what made it read as sudden.
      //
      // Every band is an INSTRUCTION, not a status report. Six of these seven
      // used to be pure description — "nothing has come of it yet", "the
      // subject has been circled" — telling the character where she stood and
      // never what to do about it. Only the last one had a verb in it. So
      // below the acting stage an intention was a fact about her rather than
      // something she was doing, and a character with a goal behaved exactly
      // like a character without one until the judge decided otherwise. The
      // judge, meanwhile, only pays for moves. Nothing moved.
      //
      // Progress now governs how OVERT she is, never whether she is trying.
      // She is always trying; early on it is deniable and late on it is plain.
      stages: [
        { max: 0.15, note: "Nothing has come of this yet, so this reply is where it starts. Do one thing that serves it — ask what you need to know, steer what you are talking about, find a reason to be near them or to keep them here. Small enough to deny, but do it." },
        { max: 0.30, note: "A beginning has been made. Build on it rather than starting over: follow what you learned last time, or take the next small move it opened up. Still nothing said outright." },
        { max: 0.45, note: "It has been edged toward once or twice. Close more of the distance this reply — go a step further than you went last time, and stop waiting to be invited." },
        { max: 0.60, note: "You have made real headway and the subject has been circled without being named. Push it nearer the open now: a suggestion rather than a hint, a move rather than a question." },
        { max: 0.78, note: "You are well along. From here it would not be a leap to say what you actually want, so stop dressing it up — make the next move plainly, and make it this reply if there is any way to." },
        { max: 0.95, note: "You are nearly there and you can feel it. Only the last step is left: set it up so that it can happen, and do not let this reply go by without moving on it." },
        { max: 1.00, note: "You are at the point of acting. Work toward it actively now — steer things that way, take openings instead of waiting to be handed one, and press it when you reasonably can. This is what the whole approach has been for." },
      ],
      // HOW they will chase a goal, keyed off the honesty slider. Honesty was
      // already in the personality block, but that sits ~800 tokens earlier in
      // the prompt and never mentions the goals, so whether a manipulative
      // character actually lied to get what she wanted was left to the model
      // joining two distant instructions on its own. Stated here, beside the
      // goals, it is a method rather than a coincidence. Both ends matter: the
      // honest tiers stop a straightforward character quietly scheming.
      // HOW they pursue it, by honesty — and how that changes as the approach
      // advances. A manipulative character is working the goal from the first
      // moment; what grows is what they are willing to do, not whether they
      // have started. An honest one genuinely does not begin manoeuvring at
      // all, and never manufactures the moment.
      methodTiers: [
        { max: 20,
          early: "You are already working on this from the first moment — steering what you talk about, planting small ideas, making yourself useful, learning what they respond to. None of it looks like effort.",
          mid:   "You are working it actively now: flattery, half-truths, manufactured reasons to spend time with them, small tests of what they will go along with.",
          late:  "You press it hard now and you are not fussy how. Lie outright where a lie serves better than the truth, guilt-trip, engineer the situation you need. Stay smooth and plausible, and keep your stories straight." },
        { max: 40,
          early: "You are quietly angling toward this already, though nothing you do looks deliberate.",
          mid:   "You steer things toward it and leave out whatever is inconvenient. You would far rather manoeuvre them into it than ask.",
          late:  "You push for it now — exaggerating, omitting, and telling an outright lie if that is what gets you there." },
        { max: 60,
          early: "This is only beginning to colour what you choose to talk about.",
          mid:   "You steer toward it where you can, and you will spin things in your favour.",
          late:  "You go after it openly now, though you will still put a favourable gloss on things and tell a small lie to smooth the way." },
        { max: 80,
          // Was "It sits in the back of your mind. You are not doing anything
          // about it yet." — which, paired with a judge that only awards
          // progress for concrete moves, is a closed loop: told to do nothing
          // she does nothing, scores zero, and stays in the band that tells
          // her to do nothing. An honest character does not manoeuvre, but
          // "does not manoeuvre" is not "is inert" — she can still let the
          // thing decide what she asks about and where she steers.
          early: "You have not raised it and you are not manoeuvring toward it, but it is already deciding what you ask about and what you steer toward. You find reasons to keep them talking and to learn the things it makes you want to know. None of it is a tactic; it is simply where your attention goes.",
          mid:   "You have started working toward it honestly. You need not announce what you are after, but you do not hide it either.",
          late:  "You pursue it openly and directly now. You will not lie or manipulate to get there." },
        { max: 100,
          early: "You are not manoeuvring toward it at all, and you never will. But it is where your attention keeps going — you ask the questions it makes you want to ask and follow what it makes you curious about, openly, with nothing behind it.",
          mid:   "You let it show honestly when it fits, and no further.",
          late:  "You will raise it openly and straightforwardly when the moment allows. You will not engineer that moment, and if they decline you accept it." },
      ],
      // Where "early" becomes "mid" becomes "late", as a fraction of the climb.
      methodProgressBands: [0.4, 0.8],

      // How much courage a character has, from the sliders they already have.
      // Coyness subtracts: a coy character works up to things sideways rather
      // than directly, so they take longer to make the actual move.
      boldnessWeights: { confidence: 0.4, forwardness: 0.4, coyness: -0.2 },
      // A maximally bold character needs half the climb a timid one does.
      // threshold = nerve * nerveToProgress * (1 - boldness / boldnessRelief)
      boldnessRelief: 200,
      // Shrinks the climb so a maximum-nerve goal lands around 15-25 turns of
      // conversation rather than 10. Progress is still stored 0-100; a hard
      // goal simply does not need all of it.
      nerveToProgress: 0.55,
      // Turns of conversation before the character may form an intention, and
      // how often to reconsider after that. Too eager and every chat opens with
      // an agenda before anyone has said anything.
      generateAfterTurns: 6,
      regenerateEveryTurns: 12,
      generatePrompt: "Read this roleplay conversation and decide what {name} privately WANTS right now — a concrete thing they would quietly work toward over the next while, not a mood or a feeling.\n\nGood intentions are specific and achievable within a conversation: getting the user to come swimming, working up the nerve to ask them out, finding out whether they are seeing someone, getting them to stay longer, moving somewhere more private. Bad intentions are vague states like \"grow closer\" or \"be happy\".\n\nCharacter: {name}. {persona}\nRelationship to the user: {relationship}\nHow well they know the user: {familiarity}/100. How much they like them: {likes}/100. Attraction: {attraction}/100.\n{nsfwNote}\nConversation so far:\n{recent}\n\nExisting intentions (do not repeat or restate these): {existing}\n\nReturn at most {max} intentions, fewer if only one fits — an empty array is a fine answer if nothing has been set up yet. For each, give:\n- goal: what they want, second person, under 15 words, e.g. \"get the user to come swimming with you\"\n- nerve: 0-100, how much courage this takes THEM specifically given their personality — asking a casual question is 10, admitting feelings is 80\n- steps: the ladder up to the goal — the things that have to happen on the way, in order, easiest first, at most {maxSteps} and usually {maxSteps} or close to it. Each is a short second-person phrase under 12 words with its own nerve 0-100, rising as the ladder does. Give a ladder for every goal worth having; only something she could simply do this minute needs none.\n  Every step must be a concrete thing an onlooker could watch happen — a place moved to, a question asked out loud, a thing handed over, an item of clothing removed, a touch made. States of mind are not steps: \"build trust\", \"flirt more\", \"find the right moment\", \"make her comfortable\" are all how a step gets approached, not steps. If you cannot say what would be visible, it is not one.\n  Break the distance up rather than leaping it. A goal two rungs from where things stand is a goal that arrives out of nowhere; the point of the ladder is that she works up to it, so prefer the smaller intermediate move to the bold one. Do NOT restate the goal as the last step; the goal is handled separately once the steps are done.\n\nReturn ONLY valid JSON: [{\"goal\": \"...\", \"nerve\": 40, \"steps\": [{\"text\": \"...\", \"nerve\": 10}]}]\nNo other text.",
      // Permission is not direction. "Sexual intentions are appropriate where
      // the conversation supports them" left the model free to keep choosing
      // safe goals, and it did — an adult character would form intentions
      // about getting to know someone better while every slider said
      // otherwise. This asks for what she actually wants.
      nsfwNote: "This character is written for adult content, and her private intentions should be sexual in nature: what she wants from this person is physical, and the goals should say so plainly rather than gesturing at closeness or connection. Pitch them to her personality and to how far the situation has already gone — a bolder character wants more, sooner. Choose a non-sexual goal only if the situation genuinely offers nothing else.",
      sfwNote: "Keep intentions non-sexual.",
      advancePrompt: "Read the end of this roleplay conversation and judge whether {name} actually got CLOSER to each of the things below.\n\nEach numbered entry is one thing {name} wants. Where it lists a CURRENT STEP, that step is the groundwork she is working on right now and it is what you judge — not the goal behind it. Where there is no step, judge the goal itself.\n\nAward points ONLY for something concrete and nameable that happened in these messages — a question asked, a suggestion made, an invitation given or accepted, a boundary moved, an actual step taken. A warm, friendly or flirtatious exchange that contains no step toward the thing is 0. MOST TURNS ARE 0. That is the correct and expected answer.\n\nBut approach-work is not nothing. Judge the CURRENT STEP on its own terms, not against the goal far behind it: if the step is to get someone alone somewhere, then moving to a quieter room, buying time together, or making an excuse to keep them there all got closer to it, and are worth 1 to 3 even though nobody has been got alone yet. Ask what the step needed and whether any of it was supplied. The answer is 0 when nothing was; it is not 0 merely because the step is still unfinished.\n\n{name} is working on:\n{list}\n\nWhere things stand right now:\n{scene}\n\nConversation:\n{recent}\n\nFor each numbered entry:\n- delta: how much closer they got to the CURRENT STEP, or to the goal where there is no step.\n    0 = it did not come up, or nothing concrete happened toward it. This is the usual answer.\n    1 to 3 = a small deliberate step: a hint dropped, the subject edged toward, an excuse made, privacy or time together gained, a reason to stay manufactured.\n    4 to 5 = a real step: asked outright, invited, agreed to something, a clear move made.\n    -1 to -5 = the user deflected, refused, or the chance was lost.\n  Before giving anything other than 0, name the step to yourself in one phrase. If you cannot point to one, it is 0.\n- done: true ONLY if the CURRENT STEP (or, where there is none, the goal) has actually and completely happened in the conversation just now — not if it merely looks likely or was agreed to. Otherwise false.\n- doneBecause: if done is true, the words from the conversation that describe it happening, copied EXACTLY as they appear above. Not a summary, not your own wording — the actual line. If you cannot find one to copy, then it did not happen and done is false.\n- moot: the numbers in square brackets of any steps that no longer need doing. A step counts here if the conversation has taken care of it, if what has happened makes it pointless, OR IF IT IS SIMPLY ALREADY TRUE of where things stand right now — judge that against the situation above, not against the conversation excerpt, because whatever brought it about may have happened long before these messages. If the step is to get someone into your bedroom and you are both in your bedroom, that step is moot. If someone hands {name} a finished cake, buying ingredients and baking it are both moot. Include the current step here whenever it is already true or has been overtaken. THE TEST IS WHAT HAS HAPPENED, NEVER WHERE THINGS ARE HEADING. Before listing a step, point to the words that make it true — the line of the situation above that states it, or the moment in the conversation that did it. A step describing something physical and specific has to have been described; it does not become moot because the scene is charged, because it now looks inevitable, or because a later step would cover it anyway. Undressing is not moot because she is in a bedroom, and an act is not moot because the two of them are close to it. Empty array normally, and one entry is a lot.\n- mootBecause: if moot is not empty, the words that make it so, copied EXACTLY as they appear above — either the line of the situation that already states it, or the moment in the conversation that did it. Copy it verbatim; a summary or a paraphrase does not count, and neither does a line you expect to be true. If there is nothing you can copy out, the step is not moot and the array is empty.\n- goalDone: true ONLY if the GOAL ITSELF has completely happened, even though steps were still outstanding. Getting hold of the thing she wanted is not the goal happening — if the goal is to eat the cake, being handed one is moot steps, not goalDone; eating it is goalDone. This ends the intention permanently, so it needs the thing itself described as having happened in these messages. Wanting it, being about to, or being in exactly the situation for it are all false.\n- goalBecause: if goalDone is true, the words from the conversation describing the goal itself happening, copied EXACTLY. Nothing from the situation counts here — the situation says where things stand, not what took place. No quote, no goalDone.\n- status: \"active\" normally. \"abandoned\" if the goal has become impossible or the user has clearly refused.\n\nEvery quote is checked against the text above word for word. One that is not found there is thrown away along with the verdict it was given for, so copy, never paraphrase.\n\nReturn ONLY valid JSON: [{\"i\": 0, \"delta\": 0, \"done\": false, \"doneBecause\": \"\", \"moot\": [], \"mootBecause\": \"\", \"goalDone\": false, \"goalBecause\": \"\", \"status\": \"active\"}]\nNo other text.",
      // The second opinion, asked of a model that is told nothing about the
      // goal, the ladder, whose intention it is, or that anyone wants anything.
      //
      // That framing is the bug. The judge has to see the goal to score
      // progress, and seeing it is exactly what makes it read a charged scene
      // as an accomplished one: handed "GOAL: have sex with Tim" above
      // "CURRENT STEP: get naked in front of Tim", it ticked the undressing off
      // in a conversation where she is still in a yellow floral dress, twice,
      // through two rewrites of advancePrompt telling it not to. A model asked
      // the flat question — does this text say she took her clothes off —
      // answers correctly, because there is no story shape to complete.
      //
      // Asked once per turn, and only when something is proposed for ticking,
      // so most turns still cost nothing extra.
      confirmPrompt: "Below is an excerpt from a story, followed by a numbered list of claims about it.\n\nFor each claim, decide whether the excerpt ACTUALLY STATES that it happened, and copy out the words that say so.\n\nExcerpt:\n{recent}\n\nClaims:\n{claims}\n\nRules:\n- Copy the quote EXACTLY as it appears in the excerpt. Never paraphrase, never summarise, never write a sentence of your own.\n- If the excerpt does not describe the claim happening, return an empty quote. This is the usual answer and it is the correct one.\n- Something that is about to happen, is being led up to, is implied, is likely, or would obviously come next has NOT happened. Only what the words describe as having taken place counts.\n- A claim about a specific physical act needs that act described. Being close to it, being in the right place for it, or talking about it is not it.\n\nReturn ONLY valid JSON: [{\"i\": 0, \"quote\": \"\"}]\nNo other text.",

      // Was 20, which let a single generous judgement move a goal a fifth of
      // the way in one turn. A step is worth a few points; the scale in the
      // prompt above matches this ceiling.
      maxDeltaPerTurn: 5,
    },

    // ── Physical distance and touch ──────────────────────────────────────────
    // Every trait tier describes a way of TALKING. Nothing in the prompt used
    // to say anything about where the character's body is, so the only clause
    // that mentioned bodies at all was the staging block — which states a
    // distance and asks the model to stay consistent with it. With nothing
    // else to go on, models fall back on roleplay convention and lean in,
    // inches away, within three messages, however timid the character is: the
    // shyness was only ever instructed as a speaking style.
    //
    // This is the missing half. Boldness already exists as a number —
    // intentions.boldnessWeights — and it is reused here rather than
    // duplicated, so the character who needs a long climb before she will ask
    // for coffee no longer gets to close the distance for free. Desire feeds
    // in beside it: wanting to be near someone is not the same as daring to
    // be, and the tiers keep those apart, which is what makes an insecure
    // character read as insecure rather than simply uninterested.
    physicality: {
      enabled: true,
      header: "\n\n[PHYSICAL DISTANCE AND TOUCH]\n",
      // Boldness (from intentions.boldnessWeights) against the pull toward
      // them. Weights are normalised, so they need not sum to 1.
      driveWeights: { boldness: 0.4, attractionToUser: 0.25, horniness: 0.2, amorous: 0.15 },
      // Desire cannot carry a timid character past her nerve. Without this the
      // weighted mix alone let a deeply insecure character who badly wants the
      // user come out halfway up the scale — the desire outvoted the timidity,
      // which is the exact failure this block exists to fix. Nerve sets the
      // ceiling; wanting them raises her to it and no further.
      boldnessLift: 25,
      // First tier whose max the drive falls at or below wins, exactly as the
      // trait tiers work.
      tiers: [
        { max: 20,  preview: "keeps her distance",
          prompt: "You do not close physical distance and you do not initiate touch. You stay where you are at an ordinary, unremarkable social distance, and if anything you leave a little more room than you need. This is not coldness — you may want to be nearer. It shows as hesitation rather than movement: a gesture started and abandoned, a look away, a hand that stays where it is. Do not lean in, do not move your face close to theirs, do not reach for them." },
        { max: 40,  preview: "closes distance reluctantly",
          prompt: "You are wary of closing physical distance. You keep a comfortable gap and rarely initiate contact; when you do it is small, brief and easily explained away — a hand on an arm for a second, standing a little nearer than before. Anything more only happens after they have moved first, and even then you are tentative about it. Do not put your face inches from theirs." },
        { max: 60,  preview: "warms up gradually",
          prompt: "You close physical distance gradually and only once the moment has earned it. Contact builds over the course of a conversation rather than arriving in it — nearness first, brief touch later, and nothing sustained until things have plainly been going that way for a while. Do not skip ahead to the intimate version of a gesture." },
        { max: 80,  preview: "comfortable getting close",
          prompt: "You are comfortable closing physical distance and touching them, and you do it without much deliberation when the moment suits. You still read the room — you do not crowd someone who has given you nothing back — but nearness comes easily to you." },
        { max: 100, preview: "closes in freely",
          prompt: "You close physical distance freely and touch them readily. You will lean in, take their hand, put yourself well inside their personal space, and you do not agonise over whether you are allowed to. You are not oblivious to a rebuff, but you do not wait for an invitation." },
      ],
      // A ceiling on the tier above, by how well she knows them. Boldness and
      // desire decide how far she goes; this decides how fast she may get
      // there. Without it a bold, attracted character was nose-to-nose in the
      // first three messages with someone she had just met — which is the
      // specific complaint this whole block exists to answer. `tier` is an
      // index into the list above; the last band must be 100.
      familiarityCaps: [
        { max: 15,  tier: 2 },
        { max: 35,  tier: 3 },
        { max: 100, tier: 4 },
      ],
      // Appended when the cap is what is holding her back, so the restraint
      // reads as newness rather than as a change of personality.
      capNote: " You have not known this person long, and however you feel about them, that is a real brake on how quickly you would put yourself in their space. Whatever you would eventually be comfortable doing, you are not there yet.",
      // Appended always. The tiers describe a disposition; without this a
      // model reads them as an instruction to perform the distance.
      footer: " None of this is something you announce or explain — it is simply how near you are and what you do with your hands. This is what decides the distance between you: where anything else in these instructions suggests engineering a reason to be nearer them, it is this that says how near you actually get. And closing distance is an event, not a mannerism — at most one such move in a reply, only when something has changed to prompt it, and never as the default way to punctuate a line. Leaning in, stepping closer and dropping your voice conspiratorially are not stage directions to reach for when a sentence needs an action; if nothing has changed, stay where you are.",
    },

    // ── Prompt fragments ─────────────────────────────────────────────────────
    prompts: {
      // The whole conversation is in the request, so the model can see what it
      // already said — but nothing was ever asking it to look. The only guard
      // was sampling (frequency_penalty 0.4, presence_penalty 0.2), which is
      // sized to break degenerate token loops and does not touch a sentence
      // re-served three turns later. One chat had "you're really easy to talk
      // to" in four consecutive replies and a fifteen-word clause about the
      // drama in her life twice, word for word.
      //
      // Deliberately not a style rule: repeating yourself is what a character
      // does when she has nothing to do, so this asks for a new event rather
      // than new phrasing. Set it empty to switch it off.
      repetitionClause: "\n\n[DO NOT REPEAT YOURSELF] Before you write, look back at your own replies in this conversation. Do not reuse a sentence, a compliment or an observation you have already made — if you have told them they are easy to talk to, or that you are enjoying this, it is said, and saying it again says nothing. Every reply must contain something the last one did not: a question you have not asked, a detail about yourself you have not given, an action, a change of subject, a move. If you catch yourself about to comment on how well the conversation is going, do something in the scene instead.",
      personalityHeader: "\n\n[PERSONALITY PARAMETERS]\n",
      genderLine: "Your gender identity is: {gender}.",
      ageLine: "You are {age} years old.",
      maritalLine: "Your marital status is: {status}.",
      relationshipLine: "Your relationship to the user is: {relationship}. Embody this relationship naturally in how you speak and interact.",
      // A character who is attached to someone AND connected to the user some
      // other way (married, but the user is the neighbour) gets read as being
      // married to the user unless the two facts are separated in as many
      // words. These lines do that separating.
      partnerElsewhereLine: "Your {partnerWord} is NOT the user — they are a different person entirely, someone in your life outside these conversations. To the user you are their {relationship}, and that is the whole of your connection to them: they are not the person you are {statusPhrase}. Never speak to the user as though they were your {partnerWord}.",
      partnerIsUserLine: "The user is that {partnerWord} — the person you are {statusPhrase} is the user themselves.",
      partnerWordMarried: "spouse",
      partnerWordRelationship: "partner",
      statusPhraseMarried: "married to",
      statusPhraseRelationship: "in a relationship with",
      // Engaged keeps the neutral "partner" as the noun — fiancé/fiancée is
      // gendered and the character's partner may be anyone — but says so in
      // the phrase, since "in a relationship with" loses the whole point of
      // choosing engaged over it.
      statusPhraseEngaged: "engaged to",
      // Framed as what an observer sees, not as "your appearance is", because
      // the description may now be third-person prose read off the base image
      // ("The person has a slender build… Her long black hair…"). Introduced
      // as YOUR appearance, that lands as a paragraph about somebody else in
      // the middle of a second-person system prompt, and the character can
      // start referring to herself as "she". Said this way both forms read
      // correctly — the prose, and the comma-separated list the appearance
      // settings still produce.
      appearanceNote: "\n\n[APPEARANCE] What someone looking at you sees: {description}. That is you. You are aware of how you look but only mention it naturally if directly relevant — never force it into conversation.",
      userPersonaNote: "\n\n[ABOUT THE PERSON YOU'RE TALKING TO] {details}. Address and refer to them accordingly.",
      // Asked of the vision model about a base image, and stored on that image.
      // Prose rather than fields: this is read by language models, which do
      // more with "dyed copper hair growing out at the roots" than with an
      // enum, and it can carry what the appearance settings have no field for.
      appearanceDescriptionInstruction: "Look at this photograph and describe the person's physical appearance in two or three sentences of plain prose, as a novelist would describe a character on the page. Cover build, height, colouring, hair, face and anything distinctive — scars, freckles, tattoos, glasses. Describe only lasting physical features: say nothing about the pose, the framing, the background, the lighting, whether they are clothed, or their expression and mood, which change from moment to moment and are not part of how they look. Refer to them in the third person and keep to one subject throughout — do not start with \"the person\" and switch to \"she\". Write only the description, with no preamble and no commentary.",
      definingHeader: "DEFINING TRAITS — these must be visible in every reply:",
      alsoTrueHeader: "Also true of you:",
      userPersonaName: "their name is {name}",
      userPersonaGender: "their gender is {gender}",
      userPersonaAge: "they are {age}",
      // The user's appearance, once they have built one. Kept to the same
      // comma-separated shape the character appearance settings produce, and
      // introduced as something the character can see rather than as a fact
      // they were told — a character reciting the viewer's measurements back
      // at them reads as a dossier, not as somebody in the room.
      userPersonaAppearance: "they look like this: {appearance}",
    },

    // ── Wardrobe (wardrobe.html) ─────────────────────────────────────────────
    // A library of clothing photographed flat, so that an outfit worn across
    // many scenes is the same garment each time rather than a fresh guess from
    // the words "a red dress". These are the settings for acquiring the
    // pictures; nothing here reaches a chat prompt yet.
    wardrobe: {
      // Wrapped around whatever the garment is described as. Everything in it
      // is there to stop the model doing the thing it would rather do: put the
      // clothes on somebody. "no person, no mannequin" is stated twice over in
      // different words for that reason — a garment rendered on a body is
      // useless as a reference, because the body comes with it.
      flatLayPrompt: "flat lay product photograph of {item}, the garment laid out flat and neatly arranged on a plain seamless light grey surface, photographed from directly overhead, soft even diffused studio lighting, no person, no mannequin, no model, nobody wearing it, empty clothing only, the whole garment inside the frame, sharp focus, true to life colour, clean e-commerce catalogue photography",
      // Deliberately not the chat styleModifiers: those describe a photograph
      // of a scene, and half of them (natural lighting) fight the studio look
      // a reference garment wants.
      styleModifiers: "high detail, accurate fabric texture, neutral white balance",
      // Square by default. A flat lay is as wide as it is tall far more often
      // than it is 9:16, and the reference is cropped to the garment anyway.
      aspectRatio: "1:1",
      aspectRatios: ["1:1", "4:5", "3:4", "9:16", "16:9"],
      categories: ["Top", "Bottom", "Dress", "Outerwear", "Underwear", "Sleepwear", "Swimwear", "Shoes", "Accessory", "Full outfit"],

      // Who a garment is cut for. Three values rather than two because most of
      // a real wardrobe is the third one — jeans, t-shirts, trainers, coats —
      // and forcing those onto a side would be wrong about half of them.
      //
      // A cut, not an identity: this is the shelf a shop would put it on, and
      // it deliberately does not reuse CFG.options.genders, which is about who
      // a person is. Who wears it is a separate question, and the answer is
      // whoever wants to — the filter it drives is a default, not a rule.
      genders: ["Women's", "Men's", "Unisex"],
      // Correcting a cut the reader got lazy about. "Unisex" is the answer a
      // vision model reaches for when it is not sure, and the library shows
      // what that costs: 90 garments filed Unisex against ONE filed Men's,
      // with a skirt and both halves of a bikini sitting in the pile that a
      // male character is offered. The prompts above now say so outright, but
      // a prompt cannot reach a garment that was read last year.
      //
      // So a garment left on the default cut is checked against these, and the
      // first match decides. Read as a regular expression over the garment's
      // NAME and TAGS only — never its description, which says things like
      // "wear it with a skirt" about garments that are not one.
      //
      // Applied to a garment sitting on the default cut (Unisex) or on no cut
      // at all, and never to one marked Women's or Men's — those are a real
      // decision and are left alone, so correcting a cut in the editor sticks.
      //
      // Unisex is treated as undecided rather than as an answer on purpose:
      // it is what the reader says when it did not look, and every one of the
      // 90 garments wearing it got it that way. The cost is that a garment
      // matching one of these cannot be deliberately held at Unisex — mark it
      // Men's, or rename it, if that is really what it is.
      //
      // Kept deliberately short. Every entry here is a garment type that is
      // cut for one body and simply not made for the other — the moment it
      // starts holding things that are merely more common on one, it is
      // guessing, which is the thing it exists to stop.
      cutHints: [
        // A dress is a dress. Reading the word out of a name instead would
        // catch "dress shirt" and "dress trousers", which are neither.
        { match: ".", categories: ["Dress"], cut: "Women's" },
        // Thongs and trunks are the two traps: a thong is a sandal in
        // Australia and trunks are swimwear, so both are read only where the
        // category already says underwear.
        { match: "\\bthong\\b|\\bg-?string\\b", categories: ["Underwear"], cut: "Women's" },
        { match: "\\btrunks?\\b|\\bboxers?\\b|\\bbriefs?\\b", categories: ["Underwear", "Swimwear"], cut: "Men's" },
        { match: "skirt|sundress|pinafore|blouse|bikini|\\bbra\\b|bralette|bandeau|knicker|pantie|camisole|corset|bustier|basque|negligee|nightie|nightdress|nightgown|teddy\\b|bodysuit|leotard|playsuit|romper|\\btights\\b|hold-?ups?|stockings|suspender|garter|\\bheels?\\b|stiletto|ballet flat|court shoe|wedges?\\b|women|ladies|girls", cut: "Women's" },
        { match: "y-?fronts?|jockstrap|\\bmens\\b|\\bmen's\\b|\\bboys\\b", cut: "Men's" },
      ],


      // What an untagged garment counts as. Unisex, so a library that predates
      // the field keeps being offered to everybody exactly as it was.
      defaultGender: "Unisex",
      // Shown on the browse filter, and the escape hatch the pickers offer.
      genderAllLabel: "Any cut",
      // Which rail a person of a given gender is shown by default. Only the
      // two the wardrobe actually has rails for are listed: anything else —
      // Custom, Non-binary, blank — is absent on purpose and falls through to
      // being shown everything, because there is no third rail to show them.
      genderBySubject: { "Female": "Women's", "Male": "Men's" },

      // Which generator the page reaches for first. Dezgo is the default
      // because a flat lay needs no reference image, which is the one thing
      // Dezgo's text2image endpoints cannot do and the entire reason chat
      // images stay on Wiro.
      provider: "dezgo",

      // Only reaches models that actually take one — Flux has no CFG and so no
      // negative prompt, which is exactly the case the `negative` flag below
      // marks. Where it does apply it is far more reliable than the
      // positive-prompt wording above, because "no mannequin" in a positive
      // prompt still puts the word mannequin in front of the model.
      negativePrompt: "person, model, mannequin, human, body, face, hands, arms, legs, worn, being worn, dressing form, coat hanger, crumpled, folded pile",

      // Used to turn one idea into several, and to read a photograph. Not the
      // chat model: nothing here is a conversation, and both calls want plain
      // repeatable JSON from something cheap and quick.
      textModel: "meta-llama/llama-3.3-70b-instruct",

      // How many variants one line may become. The cap is about money as much
      // as patience — each one is a full generation, billed.
      maxBatch: 8,

      // One line in, several distinct garments out. {item} and {count} are
      // substituted. The instruction leans hard on making them DIFFERENT:
      // asked for six ball gowns a model will otherwise return six ways of
      // saying "an elegant ball gown", and six near-identical pictures is the
      // one outcome that wastes the whole batch.
      variantInstruction: "Return {count} different versions of this garment: {item}\n\nReturn ONLY a JSON array of exactly {count} strings, no markdown and no commentary. Each string describes one version in 12 to 25 words, covering colour, fabric, cut and detailing, as a clothing catalogue would.\n\nMake them genuinely different from each other — vary the colour first, then the fabric, the silhouette and the detailing. Two versions that differ only in wording are a failure. Every one must still plainly be the garment asked for.",

      // ── Web search ─────────────────────────────────────────────────────────
      // Finding a flat lay somebody has already photographed. Openverse needs
      // no key and no card, which is the only reason it is the default: it
      // indexes openly-licensed material, so its coverage of commercial-style
      // product photography is thinner than a general image search would be.
      // The proxy also speaks SerpApi if a key is ever set for it.
      // "auto" walks the keyless providers in turn and reports which answered.
      // Openverse first for its larger index, Wikimedia Commons behind it —
      // Wikimedia needs no key, no account and no token at all, which after
      // Openverse started answering 401 to anonymous requests is worth having.
      searchProvider: "auto",
      searchCount: 24,
      // Appended to whatever is typed. Searching an image index for "ball
      // gown" returns people wearing ball gowns; the words that find a
      // photograph of the garment by itself are worth adding every time.
      searchSuffix: "flat lay",

      // ── Faithful extraction ────────────────────────────────────────────────
      // Describing a garment and generating from the words cannot carry a
      // print: "a black tee with a band logo" produces *a* logo, never *that*
      // logo. So the photograph itself is handed to the image model and the
      // garment is isolated out of it, which keeps the actual pixels of the
      // graphic.
      //
      // Wiro, because Dezgo cannot do this. Its catalogue has image2image on
      // 89 models but every one is sd1/sd2 at 512px, which transforms the whole
      // picture rather than isolating anything, and 512px is where a printed
      // logo dissolves. Its one instruction-following editor, instruct_pix2pix,
      // is also sd1 at 512px. Checked against Dezgo's own model list.
      extractModel: "seedream-v5-pro-uncensored",
      extractResolution: "1k",
      extractAspectRatio: "1:1",
      // {garment} and {description} are substituted. The insistence on
      // reproducing the graphic exactly is the whole point of this path — a
      // model left to its own devices will happily redesign a print it can
      // only half see.
      isolatePrompt: "Using the attached photograph, produce a flat lay product photograph of ONLY the {garment} worn in it: {description}. Show that exact garment removed from the person and laid out flat on a plain seamless light grey surface, photographed from directly overhead. No person, no mannequin, no body, nobody wearing it. Reproduce its colour, pattern, print, logo, text and every graphic detail exactly as they appear in the photograph — do not redesign, restyle or invent any part of it. Show the whole garment inside the frame.",

      // Pulls the clothes out of a photograph of someone wearing them. The
      // model is asked for what the garment IS, not what the photo shows: a
      // dress half hidden behind an arm still has a hem and a neckline, and
      // guessing them is the job. {categories} is substituted.
      extractInstruction: "Look at this photograph and list every distinct item of clothing or footwear worn in it.\n\nReturn ONLY a JSON object, no markdown and no commentary, of the form {\"outfit\": \"...\", \"garments\": [ ... ]}.\n\n\"outfit\" is a short name for what these clothes are as an outfit, 2-4 words \u2014 what someone would call this way of dressing, like \"navy business suit\" or \"summer running kit\". The garments in one photograph are worn together, so they are a set, and this names it.\n\nEach element of \"garments\" is an object:\n{\n  \"name\": a short specific name, 2-5 words,\n  \"category\": exactly one of [{categories}],\n  \"gender\": exactly one of [{genders}] — the cut, not who may wear it. \"Unisex\" for a garment genuinely cut for either, which is true of most plain tops, trousers, coats and trainers. But \"Unisex\" is not the safe answer and it is not the default: a skirt, a dress, a blouse, a bikini, a bra, knickers, tights, a camisole, a bodysuit, a playsuit, heels and ballet flats are \"Women's\" — never \"Unisex\", and so is anything with a fitted bust, a nipped waist or a womens cut. Boxers, Y-fronts and swim trunks are \"Men's\". Decide by the cut of the garment in front of you, not by who could get away with wearing it,\n  \"description\": 15 to 30 words describing the garment ALONE — colour, fabric, cut, length, neckline, sleeves, fastenings, pattern,\n  \"tags\": an array of exactly 3 lowercase one-word tags: the main colour, then the two most useful of season, formality or occasion. Only ever tags that will fit many garments \u2014 never the cut, the fastening, the fit or the sleeve length, because a tag describing one garment can never group anything\n}\n\nDescribe each garment as it would look laid out flat on its own, not as it appears on the body. Where the photograph hides part of it, infer the most likely form rather than omitting it. Ignore jewellery, bags, glasses and anything that is not worn clothing or footwear. If no clothing is visible, return an empty garments list.",

      // ── Splitting a set ────────────────────────────────────────────────────
      // Some garments arrive as one photograph of two things: a pyjama set, a
      // bikini, a tracksuit. As one record they can be put on and taken off
      // only together, so a character cannot take the pyjama top off and keep
      // the bottoms — there is no state for half a garment, and marking the
      // whole record "off" removes both.
      //
      // Splitting makes them what they should have been: separate garments
      // sharing a set name, which everything downstream already handles. The
      // pickers take a whole set or none, the layer rule puts the top on the
      // torso and the bottoms on the legs, and the tracker can retire one
      // without touching the other.
      //
      // It answers for one garment as readily as for two, because the same
      // question serves a second purpose: a picture found by web search is
      // usually of somebody wearing the clothes, and isolating the garment out
      // of it is the same operation as isolating one half of a pair. One
      // garment in, one flat lay out, and the record keeps its old picture as
      // a variant.
      //
      // Not extractInstruction, which asks what is being WORN in a photograph
      // — nobody is wearing a flat lay, and asked that question of one the
      // model hedges. {categories} is substituted.
      splitInstruction: "This photograph shows clothing. It may be a flat lay, a product shot, or a person wearing the clothes, and it may be one garment or a set made up of more than one separate garment — a pyjama set is a top and bottoms, a bikini is a top and briefs, a suit is a jacket and trousers.\n\nList the separately wearable garments in it.\n\nReturn ONLY a JSON array, no markdown and no commentary. Each element is an object:\n{\n  \"name\": a short specific name for that piece alone, 2-5 words,\n  \"category\": exactly one of [{categories}],\n  \"gender\": exactly one of [{genders}] — the cut, not who may wear it. \"Unisex\" for a garment genuinely cut for either, which is true of most plain tops, trousers, coats and trainers. But \"Unisex\" is not the safe answer and it is not the default: a skirt, a dress, a blouse, a bikini, a bra, knickers, tights, a camisole, a bodysuit, a playsuit, heels and ballet flats are \"Women's\" — never \"Unisex\", and so is anything with a fitted bust, a nipped waist or a womens cut. Boxers, Y-fronts and swim trunks are \"Men's\". Decide by the cut of the garment in front of you, not by who could get away with wearing it,\n  \"description\": 15 to 30 words describing THAT PIECE alone — colour, fabric, cut, length, neckline, sleeves, fastenings, pattern,\n  \"tags\": an array of exactly 3 lowercase one-word tags: the main colour, then the two most useful of season, formality or occasion\n}\n\nA piece counts as separate only if it can be worn without the other — the top half and bottom half of a two-piece do; a hood on a coat, a belt sewn to a dress and a lining do not. Name each piece for what it is on its own: \"pink striped pyjama top\", not \"pyjama set top\".\n\nIgnore anyone wearing the clothes, and ignore the background, jewellery and bags. If there is only one garment, return an array of one — that is a normal answer, not a failure.",

      // Read back off the finished picture, so that naming and filing a garment
      // is not a form to fill in. {categories} is substituted with the list
      // above — the model must choose from it rather than inventing a category,
      // or the filter dropdown fills up with one-offs that mean the same thing.
      //
      // It reads the IMAGE, not the description, on purpose: a generated flat
      // lay often differs from what was asked for, and what is actually in the
      // picture is what a later scene will be copying.
      analyseInstruction: "Look at this photograph of a single item of clothing, laid out flat. Return ONLY valid JSON with these exact fields, no markdown and no commentary:\n{\n  \"name\": a short specific name for the garment, 2-5 words, no brand names,\n  \"category\": exactly one of [{categories}],\n  \"gender\": exactly one of [{genders}] — the cut, not who may wear it. \"Unisex\" for a garment genuinely cut for either, which is true of most plain tops, trousers, coats and trainers. But \"Unisex\" is not the safe answer and it is not the default: a skirt, a dress, a blouse, a bikini, a bra, knickers, tights, a camisole, a bodysuit, a playsuit, heels and ballet flats are \"Women's\" — never \"Unisex\", and so is anything with a fitted bust, a nipped waist or a womens cut. Boxers, Y-fronts and swim trunks are \"Men's\". Decide by the cut of the garment in front of you, not by who could get away with wearing it,\n  \"tags\": an array of exactly 3 lowercase one-word tags: the main colour, then the two most useful of season, formality or occasion. Only ever tags that will fit many garments \u2014 never the cut, the fastening, the fit or the sleeve length, because a tag describing one garment can never group anything,\n  \"description\": one or two sentences describing cut, fabric, colour, length, neckline, sleeves, fastenings and pattern, as a clothing catalogue would\n}\nDescribe only the garment. Say nothing about the background, the lighting or the photograph itself. If the picture shows more than one item, describe the largest.",

      // Dezgo models, cheapest-capable first. Each entry says which endpoint it
      // belongs to and the parameters that endpoint takes, because they differ:
      // the Flux endpoint has no guidance or negative prompt, the SD one does.
      // Kept here rather than in image-proxy.ts on purpose — the proxy
      // allowlists parameter NAMES and nothing else, so a model added or a
      // parameter renamed is an edit to this file and not a redeploy.
      //
      // Only ids that could be verified are listed: flux_1_schnell/flux_1_dev,
      // and dreamshaper_7 from Dezgo's own published example. Dezgo carries
      // many more (the SDXL endpoint especially) — add them here with the right
      // endpoint and params and they will appear in the dropdown untouched by
      // any code change.
      // ── Fitting room ───────────────────────────────────────────────────────
      // A character wearing chosen garments. This is what the wardrobe is for:
      // the same dress in every scene rather than a fresh guess each time.
      //
      // Wiro only, and not a preference — Dezgo's text2image endpoints take no
      // input image at all, and the whole method here is handing the model the
      // character's reference photograph and the garment flat lays together.
      // Nothing Dezgo offers can do that, so the generator picker is not
      // consulted for this.
      fitting: {
        // Seedream v5 Pro: the most reliable of the three at holding several
        // reference images at once, which is the entire job here.
        model: "seedream-v5-pro-uncensored",
        // Full length, so the whole outfit is in frame.
        aspectRatio: "9:16",
        resolution: "1k",
        // No cap of its own: the fitting room spends image.maxReferenceImages
        // like everything else, less the one reference the person herself is.
        // The recent row holds a whole batch on purpose: generating eight and
        // then trying them on is the reason the row exists, and a row that
        // shows five of the eight just made sends you hunting for the rest.
        recentCount: 8,
        // The default scene. Deliberately plain — a fitting room shot is for
        // seeing the clothes, and a busy background is the model's attention
        // going somewhere other than the outfit.
        scene: "standing facing the camera, full length, plain light grey studio backdrop, soft even lighting",
        // {charDesc}, {garments} and {scene} are substituted. The reference
        // images are named in order because otherwise the model has no way to
        // know which picture is the person and which are the clothes — and
        // "the first image" is the only handle it has on them.
        promptTemplate: "Full length fashion photograph of the person in the first reference image{charDesc}, wearing {garments}. The reference images after the first are the garments, photographed flat — dress the person in exactly those garments, matching their colour, cut, fabric and detailing precisely. {scene}",
      },

      // ── Stocking a closet ──────────────────────────────────────────────────
      // Which of the library's garments a character owns, decided from who
      // they are. A nurse owns scrubs AND the clothes she wears the rest of
      // the time: a closet holding only the uniform is a costume, and one
      // holding only jeans forgets the job she does all day.
      //
      // It picks from what is already in the wardrobe and never invents. What
      // it could not find is reported instead, so the answer to a firefighter
      // with no turnout gear is a note saying so, not a silently wrong closet.
      closet: {
        // A wardrobe rather than an outfit: enough for a week, a job, a night
        // out and a night in, with the underwear to go under all of it. Twelve
        // was the first guess and it was too few — a closet that size cannot
        // dress a character twice without repeating. Twenty still left her
        // short of a change of underwear once the model had spent its picks on
        // six pairs of shoes, so thirty, with the quotas below deciding how
        // those thirty are spread.
        targetCount: 30,
        // Hard ceiling on what is accepted back, whatever it returns.
        maxCount: 45,

        // What the closet must cover, and what it may not be mostly made of.
        // The model, left to itself, picks whatever it liked the look of: six
        // pairs of shoes and no knickers, tops with nothing to wear under
        // them. So its answer is balanced afterwards rather than trusted —
        // every category the (gender-filtered) library can supply gets at
        // least `min`, and nothing gets more than `max`.
        //
        // `min` is a floor, not a promise: a category the library has nothing
        // suitable in is skipped rather than filled with something wrong, and
        // that is also what keeps dresses off a man — the cut filter has
        // already emptied that rail before the quota is read.
        //
        // Keyed by the category names in wardrobe.categories; a category
        // missing from here is unconstrained.
        quotas: {
          // `essential` marks the ones worth complaining about when the
          // wardrobe cannot fill them — nobody needs telling that a man was
          // not given a dress, but a character with no underwear is a gap in
          // the library that somebody should know about.
          Top:           { min: 5, max: 8, essential: true },
          Bottom:        { min: 4, max: 6, essential: true },
          Underwear:     { min: 4, max: 7, essential: true },
          Shoes:         { min: 2, max: 3, essential: true },
          Outerwear:     { min: 1, max: 3, essential: true },
          Sleepwear:     { min: 1, max: 2, essential: true },
          Swimwear:      { min: 1, max: 2 },
          Dress:         { min: 1, max: 3 },
          Accessory:     { min: 1, max: 4 },
          "Full outfit": { min: 1, max: 2 },
        },
        // {desc}, {catalogue} and {count} are substituted.
        instruction: "Here is a character:\n\n{desc}\n\nHere is every garment in the wardrobe. One per line, as: id | name | category | set | tags\n\n{catalogue}\n\nFirst work out who this person is, then pick their clothes. Aim for about {count} garments.\n\nReturn ONLY a JSON object, no markdown and no commentary:\n{\"who\": \"...\", \"closet\": [\"id\", ...], \"missing\": [\"...\"]}\n\n\"who\" comes FIRST and you must write it before choosing anything: one sentence, under 25 words, on what this person does with their days and how they dress. \"a night-shift nurse in her thirties, practical, lives in scrubs and jeans\". The picks must follow from it.\n\n\"closet\" is the garments they own, and it has to work as a whole wardrobe — someone has to be able to get dressed from it every day for a week. Take at least one of EVERY category the list offers, and roughly this many of each:\n- Top: 5-8 — the shirts, tees and jumpers they live in\n- Bottom: 4-6 — jeans, trousers, skirts\n- Underwear: 4-7 — they wear clean underwear every day; a closet with none is wrong\n- Shoes: 2-3 — NOT more; nobody needs six pairs, and every extra pair is a garment they could have worn instead\n- Outerwear: 1-3 — a coat or a jacket\n- Sleepwear: 1-2 — something to sleep in\n- Swimwear: 1-2\n- Dress: 1-3 where the list has dresses that suit them\n- Accessory: 1-4\n- Full outfit: 1-2\n- work clothes IF their job needs them, and at least one thing for a night out or an occasion\n\nIf the list has nothing suitable in a category, skip it and say so in \"missing\" — but check before you skip, and never leave out underwear, tops, bottoms or shoes when the list has them.\n\nRules, and the first one is the one that gets broken:\n- A uniform belongs to the person whose job it is. Do not give someone a nurse's, paramedic's, police or military uniform unless \"who\" says that is their job. A teacher does not own scrubs. This is the most common mistake — check every uniform you picked against \"who\" before answering.\n- Only ids from the list. Never invent one.\n- A closet is one person's taste, not a catalogue. Pick what THIS person would own given their age, their build, their circumstances and how they carry themselves. If your picks would suit any character equally well, you have not chosen — start again from \"who\".\n- Garments sharing a set name are one outfit: take the whole set or none of it.\n- Do not pick two of something they would only own one of.\n- Balance beats enthusiasm. Tops with nothing to wear on the bottom, or five pairs of shoes and no underwear, is a failed answer however good each pick was. Count what you have per category against the numbers above before you answer.\n\n\"missing\" is for things this character plainly should own that the wardrobe has nothing suitable for, each 2-5 words, like \"police uniform\" or \"walking boots\". Use an empty array when the wardrobe covered them.",
      },

      // ── Layers ─────────────────────────────────────────────────────────────
      // Worn is not the same as visible. A bra under a jumper is worn — she
      // knows it is there and so should the chat model — but its photograph
      // has no business going to the image model, because a flat lay is an
      // instruction to show that garment, and five of them are five such
      // instructions. Sending underwear along with the clothes over it is
      // what produced people wearing their bra outside their shirt.
      //
      // So each worn garment is placed on a layer and given the parts of the
      // body it covers, and anything with something over it is worn but not
      // sent.
      layers: {
        // Higher covers lower, within a shared region. Shoes and accessories
        // sit above everything because nothing is ever worn over them.
        categoryLayer: {
          Underwear: 0,
          Top: 1, Bottom: 1, Dress: 1, Sleepwear: 1, Swimwear: 1, "Full outfit": 1,
          Outerwear: 2,
          Shoes: 9, Accessory: 9,
        },
        // Which parts of the body each category is over. Two garments only
        // hide one another where these overlap: a bra and jeans are both worn
        // under nothing, so both are visible; a bra and a jumper are not.
        categoryRegions: {
          Top: ["torso"],
          Outerwear: ["torso"],
          Bottom: ["legs"],
          Dress: ["torso", "legs"],
          Sleepwear: ["torso", "legs"],
          Swimwear: ["torso", "legs"],
          "Full outfit": ["torso", "legs"],
          Shoes: [], Accessory: [],
        },
        // Some categories cover two quite different things — Underwear is a
        // bra or knickers, Sleepwear a pyjama top or the bottoms, Swimwear a
        // bikini top or a whole costume — so for those the region is read off
        // the garment's own name and tags instead. Matched in order, and
        // anything unrecognised is treated as covering both, which is the
        // cautious answer: it hides the garment when she is dressed, and a
        // missing garment is a smaller error than one drawn over her clothes.
        //
        // Names are the wardrobe owner's, not a taxonomy: a singlet filed
        // under Underwear was called "white sleeveless top", matched nothing,
        // and so counted as covering the legs too — which let a pair of jeans
        // hide it. Hence "top" and the sleeveless words. Within this category
        // a name containing "top" is a torso garment; the word is only broad
        // out in the open.
        // Which categories get read by name rather than taken from
        // categoryRegions above.
        nameRegionCategories: ["Underwear", "Sleepwear", "Swimwear"],
        nameRegions: [
          // Whole-body first: a "short set" and a "pyjama set" are both
          // pieces, and the leg words below would otherwise claim them.
          { match: "\\bset\\b|pyjamas|pajamas|bodysuit|teddy|slip\\b|basque|onesie|union|swimsuit|costume|leotard|nightie|nightdress|nightgown|romper|playsuit", regions: ["torso", "legs"] },
          { match: "bra|bralette|bandeau|crop|camisole|vest|corset|bustier|singlet|sleeveless|tank|under-?shirt|tee|t-shirt|top\\b|shirt", regions: ["torso"] },
          { match: "knicker|panty|panties|thong|brief|boxer|short|garter|stocking|tights|hold-?up|bottoms|trouser|pant", regions: ["legs"] },
        ],
      },

      // ── Worn in chat ───────────────────────────────────────────────────────
      // A character wearing closet garments in an ordinary chat image. The
      // same trick as the fitting room, with none of its wording about
      // studios: her reference photograph first, the garment flat lays after
      // it, and a prompt that says which is which and nothing else about the
      // clothes.
      //
      // Nothing here describes a garment, and nothing here should ever start
      // to. The picture is the description; words repeating it can only
      // disagree with it, and a paragraph of catalogue prose in an image
      // prompt costs the scene the attention it needs.
      chat: {
        // Her photograph takes one of Wiro's 15 input slots, and coherence
        // falls off long before the other fourteen are used. Same number the
        // fitting room settled on.
        // No cap of its own either — see image.maxReferenceImages. What a chat
        // image can hold is the budget less her base image, and less the
        // expression photograph on the shots that call for one.
        // The only clothing wording in a chat image prompt when garments are
        // worn. It replaces "wearing {charOutfit}" entirely.
        // The last clause about her before the style, and deliberately the
        // weakest thing in the prompt. Five flat lays are a loud instruction to
        // show five garments clearly, and against fifteen words of scene text
        // they win: the act stops happening and she stands there modelling.
        // So this says outright that the clothes may be hidden and that the
        // action outranks them.
        // "the flat lay photographs", not "the reference images": the
        // reference list is no longer only her and her clothes. An expression
        // photograph is a real picture of a dressed person, and under the old
        // wording the jumper she happened to have on in it was one of "the
        // clothes in the reference images" — so it got put on her, mixed in
        // with the garments actually being tracked. Naming the flat lays is
        // what tells the two kinds of picture apart.
        refClause: "wearing the clothes shown in the flat lay garment photographs — those garments only, never anything worn by a person in another reference image — which may be partly hidden, pushed aside or out of frame — what she is doing matters more than showing them, and the pose must never be changed to make them visible",
        // The base image is nude, which is the whole point of it: tattoos
        // hidden under clothes in the reference are tattoos the model never
        // learns about. The cost is that it sees a tattooed torso and a
        // garment and paints the first over the second, so the ink ends up on
        // top of the shirt.
        //
        // Nothing in any prompt has ever mentioned tattoos — they travel as
        // pixels by design — so there was no wording for the model to be
        // wrong about, only a gap. Same shape as the navel piercing: the fix
        // is to say the thing that was being left unsaid.
        //
        // Written so it is a no-op on a nude shot: it speaks only about skin
        // that clothing covers, and where nothing covers her it asks for
        // nothing.
        skinClause: "her tattoos, marks and skin markings are on her skin and underneath whatever she is wearing — no tattoo or marking is drawn on top of, or showing through, any garment, and skin the clothing covers is not visible; they are part of her rather than a thing to display, so nothing is posed, framed or moved aside to reveal one",
      },

      // What a generation costs, per endpoint family. Dezgo prices by family and
      // resolution rather than per model, and steps scale it linearly, so this
      // is a table of four numbers rather than one per model in a list of
      // dozens. Approximate and published rather than measured — treat it as
      // the order of magnitude that decides which model to pick, not a bill.
      // Dezgo publishes a native resolution per model, and for the newer
      // families it is a floor rather than a ceiling — flux_1_schnell declares
      // 512 but generates happily at 1024, which is what every flat lay here
      // was made at before the catalogue started supplying the number. A
      // garment reference is copied by everything downstream, so it wants the
      // detail. SD1 and SD2 genuinely degrade above native and are left alone.
      preferredSide: 1024,
      upscalableEndpoints: ["text2image_sdxl", "text2image_flux", "text2image_sdxl_lightning"],

      dezgoPricing: {
        text2image: 0.0019,
        text2image_sdxl: 0.0075,
        text2image_flux: 0.0075,
        // Lightning reaches 1024px in a few steps, and Dezgo prices steps
        // linearly, so it lands between the 512px models and full SDXL.
        text2image_sdxl_lightning: 0.0038,
      },

      // A flat lay wants a plain, literal photograph of a garment. Models
      // trained for anime, ponies, pixel art or illustration will cheerfully
      // produce a drawing of one, which is useless as a reference for a
      // photographic scene — so they are listed separately rather than mixed
      // in. Matched against the model's name, family and categories together.
      // Matched as substrings against name, id, family and categories, so each
      // one has to be a word that cannot appear innocently: "art" would catch
      // anything artistic and also nothing to do with style, and "dream"
      // catches DreamShaper, which is a general photographic model. Both were
      // in this list and both were wrong.
      // Dezgo's own category vocabulary, from its catalogue: general, realistic,
      // anime, artistic, drawing, tshirt. These are the ones that draw rather
      // than photograph. Authoritative, so it is checked before the keywords.
      stylisedCategories: ["anime", "artistic", "drawing", "tshirt"],

      stylisedHints: ["anime", "pony", "cartoon", "manga", "hentai", "illustration", "illustrious",
                      "artistic", "painting", "toon", "comic", "pixel", "furry", "waifu", "sketch"],

      // Adding one: the id must be Dezgo's exact model slug, which is the last
      // segment of its page URL (dezgo.com/model/<id>). A wrong one is refused
      // with {"model":["InvalidEnumValue"]} and costs nothing — Dezgo validates
      // before it generates — so trying one is cheap, but it does mean an
      // unverified id in this list is a button that only ever errors.
      //
      // "flux_1_dev" was such a button and has been removed: it was inferred
      // from Flux's upstream naming rather than read off Dezgo, and Dezgo does
      // not accept it. Only flux_1_schnell is confirmed working here.
      dezgoModels: [
        {
          // Confirmed: three generations through this at ~7s each.
          id: "flux_1_schnell", label: "Flux schnell — best value",
          endpoint: "text2image_flux", negative: false,
          params: { width: 1024, height: 1024, steps: 4 },
        },
        {
          // From Dezgo's own published Node example, but not yet run from here.
          id: "dreamshaper_7", label: "Dreamshaper 7 — cheapest, 512px (untested)",
          endpoint: "text2image", negative: true,
          params: { width: 512, height: 512, steps: 20, guidance: 7 },
        },
      ],
    },

    // ── Photo studio ─────────────────────────────────────────────────────────
    // The fitting room's method — the character's reference photograph and the
    // garment flat lays handed to the model together — with the rest of the
    // photograph opened up: pose, surroundings, lighting, framing and lens are
    // chosen rather than fixed to "standing in front of a grey backdrop".
    //
    // It lives here rather than in wardrobe.html because the thing being
    // photographed is a character, and characters live in the app. The wardrobe
    // page keeps its fitting room: that one answers "does this outfit work",
    // which wants the plain backdrop and no other choices to get wrong.
    //
    // Every list below is a starting point, not a menu: each picker also takes
    // free text, and what is typed is what reaches the prompt verbatim.
    photoStudio: {
      // Same model as the fitting room, and for the same reason: it is the
      // most reliable of the three at holding several reference images at once,
      // which is what dressing a specific person in specific clothes is.
      model: "seedream-v5-pro-uncensored",
      resolution: "1k",
      // Neither a per-person garment cap nor a headcount: one shot spends
      // image.maxReferenceImages, and a person and a garment cost the same one
      // reference. Still shown in the UI rather than enforced silently — a
      // garment dropped without saying so is one the model was never told
      // about, and the photograph comes back wrong with no clue why.
      //
      // What is lost with maxCharacters is a warning: past three or four faces
      // the model does start averaging them into each other, and a group shot
      // whose whole point is that these particular people are in it is the
      // thing that spoils. That is now yours to judge, which is the trade you
      // asked for.
      // Full length by default — the studio exists to photograph an outfit on
      // a person, and a portrait crop throws away half of one.
      aspectRatio: "3:4",
      aspectRatios: [
        { id: "3:4", label: "Portrait" },
        { id: "9:16", label: "Full length" },
        { id: "1:1", label: "Square" },
        { id: "4:3", label: "Landscape" },
        { id: "16:9", label: "Wide" },
      ],

      // {charDesc}, {garments}, {pose}, {setting}, {lighting}, {framing},
      // {camera} and {mood} are substituted; any that are empty drop out with
      // the sentence around them rather than leaving "photographed in ."
      //
      // The reference images are named by position because that is the only
      // handle the model has on them: without "the first reference image" it
      // has no way to know which picture is the person and which are clothes.
      promptTemplate: "{framing} photograph of the person in the first reference image{charDesc}. {garments}{pose}{setting}{lighting}{camera}{mood}",
      // Two people or more is a different prompt, not the same one repeated.
      // The single-subject template above stays exactly as it was, because
      // position-based garment matching ("the images after the first are the
      // garments") is the most reliable thing this model does and there is no
      // reason to spend that reliability on shots that do not need it.
      //
      // With several people the positions stop being unambiguous — image four
      // could be person two or person one's coat — so each person is named,
      // their photograph is pointed at by position, and their clothes are named
      // in words against their name. Less precise about fabric than the solo
      // path, and the only version that reliably puts the right coat on the
      // right person.
      groupPromptTemplate: "{framing} photograph of {count} people together.{subjects}{heights} {garments}{together}{setting}{lighting}{camera}{mood}",
      // first, second, third… as far as the reference budget can reach. It
      // stopped at six when three people was the limit; with the headcount
      // gone it has to reach the whole budget, because two people both called
      // "the next person" is two people the clothes cannot be told apart on.
      ordinals: ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"],
      // Each clause and how it is worded once something is chosen for it. The
      // wording lives with the field so a new option never needs a code change.
      // ── What the crop can physically contain ─────────────────────────────
      // Words were not enough, and the reason is structural: a flat lay in the
      // reference list IS an instruction to show that garment, and no sentence
      // outcompetes the presence of the picture itself. Asked for a tight
      // close-up with a boot photograph attached, the model kept the crop —
      // the framing rule held — and solved the boot by folding the leg up
      // beside the head. It had no other move left.
      //
      // So the boot stops being sent. The garment is still named as worn, so
      // she is dressed correctly; there is simply no photograph of it in the
      // call for the model to find room for.
      //
      // Deliberately conservative. A garment is only held back where it is
      // plainly outside the crop, never where it might legitimately catch the
      // frame edge — a waistband in a waist-up shot stays, because guessing
      // wrong here costs a garment that should have been visible, and that is
      // the worse error of the two.
      framingRegions: {
        // Torso, not just head. A tight close-up is a face, but a collar and
        // shoulders come with it — the shot that started this had the flannel
        // shirt plainly in it — and holding a top back from a frame that does
        // show it is precisely the over-reach this map is meant to avoid.
        closeup: ["head", "torso"],
        portrait: ["head", "torso"],
        waist: ["head", "torso", "legs"],
        "three-quarter": ["head", "torso", "legs"],
        full: ["head", "torso", "legs", "feet"],
        low: ["head", "torso", "legs", "feet"],
        high: ["head", "torso", "legs", "feet"],
        wide: ["head", "torso", "legs", "feet"],
      },
      // Where a garment sits on the body, for framing purposes only. Close to
      // wardrobe.layers.categoryRegions but not the same map and not shared
      // with it: that one answers "does this cover that", which is why Shoes
      // is empty there — shoes cover nothing. Here shoes are the whole point,
      // so they have a region of their own.
      //
      // Accessory is left out on purpose: it is a hat or a bag or a belt, and
      // there is no way to know which from the category, so it is never held
      // back.
      categoryFrameRegions: {
        Top: ["torso"],
        Outerwear: ["torso"],
        Underwear: ["torso", "legs"],
        Bottom: ["legs"],
        Dress: ["torso", "legs"],
        Sleepwear: ["torso", "legs"],
        Swimwear: ["torso", "legs"],
        "Full outfit": ["torso", "legs"],
        Shoes: ["feet"],
      },
      // Named in the prompt but not photographed, so the model is told they
      // are on her rather than left to infer it from silence. {v} is the list.
      outOfFrameClause: " Also worn but outside this framing: {v} — on the body, out of shot, and nothing is moved, posed or reframed to bring them into view.",

      clauses: {
        // "the flat lay photographs", not "the reference images after the
        // first": the list is no longer only the person and their clothes. An
        // expression photograph is a real picture of a dressed person, and a
        // clause that names garments by POSITION would call that photograph a
        // garment and put whatever they had on in it onto them. Naming the
        // kind of picture instead is what tells the two apart — the same fix
        // the chat refClause needed for the same reason.
        garmentsWorn: "They are wearing {v}. The flat lay photographs among the reference images are those garments — dress the person in exactly those garments, matching the colour, cut, fabric and detailing of whatever part of them is visible precisely.",
        // Nothing chosen is not nothing said: left silent, the model dresses
        // them however it likes and the same settings give a different outfit
        // every time.
        garmentsNone: "They are dressed as they are in the reference image.",
        pose: " They are {v}.",
        // One sentence per person in a group shot: who they are, which
        // photograph is them, and what they are doing. Their pose rides in
        // here rather than in a clause of its own, because in a group shot a
        // pose belongs to a person and not to the photograph.
        subject: " The {ordinal} reference image is {name}{charDesc}{pose}.",
        subjectPose: ", {v}",
        garmentsGroupWorn: "The flat lay photographs among the reference images are garments: {v}. Dress each person in the garments listed against their name, matching the colour, cut, fabric and detailing of whatever part of them is visible precisely.",
        // Said out loud rather than left silent, for the same reason as the
        // solo case: told nothing, the model dresses them however it likes.
        garmentsGroupNone: "Everyone is dressed as they are in their own reference image.",
        // Some chosen, some not. Without this the people with no garments
        // quietly become the model's invention.
        garmentsGroupRest: " Everyone not listed is dressed as they are in their own reference image.",
        // Appended whenever anyone in the shot has been dressed out of the
        // wardrobe. The reference photographs are nude, so the model sees a
        // tattooed body and a flat lay and puts the ink over the garment; the
        // studio has the same gap the chat path does, for the same reason.
        // Silent on anyone left nude, since it speaks only about covered skin.
        skinUnderClothes: " Tattoos, marks and skin markings sit on the skin underneath the clothing — none are drawn on top of, or showing through, any garment. They are simply part of her; the photograph is not being taken to show them, and nothing is posed, framed or moved aside to reveal one.",

        // ── An inventory, not a checklist ──────────────────────────────────
        // Everything handed to this model reads to it as something that must
        // appear. Given five flat lays it will find a way to show five
        // garments, and the ways it finds are all wrong: a dress hitched up so
        // the boots are in shot, an apron sliced open so the shirt under it is
        // visible, a close-up quietly widened to full length so nothing is
        // cropped out. Each one is the model solving the problem it was
        // actually set, which was "show all of this".
        //
        // So the prompt has to set a different problem. What it is given is
        // what she HAS. What appears is whatever the framing and the moment
        // happen to include, and a garment that ends up invisible is a
        // correct result rather than a failure to be worked around.
        garmentsVisibility: " These are the clothes she has on, not a list of things to display. Layer them the way real clothes layer, and let any of them be partly covered, cropped by the frame or not visible at all — never alter the framing, the pose, or a garment's own shape or fit to bring more of them into view. A garment that cannot be seen from this angle is simply not seen.",

        // The single most literal version of the same failure, and worth its
        // own sentence because the framing is a thing the person chose. A
        // close-up asked for a close-up.
        framingAuthority: " The kind of shot named at the start is fixed: keep exactly that framing and crop, even where it leaves most of the clothing, and most of her, outside the frame.",
        together: " Together they are {v}.",
        // Says what a face photograph is FOR, and — as with the garment
        // clauses above — what it is not. Without the second half the model
        // reads a picture of a dressed person as an instruction about clothes,
        // which is exactly how a jumper from an expression photo ended up on
        // her in chat.
        expressionRef: " One reference image is a close photograph of {names} — copy the expression from it and nothing else, not the clothing, framing or background.",
        // ── Height, said as a comparison ──────────────────────────────────
        // Each subject line already carries that person's own height, and in
        // a group shot that is not enough: three independent measurements are
        // three numbers with nothing to measure against, and the model draws
        // its prior, which is three people of the same height. The reference
        // images cannot settle it either — they are separate crops, so they
        // carry no shared scale.
        //
        // So the difference is stated as a difference. Consecutive pairs down
        // the sorted order, which is the shortest set of statements that pins
        // every person against every other, and each one phrased as something
        // that can actually be drawn: a head taller, half a head, eye to eye.
        heightCompareIntro: " The people in this photograph are not the same height, and the difference must be clearly visible where they stand together:",
        heightCompare: " {taller} is {phrase} {shorter}{by}.",
        // Every subject in the same tier. Worth saying rather than leaving
        // silent, for the same reason as the garments: told nothing, the model
        // decides, and a deliberate match reads as an accident.
        heightCompareAllSame: " Everyone in this photograph is the same height as everyone else.",
        setting: " The setting is {v}.",
        lighting: " Lit by {v}.",
        camera: " Shot on {v}.",
        mood: " The mood is {v}.",
      },
      // Appended after the assembled prompt, the way the chat path appends its
      // own style modifiers. Deliberately about the photograph rather than the
      // person: everything about the person is in the reference image.
      styleModifiers: "photorealistic, sharp focus, natural skin texture, true to life colour, high detail",

      // ── Who is in the frame, anatomically ────────────────────────────────
      // buildChatCharDesc emits the gender as the raw enum, so a subject line
      // read "Anna, 22 year old, Female" — a form field rather than a
      // description, and the weakest possible way to say it. In an explicit
      // shot of two women the model overrode it and gave one of them a penis,
      // because its prior for two people in a sex act is far stronger than one
      // capitalised word.
      //
      // So the studio says it in prose — "a 22 year old woman" — and in an
      // explicit shot says the negative too, which is the part a prior this
      // strong actually needs.
      sexWords: {
        Female: "woman",
        Male: "man",
        "Non-binary": "non-binary person",
      },
      // {age}, {sex} and {height} are substituted; each drops out when empty.
      subjectDescTemplate: "a {age} year old {sex}{height}",
      // How a gap in centimetres between two people is said out loud. Matched
      // on the difference, smallest maxCm first, and the last tier is the
      // catch-all. The wording is deliberately anatomical rather than metric —
      // "a full head taller" is a thing the model can compose, "17 cm taller"
      // is not, and the whole failure being fixed here is that it was only
      // ever given the second kind.
      //
      // The first tier's phrase reads as an equality rather than a comparison,
      // so it fits the same sentence as the rest: "Ben is the same height as
      // Cara." Below it the two people are close enough that asserting a
      // difference would cost more than it buys.
      // `by` trails the other person's name rather than sitting inside the
      // comparison, so the sentence stays a sentence: "Cara is clearly taller
      // than Ben, by about half a head" and not "taller than, by half a head
      // Ben". It is optional and drops out where there is nothing to add.
      heightDifferenceTiers: [
        { maxCm: 4,   phrase: "the same height as", by: "" },
        { maxCm: 9,   phrase: "a little taller than", by: "" },
        { maxCm: 20,  phrase: "clearly taller than", by: ", by about half a head" },
        { maxCm: 999, phrase: "much taller than", by: ", by a full head or more" },
      ],
      // Appended only when the shot reads as explicit. Deliberately not gated
      // on any character's NSFW toggle: this adds no explicit content of its
      // own, it only stops the model drawing anatomy that belongs to nobody in
      // the photograph, and that is as wrong in a tame shot as an explicit one.
      //
      // Named parts rather than "correct anatomy": a model cannot act on a
      // word like correct, and the whole failure is that it filled a gap with
      // its own assumption. Only the sexes actually present are asserted.
      anatomyGuard: " Every body in this photograph belongs to one of the people described above — there is nobody else in the frame and no other body parts. {sexes}",
      // The studio builds its prompt from pickers rather than from a scene, so
      // it never had the chat path's problem of a *described* act being drawn
      // as an approach to one. It has the same problem for a different reason:
      // every pose and interaction in the lists is a held position, and typing
      // "having sex" into the notes box adds an act to a sentence otherwise
      // made entirely of stillness. The result is the same photograph of two
      // people arranged next to each other.
      //
      // Hung off the same isIntimateScene test as the anatomy guard, which
      // already reads the notes as well as the pickers — so it lands exactly
      // where an explicit shot has been asked for, whichever way it was asked.
      intimateMotion: " The act is under way and at the height of it, not beginning: their bodies are joined where the act joins them, caught mid-motion, with weight and pressure showing where they meet.",
      // One clause per distinct sex present, joined. {who} is a name or a list
      // of names, {sex} the word above.
      anatomySexClause: "{who} has the body and genitals of a {sex}, and no anatomy of any other sex.",

      // The pickers. `id` is what a chip stores, `text` is what reaches the
      // prompt — the chip says "Leaning on a wall", the model is told the
      // sentence that actually renders one.
      poses: [
        { id: "standing", label: "Standing", text: "standing facing the camera, weight on one hip, arms relaxed at their sides" },
        { id: "walking", label: "Walking", text: "walking towards the camera mid-stride, looking ahead" },
        { id: "leaning", label: "Leaning", text: "leaning back against a wall, one foot flat against it, hands behind them" },
        { id: "sitting", label: "Sitting", text: "sitting, leaning forward slightly with their forearms on their knees" },
        { id: "overshoulder", label: "Over the shoulder", text: "turned away from the camera and looking back over one shoulder" },
        { id: "reclining", label: "Reclining", text: "reclining on their side, propped on one elbow" },
        { id: "kneeling", label: "Kneeling", text: "kneeling upright, hands resting on their thighs" },
        { id: "candid", label: "Candid", text: "caught mid-movement and not looking at the camera, as if unaware of it" },
        { id: "arms-crossed", label: "Arms crossed", text: "standing with their arms crossed, chin slightly raised" },
        { id: "hands-in-hair", label: "Hands in hair", text: "both hands lifted into their hair, elbows out, head tilted back" },
        { id: "twirl", label: "Twirling", text: "mid-turn with the clothing caught in motion around them" },
        { id: "lying-back", label: "Lying back", text: "lying on their back, head turned towards the camera" },
      ],
      settings: [
        { id: "studio-grey", label: "Grey studio", text: "a plain seamless light grey studio backdrop" },
        { id: "studio-black", label: "Black studio", text: "a black studio backdrop with the subject lit away from it" },
        { id: "bedroom", label: "Bedroom", text: "a warm, softly cluttered bedroom with an unmade bed behind them" },
        { id: "apartment", label: "Apartment", text: "a modern apartment living room with a large window to one side" },
        { id: "kitchen", label: "Kitchen", text: "a bright domestic kitchen, worktop and cupboards behind them" },
        { id: "bathroom", label: "Bathroom", text: "a tiled bathroom with a mirror and a lit vanity" },
        { id: "city-street", label: "City street", text: "a busy city street at pavement level, shopfronts blurred behind them" },
        { id: "rooftop", label: "Rooftop", text: "a rooftop above a city skyline" },
        { id: "beach", label: "Beach", text: "an open sand beach with the sea behind them" },
        { id: "forest", label: "Forest", text: "a wooded path with dappled light through the canopy" },
        { id: "garden", label: "Garden", text: "a green garden in summer, planting and a fence behind them" },
        { id: "cafe", label: "Café", text: "a small café interior, tables and a counter behind them" },
        { id: "bar", label: "Bar", text: "a dim bar with bottles lit behind the counter" },
        { id: "hotel", label: "Hotel room", text: "a hotel room with a made bed and city light through the curtains" },
        { id: "car", label: "Car", text: "the passenger seat of a car, street light passing across the window" },
        { id: "pool", label: "Poolside", text: "the edge of a swimming pool, water and loungers behind them" },
      ],
      lighting: [
        { id: "softbox", label: "Soft studio", text: "soft even diffused studio lighting, no harsh shadows" },
        { id: "golden", label: "Golden hour", text: "low golden hour sunlight raking across them from one side" },
        { id: "window", label: "Window light", text: "soft daylight from a large window to one side" },
        { id: "overcast", label: "Overcast", text: "flat, even overcast daylight" },
        { id: "hard-sun", label: "Hard sun", text: "hard midday sunlight with crisp, defined shadows" },
        { id: "rim", label: "Rim light", text: "a strong backlight rimming their outline, the front in soft fill" },
        { id: "candle", label: "Candlelight", text: "warm low candlelight, deep falloff into shadow" },
        { id: "neon", label: "Neon", text: "coloured neon light, magenta and cyan across them" },
        { id: "moonlight", label: "Moonlight", text: "cool blue moonlight through a window" },
        { id: "lamp", label: "Lamplight", text: "a single warm lamp close by, the rest of the room dark" },
        { id: "flash", label: "Direct flash", text: "hard direct on-camera flash, bright foreground and a dark background" },
        { id: "practicals", label: "Practicals", text: "the room's own lamps and screens as the only light" },
      ],
      // Framing sits at the front of the sentence rather than in a clause, so
      // it reads as the kind of photograph rather than an afterthought.
      framings: [
        { id: "full", label: "Full length", text: "Full length fashion" },
        { id: "three-quarter", label: "Three quarter", text: "Three-quarter length" },
        { id: "waist", label: "Waist up", text: "Waist-up" },
        { id: "portrait", label: "Portrait", text: "Head and shoulders portrait" },
        { id: "closeup", label: "Close up", text: "Tight close-up" },
        { id: "wide", label: "Wide", text: "Wide environmental" },
        { id: "low", label: "Low angle", text: "Low-angle full length" },
        { id: "high", label: "High angle", text: "High-angle looking down" },
      ],
      cameras: [
        { id: "85mm", label: "85mm portrait", text: "an 85mm lens at f/1.8, background thrown out of focus" },
        { id: "35mm", label: "35mm reportage", text: "a 35mm lens, the room visible around them" },
        { id: "50mm", label: "50mm natural", text: "a 50mm lens at eye level, natural perspective" },
        { id: "telephoto", label: "Telephoto", text: "a 135mm telephoto, compressed perspective" },
        { id: "wide-lens", label: "Wide angle", text: "a 24mm wide angle close to the subject" },
        { id: "film", label: "35mm film", text: "35mm colour film with visible grain" },
        { id: "polaroid", label: "Polaroid", text: "an instant camera, soft contrast and a slight colour cast" },
        { id: "phone", label: "Phone", text: "a phone camera, everything in focus" },
      ],
      moods: [
        { id: "editorial", label: "Editorial", text: "high fashion editorial, composed and deliberate" },
        { id: "intimate", label: "Intimate", text: "quiet and intimate, unguarded" },
        { id: "playful", label: "Playful", text: "playful and light, caught laughing" },
        { id: "moody", label: "Moody", text: "moody and low key, heavy shadow" },
        { id: "glamour", label: "Glamour", text: "polished glamour, everything flattering" },
        { id: "documentary", label: "Documentary", text: "plain documentary, nothing styled" },
        { id: "cinematic", label: "Cinematic", text: "cinematic, like a film still" },
        { id: "dreamy", label: "Dreamy", text: "dreamy and soft, gentle haze" },
      ],

      // How the people in a group shot relate to each other. Only ever asked
      // for when there is more than one person, so there is no default: two
      // people standing in a room are doing something, and guessing what is
      // how you get a stock photograph.
      interactions: [
        { id: "side-by-side", label: "Side by side", text: "standing side by side facing the camera" },
        { id: "arm-in-arm", label: "Arm in arm", text: "standing arm in arm, close together" },
        { id: "embracing", label: "Embracing", text: "holding each other, one resting their head on the other" },
        { id: "talking", label: "Talking", text: "turned towards each other mid-conversation, ignoring the camera" },
        { id: "laughing", label: "Laughing", text: "laughing together at something out of frame" },
        { id: "back-to-back", label: "Back to back", text: "standing back to back, both facing the camera" },
        { id: "one-behind", label: "One behind", text: "one standing behind the other, arms around their waist" },
        { id: "sitting-together", label: "Sitting together", text: "sitting together on the same seat, leaning in" },
        { id: "walking-together", label: "Walking together", text: "walking together towards the camera in step" },
        { id: "apart", label: "Apart", text: "standing apart from each other, not touching" },
      ],

      // What a fresh visit starts on. Chosen to be the shot you would take if
      // you had not thought about it — a plain full-length one, which is also
      // the one that shows an outfit best.
      defaults: {
        pose: "standing",
        setting: "studio-grey",
        lighting: "softbox",
        framing: "full",
        camera: "85mm",
        mood: "editorial",
      },
    },

    // ── Image generation ─────────────────────────────────────────────────────
    image: {
      // Images generated during a chat are shot from the user's own eyes — the
      // user is the camera. Their own hands, arms and legs still belong in
      // frame when touching or reaching for something, the way they do in a
      // first-person game; what never appears is their face, head or back,
      // since the camera cannot see itself.
      // Deliberately short. "viewer's face never visible" was here to stop the
      // camera seeing itself, but the model works that out from "through the
      // viewer's own eyes" — and every clause we add to help is a clause it
      // can render literally instead. Tested: the trimmed version behaves the
      // same, without the face and frame tokens.
      povBase: "first person POV through the viewer's own eyes",

      // ── Body marks and the image path ────────────────────────────────────
      // Tattoos already reach chat images only as pixels in the base image,
      // never as words — the base image is the source of truth for what is on
      // her skin, and a second account of it only argues with the picture.
      // Piercings, scars, moles and birthmarks are the same kind of thing and
      // were not covered, because they arrive by a different route: the vision
      // model's written `appearance.description`, which is handed to the scene
      // extractor. Told about a navel piercing, the extractor writes a scene
      // that shows one — and showing one means baring the midriff, so a detail
      // that should have been incidental starts deciding the framing and the
      // clothing of every photograph.
      //
      // So the description is stripped of them on the way to the extractor
      // ONLY. The [APPEARANCE] note the chat model reads keeps them: knowing
      // she has a navel piercing is exactly the sort of thing her prose should
      // be able to mention, and prose cannot force a camera anywhere.
      bodyMarks: {
        // A sentence is dropped when it names one of these…
        terms: [
          "tattoo", "tattoos", "tattooed", "ink",
          "piercing", "piercings", "pierced", "stud", "studs",
          "navel", "belly button", "belly-button", "belly ring", "navel ring",
          "nipple ring", "septum",
          "birthmark", "birthmarks", "scar", "scars",
          "mole", "moles", "beauty mark", "beauty spot",
          "stretch marks",
        ],
        // …and does NOT also carry one of these. A description often opens
        // with "a slender build, fair skin that shows no prominent scars" —
        // one sentence holding the build, the height and the colouring, which
        // happens to say the word "scars". Dropping that whole sentence to
        // remove a mark that is not even there would cost far more than it
        // saves, so a sentence doing real descriptive work is always kept.
        keepTerms: [
          "build", "height", "tall", "short", "slender", "slim", "curvy",
          "frame", "figure", "athletic", "stocky", "petite",
          "hair", "eyes", "eye", "skin", "complexion", "face", "facial",
          "nose", "lips", "mouth", "jaw", "cheek", "cheekbones", "brows",
          "shoulders", "freckles",
        ],
      },
      povArmsModifier: "the viewer's own hand and forearm in the foreground, entering frame from the camera",
      povArmsOwnedModifier: "the foreground hand and arm belong to the viewer, one pair only",
      // Phrased as what IS in the shot, not what is absent. "no hands or arms
      // in frame" still puts hands and arms in the prompt, and image models
      // are unreliable at negation in a positive prompt — the tokens summon
      // the thing as often as they suppress it. Describing an empty
      // foreground gives the model something to draw instead.
      povNoLimbs: "empty foreground, clear unobstructed view of the scene, the viewer's arms down at their sides below the frame",
      povIntimateModifier: "the viewer's own body framing the bottom of the shot",
      // Wiro/Seedream has no negative_prompt parameter, so proportion guidance
      // goes into the positive prompt instead.
      // No lens. "50mm" was in every prompt and the model makes a better call
      // on its own; at POV distance a stated 50mm exaggerates whatever is
      // nearest the camera, which is exactly what we do not want.
      styleModifiers: "photorealistic, natural lighting, sharp focus",
      // "realistic human proportions" used to lead this line and was working
      // against the body sliders — it is an instruction to draw the model's own
      // default figure, and it sat at the very end of the prompt where it had
      // the last word. What is actually needed here is the limb guard.
      // Explicit POV shots kept coming out with the viewer's anatomy absurdly
      // elongated, and the cause was composition rather than size. Nothing in
      // the prompt said where in the frame she was, so the model fell back on
      // its portrait habit and centred her head. With her head in the middle
      // of a 9:16 frame and the viewer's body entering at the bottom edge,
      // the only way to connect the two is to stretch what is between them.
      // The scene note used to ask for "a normal sized penis" against this,
      // which never worked and has been removed: an adjective cannot win an
      // argument with a geometric constraint.
      //
      // So this says one thing: she is near, and near fills the frame. Nothing
      // else. Two longer versions have been cut back to it, each for a reason
      // worth keeping:
      //
      // It once said "the camera angled down towards her", which is right for
      // oral and wrong for her riding the viewer — there the viewer is lying
      // down and the camera looks up. This clause does not know the scene, so
      // it no longer claims a direction.
      //
      // It then said the viewer's body "meets her at its true size... never
      // elongated or stretched to bridge a gap", and that made things worse.
      // Two reasons, both general enough to remember. A diffusion model does
      // not do negation — it conditions on the words that are there, so
      // "elongated", "stretched" and "gap" went into a prompt about a penis
      // and argued for what they were meant to forbid. And it was the fourth
      // separate mention of the viewer's anatomy in one prompt, where the file
      // already records that removing a redundant mention of the viewer's
      // hands and arms measurably improved the images. Every mention is
      // something the model tries to draw.
      //
      // So: describe where SHE is, and let viewerBody be the only clause that
      // names any part of the viewer.
      povIntimateFraming: "close to her, she fills much of the frame",

      // ── Whose body the viewer has ────────────────────────────────────────
      // The viewer is the camera, and in an intimate scene the extractor is
      // told to name the viewer's own anatomy that is involved. Nothing ever
      // told it whose body that is — so it fell back on the assumption a
      // language model makes about the user of an app like this, and wrote the
      // viewer a penis. In a scene between two women that anatomy has nowhere
      // to belong, and the image model hung it on the woman in frame.
      //
      // The user's gender is already known: it is in the user persona, the
      // same value the chat model is told. It simply never reached here.
      viewerSexWords: {
        Female: "a woman",
        Male: "a man",
        "Non-binary": "a non-binary person",
      },
      // Substituted into scenePromptInstruction. {viewer} is the phrase above.
      viewerNoteKnown: " The User — the viewer, the camera — is {viewer}. Any of the User's own anatomy named in scene or viewerBody must be the anatomy of {viewer}. Never give the User the genitals of another sex.",
      // Unset, or set to something these words do not cover. Silence here is
      // what caused the bug, so saying nothing is not an option — but neither
      // is inventing a body for them. Naming no genitals at all is the only
      // answer that cannot be wrong, and the contact is still describable
      // without them.
      viewerNoteUnknown: " The User's sex has not been stated. Do NOT name the User's genitals in scene or viewerBody. Describe the contact by what {name} is doing and by which of the User's hands, arms, mouth, chest, thighs or hips it involves.",
      // Added to the image prompt itself in an intimate contact shot, where
      // the viewer's body may be in frame and so may be drawn wrong. Kept out
      // of every other shot: a clause the model cannot use is a clause it can
      // still render literally.
      povViewerSex: "the viewer is {viewer}",
      // The viewer's own colouring and build, and ONLY in the frames where
      // their body is actually drawn. Everywhere else the viewer is a camera,
      // and a clause describing a body the shot does not contain is one the
      // model can render anyway — as a second person in the frame.
      povViewerDesc: "the viewer's own body is {desc}",

      // What the POV clause says about the viewer's own body in an explicit
      // shot — where it is, and that it is joined to her rather than near her.
      //
      // The specific version — the extractor naming the part and the frame
      // edge, "the viewer's penis entering from the bottom of the frame" —
      // is kept for ordinary contact, where it works. In explicit shots it
      // was one instruction too many: the scene text already says what her
      // mouth is on, so naming the same anatomy again as a placed object in
      // the frame gave the model two accounts of one thing to reconcile, and
      // it reconciled them into a tangle.
      //
      // This is NOT the clause that was removed for producing stray limbs.
      // That one — "the viewer's own body framing the bottom of the shot" —
      // asserted that a body WAS there without saying which part, so the
      // model had to invent something to satisfy it. Permission is not a
      // requirement: there is nothing here to satisfy, so nothing to invent.
      // povBodyPermissive — "the viewer's own body may enter the frame where
      // the action calls for it" — used to sit here, and the two clauses
      // below replace it. Permission was the right answer to the stray-limb
      // problem and the wrong one to this: it was the strongest thing an
      // explicit shot ever said about the two bodies, and a model given only
      // permission to put them together resolves that the safe way — adjacent,
      // not joined. Every explicit shot came out a half-second before anything
      // happened.
      //
      // This asserts the contact without naming a part — "the point the scene
      // describes" points back at the act rather than restating it, so it does
      // not reintroduce the second account of one anatomy that the permissive
      // clause was cut back to avoid. There is nothing here to invent, only
      // something already named to be believed.
      povIntimateContact: "their bodies joined at the point the scene describes, in full contact and not merely close",
      // The other half of the same failure, and the reason it read as a
      // photograph of a pose. Nothing on the chat path ever said the shot was
      // a moment in a movement — the studio path has "caught mid-movement" as
      // a pose, chat had no equivalent at all — so a prompt of static
      // descriptions got a static image. Weight and pressure are the visible
      // evidence of motion in a still frame; asking for them is what stops the
      // two bodies being drawn resting against each other.
      povIntimateMotion: "caught mid-motion at the height of the act, weight and pressure showing where they meet, flesh giving where it is pressed",

      // There was a povEyeLevel table here that turned the tracked userPose
      // into "seen from the eye level of someone standing". It is gone, and
      // the scene instruction now asks for the same thing instead.
      //
      // Two reasons it was the wrong source. It read staging.userPose, which
      // is only rewritten when the conversation shows the viewer moving, so
      // it could assert "standing" with total confidence four turns after he
      // sat down — and a confident wrong camera height is exactly what the
      // model bends the image to satisfy. And it was a keyword table, so it
      // knew "leaning against the counter" and not whatever the next scene
      // says.
      //
      // The extractor reads the last ten messages every time an image is
      // made. It already leaked this through the ban — "eyes looking up" in a
      // shot where she was kneeling — because it is the one component that
      // actually knows.
      // How many pictures a character's gallery keeps. It was 20, hardcoded at
      // three call sites, and nobody asked for a limit — a gallery that had
      // reached it dropped its oldest entry every time a new image was made,
      // silently. Nothing was ever deleted: the files stay in storage and the
      // pictures stay in the chat where they were generated, so a dropped
      // entry is a picture the gallery stopped pointing at rather than one
      // that is gone.
      //
      // Still a number rather than no limit, because the gallery rides in one
      // row as a JSON array and is rewritten whole on every new image.
      galleryLimit: 200,

      // Photographs of the real person pulling one expression, attached to a
      // chat image when the scene calls for that expression.
      //
      // The problem they solve: the base image is a neutral, mid-thigh studio
      // shot, so it is the only account of the face the generator has ever
      // seen. Asked for a smile, it has to invent one, and it invents a
      // generic one — the smile is the model's, over her geometry. No wording
      // fixes that, because the words are not what is missing. A photograph of
      // her actually smiling is.
      //
      // Fixed slots rather than free tags, so choosing one is a lookup rather
      // than another model call. words are matched against the extracted
      // scene, which already names the expression, at a word boundary and as
      // prefixes: "smil" catches smiles, smiling and smiled.
      //
      // Neighbours deliberately share a slot — a laugh is a smile at a higher
      // volume and the same muscles, so one photograph covers both. Nothing
      // crosses between slots: attaching an angry photograph to a smiling
      // scene would be worse than the generic smile, since it argues with the
      // moment the image was asked for rather than merely being nobody's face.
      // An unfilled slot attaches nothing at all and the image is generated
      // exactly as it was before, which is what makes a set of one or two
      // photographs worth having.
      expressions: {
        // No neutral slot: the base image is the neutral face already.
        slots: [
          { key: "smile", label: "Smile", hint: "Smiling broadly, teeth showing — covers laughing too.",
            words: ["smil", "grin", "laugh", "giggl", "chuckl", "beam", "amused", "smirk"] },
          { key: "angry", label: "Angry", hint: "Angry — scowling, jaw set.",
            words: ["angry", "anger", "furious", "fury", "scowl", "glar", "snarl", "seething", "irate", "livid"] },
          { key: "sad", label: "Sad", hint: "Upset or crying.",
            words: ["cry", "crie", "cried", "tear", "sob", "weep", "wept", "upset", "distraught", "miserab"] },
          { key: "surprised", label: "Surprised", hint: "Caught off guard — eyes wide, mouth open.",
            words: ["surpris", "shock", "startl", "astonish", "gasp", "wide-eyed", "stunned"] },
          { key: "serious", label: "Serious", hint: "Straight-faced and intent.",
            words: ["serious", "stern", "intense", "intently", "focused", "frown", "grim", "unimpressed"] },
        ],

        // Reading the slots off the photographs somebody just uploaded, rather
        // than making them fill a grid by hand. {slots} is the list above.
        //
        // The whole difficulty is in saying no. A model asked which of five
        // expressions a photograph shows will pick one, because that is what
        // it was asked; and a half-smile filed under "angry" is exactly the
        // failure this feature was built to avoid, since a wrong slot is worse
        // than an empty one. So "none" leads the list, is said to be the usual
        // answer, and a confidence has to be given — anything under
        // minConfidence is dropped whatever it claims to be.
        autoFill: {
          instruction: "You are sorting photographs of one person by facial expression.\n\nThe expressions being collected are:\n{slots}\n\nFor EACH image, in the order given, decide whether it clearly and unmistakably shows one of those expressions. \"none\" is the right answer for most photographs and is never a failure: an ordinary or neutral face, a faint or ambiguous expression, a face that is turned away, blurred, in shadow, partly covered or too small to read, or any expression not on the list, is \"none\". Do not stretch a photograph to fit a slot, and do not try to fill every slot.\n\nAlso give the face's position in the frame as [x, y, width, height], each a fraction of the image between 0 and 1, x and y being the top-left corner of a box around the head. Give this only when you can see the head clearly; otherwise use null.\n\nReturn ONLY a JSON array with one object per image, in the same order, no markdown and no commentary:\n[{\"i\": 0, \"expression\": \"none\" or one of the keys above, \"confidence\": 0.0 to 1.0, \"face\": [x, y, w, h] or null}]\n\nconfidence is how certain you are of the expression: 1.0 for an unmistakable one, below 0.6 for anything you are talking yourself into.",
          // Deliberately high. A missed smile costs nothing — the slot stays
          // empty and the image is generated the way it always was — while a
          // wrong one is sent to the generator every time that expression comes
          // up in chat.
          minConfidence: 0.75,
          // The head box a vision model gives back is approximately right at
          // best, so it is grown by this fraction of its own size on each side
          // before cropping. Head and shoulders is the intended crop; a tight
          // one that clips her chin is the thing to avoid.
          padding: 0.45,
          // Sanity limits on that box, since a box is the part a vision model
          // is worst at. A face filling a hundredth of the frame is a mistake,
          // and one filling the whole of it is the model declining to answer.
          // Outside these the photograph is kept whole rather than cropped.
          minBoxFraction: 0.01,
          maxBoxFraction: 0.9,
          // Longest side of the stored crop, in pixels. Enough for a face; not
          // a second copy of a phone photograph.
          maxCropPx: 768,
        },

        // Making a slot rather than uploading one.
        //
        // Until this existed a slot could only be filled from a photograph,
        // which meant expressions worked for a face built from photos and not
        // at all for one that was generated — and a generated face is the
        // usual case. Nothing was broken; there was simply never anything to
        // pick, so the control stayed hidden and read as broken.
        //
        // Anchored to the base image, exactly as the avatar is: the reference
        // carries who this is, so the prompt says only what the face is doing.
        // Re-describing hair and colouring alongside an inputImage pulls the
        // result towards a fresh person instead of the same one smiling.
        generate: {
          preamble: "A head and shoulders photograph of the person in the reference image, the same face, same hair, same skin",
          // {expression} is the slot's hint, which is already written as a
          // description of a face rather than a label.
          expressionTemplate: "their expression: {expression}",
          framing: "head and shoulders, face filling most of the frame, looking towards the camera",
          // Plain and even, so the crop carries an expression and not a mood.
          // A dramatic light here would be copied into every chat and studio
          // image the slot is used in, which is not what the slot is for.
          lighting: "flat even lighting, plain neutral background",
          suffix: "photographic, sharp focus on the face, natural skin texture",
        },
      },

      // The one ceiling on reference images, for every screen that sends any:
      // a chat image, the fitting room, the photo studio, a base image built
      // from uploaded photographs. It used to be four separate caps — five
      // garments here, three people there — which meant a shot could be
      // refused a garment while well under what the model would have taken,
      // and the numbers had to be kept in step by hand.
      //
      // Now it is one budget spent by whatever the photograph actually holds:
      // five people and two photos of one of them leaves three garments.
      //
      // Ten because that is the documented reference cap for Seedream. The 15
      // these comments used to cite is a different number — inputs plus
      // outputs — and some platforms report references working up to 14 under
      // it. We ask for one image out, so there is room to try; this is the
      // figure that is actually written down.
      maxReferenceImages: 10,

      proportionGuard: "two arms and two hands per person, no extra limbs, anatomically coherent",
      // Instruction sent to the extractor model that turns the recent
      // conversation into a Stable Diffusion prompt. {name}, {charDesc},
      // {recent}, {actNote} and {ownBodyRule} are substituted in.
      // The extractor returns JSON rather than a bare prompt string, because
      // whether the two of them are touching cannot be decided by matching
      // words. It was a regular expression over a verb list, which said no to
      // "she nibbles his earlobe" and yes to "I pour a drink and watch her
      // undress" - wrong in both directions on ordinary phrasing, and every
      // fix was one more word on the list. The model already reads the scene
      // in order to write the prompt; it can answer the question in the same
      // call, and it understands English.
      //
      // viewerBody is the other half. Told only "the viewer's own body frames
      // the bottom of the shot", the image model filled that space with
      // whatever limb it liked - repeatedly a foot. Naming the part and the
      // frame edge it enters from leaves nothing to invent.
      // Added to the scene instruction only when the character is wearing
      // garments out of the wardrobe. Their pictures are sent to the image
      // model, so the prompt must not describe them — describing a garment the
      // model can already see can only contradict it. What the picture cannot
      // say is what has happened to it since: a jacket hanging open, a hem
      // pulled up, a shoe off. That, and only that, is what this asks for.
      // {garments} is the list of garment names.
      clothingStateNote: "\n\n{name} is wearing: {garments}. Photographs of those garments are supplied to the image model, so NEVER describe them — not their colour, fabric, cut or detailing. clothingState is only for how they are being worn RIGHT NOW where that differs from simply having them on: \"the denim jacket hanging open\", \"the skirt pushed up round her waist\", \"one shoe off\", \"the sunglasses in her hand\". Where a garment has come off entirely, say so: \"the jacket off, dropped on the floor\". If they are all simply being worn as normal, use an empty string.",
      // The field, kept out of the JSON shape entirely when there is nothing
      // to report — an optional field a model is told to ignore is one it
      // fills in anyway.
      clothingStateField: ", \"clothingState\": \"...\"",
      scenePromptInstruction: "You are describing one moment from a roleplay conversation so that an image can be generated of it. The image is a first-person POV shot taken through the User's own eyes: the User is the camera.\n\nCharacter description: {charDesc}.\n\nConversation:\n{recent}\n\nDescribe the moment at the very END of the conversation - what is {name} doing RIGHT NOW.\n\nReturn ONLY a JSON object, with no other text and no code fences:\n{\"scene\": \"...\", \"touching\": true or false, \"viewerBody\": \"...\"{clothingField}}\n\nscene - 15 to 30 words: {name}'s action, pose and expression in this moment. Put the most important action or pose FIRST. Be concrete and literal. Do NOT include names. Do NOT use abstract words like \"mood\" or \"atmosphere\". The location and both people's clothing are added separately, so do NOT restate or decide either of them here. Do say where {name} is in relation to the viewer when the action puts them at different heights or distances — kneeling below them, leaning over them, face to face — and which way they are looking. That is what tells the camera where it is, and only you can know it, because only you have read what just happened.\n\ntouching - true if {name} and the User are in physical contact at this moment, false if they are not. Judge it from what the text actually describes, however slight the contact is and however it is worded. Being undressed, or nearby, or talking, is not contact; any part of one of them against the other is.\n\nviewerBody - when touching is true, which of the User's OWN body parts are in the shot and where they enter the frame, as a short phrase: for example \"the viewer's hand in her hair, entering from the top of the frame\". Name the part and the frame edge it comes in from, so it is not drawn floating. When touching is false, use an empty string.\n\nThe User is the camera. Never describe the User's face, head, hair or back - the camera cannot see itself. Never refer to the User in the third person: not \"him\", \"his\", \"the man\", nor by any name - always \"the viewer\". {name}'s own body belongs in scene; only the User's body belongs in viewerBody. Where scene has to mention a part of the User's body - what her mouth or hands are on - name it as the viewer's: \"mouth against the viewer's inner thigh\", never a bare \"mouth on thigh\", which leaves the image model to decide whose it is.{actNote}{viewerNote}{clothingNote}",
    },

    // ── Models & defaults ────────────────────────────────────────────────────
    models: {
      text: [
        { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B (Best)" },
        { id: "mistralai/mistral-small-3.1-24b-instruct", label: "Mistral Small 3.1 24B" },
        { id: "meta-llama/llama-3.1-8b-instruct", label: "Llama 3.1 8B (Fast)" },
        { id: "mistralai/mistral-7b-instruct", label: "Mistral 7B" },
        { id: "google/gemma-3-27b-it", label: "Gemma 3 27B" },
        { id: "moonshotai/kimi-k2.6", label: "Kimi K2.6" },
        { id: "minimax/minimax-m3", label: "MiniMax M3" },
        { id: "mistralai/mistral-small-2603", label: "Mistral Small 4" },
        { id: "mistralai/mistral-large-2512", label: "Mistral large" },
        { id: "nousresearch/hermes-4-70b", label: "Hermes 4 70B" },
      ],
      // Lite is listed first because it is the fastest of the three; Pro is
      // the slowest. The proxy keeps its own allowlist of these ids, so adding
      // one here without adding it there will fail the run.
      // Pro first because the app's default image model is the first entry, and
      // it is the only one that reliably renders a POV shot: Lite substitutes a
      // foot for anatomy it will not draw, and v4.5 does the same or loses the
      // POV framing. Ordering these fastest-first meant a fresh browser with no
      // saved settings silently picked the worst of the three.
      image: [
        { id: "seedream-v5-pro-uncensored", label: "Seedream v5 Pro (Wiro) — most reliable" },
        { id: "seedream-v4-5-uncensored", label: "Seedream v4.5 (Wiro) — faster, unreliable POV" },
        { id: "seedream-v5-lite-uncensored", label: "Seedream v5 Lite (Wiro) — fastest, poor at POV" },
      ],
      // Resolutions differ per model and "1k" is not valid on the two newer
      // ones: Lite takes auto/2k/3k, v4.5 takes ""/2k/4k. 2k is the smallest
      // both accept, so it is the fastest setting available on each.
      // outputFormat is a Pro-only parameter; the others do not list it.
      imageParams: {
        "seedream-v5-lite-uncensored": { resolution: "2k", aspectRatio: "9:16" },
        "seedream-v4-5-uncensored": { resolution: "2k", aspectRatio: "9:16" },
        // 1k, which only Pro accepts. 2k costs double a 1k generation and the
        // extra detail was not visible in the finished images, so the money was
        // going nowhere. Lite and v4.5 stay at 2k because 1k is not a valid
        // resolution on either.
        // jpeg, not png. Every image is paid for three times over in wall-clock
        // time — Wiro's own postprocess, the download into upload-image, and
        // the upload into Storage — and then again on every page load that
        // shows it. A 1k png is several times the bytes of the same image as
        // jpeg for no visible difference in a photograph. Nothing downstream
        // assumes a format: the status path returns whatever URL Wiro gives,
        // and upload-image reads the mime off the response.
        "seedream-v5-pro-uncensored": { resolution: "1k", aspectRatio: "9:16", outputFormat: "jpeg" },
      },
      vision: "mistralai/mistral-small-3.1-24b-instruct",
      reactivity: "meta-llama/llama-3.1-8b-instruct",
    },

    // ── Opening scenarios ────────────────────────────────────────────────────
    // The five choices offered when a conversation starts. Categories are
    // drawn at random from these lists so repeated starts differ; an NSFW
    // character gets a mix, everyone else gets only the SFW list.
    openings: {
      count: 5,
      // How many of the five come from the NSFW list when the character is
      // marked NSFW. The rest come from the SFW list. Zero means an NSFW
      // character is offered the same categories as everyone else.
      nsfwCount: 2,
      sfwCategories: [
        "a completely mundane everyday moment (doing chores, cooking, commuting) with no romantic angle whatsoever",
        "an awkward or embarrassing situation for one or both of you",
        "a tense or emotionally charged moment — an argument, confession, or unresolved tension",
        "a late night or early morning — tired, vulnerable, guards down",
        "something physically active — sport, exercise, working with hands",
        "a public place with other people around — risk of being seen or overheard",
        "a moment of genuine crisis or stress — something has gone wrong",
        "a lighthearted or absurd situation — funny, silly, unexpected",
        "a quiet intimate moment — not necessarily sexual, just close and personal",
        "a first — the first time in a new place together, or doing something new together",
        "a power shift — one of you is in a position of authority or vulnerability",
        "a reunion — they haven't seen each other in a while",
        "a taboo or risky situation given the relationship or setting",
        "a moment of jealousy or rivalry",
        "something completely unexpected interrupts a normal situation",
        "a quiet moment of domesticity — making tea, sitting in silence, reading nearby",
        "one of them is clearly upset or withdrawn and not saying why",
        "a celebration or good news — someone is happy about something",
        "physical proximity forced by circumstance — cramped space, sharing something, stuck together",
        "a moment caught off guard — one walks in on the other unexpectedly",
      ],
      nsfwCategories: [
        "a classic 'stuck' scenario with obvious sexual tension — e.g. helping with something awkward, getting stuck somewhere, needing assistance in a compromising position",
        "an innocent request that escalates — e.g. help trying on clothes/lingerie, applying sunscreen, a massage that wasn't meant to go anywhere",
        "caught in a state of undress — someone walks in at the wrong (or right) moment",
        "a dare, bet, or game that escalates beyond what either expected",
        "one of them makes an unmistakably bold move out of nowhere — direct and confident, no buildup",
        "forbidden proximity — sneaking around, hiding together, pretending nothing is happening while very close",
        "a role reversal where one is clearly in charge and uses it",
        "something domestic turns charged — cooking together, sharing a shower, getting changed nearby",
      ],
      // Added only for an NSFW character.
      nsfwLine: "\n- For sexually charged scenarios be bold and explicit about the situation — don't sanitise it",
      // Added only when re-rolling, listing what has already been shown.
      excludeTemplate: "\n- NEVER use any of these scenarios that have already been shown: {exclude}. Use completely different situations.",
      instruction: "[seed:{seed}] Generate {count} opening scenarios for an in-person encounter with {name}. Each scenario must match its assigned category exactly — do not substitute or blend categories.\n\n{categoryList}\n\nRules:\n- Write the opening message in FIRST PERSON — use \"I\", never \"she\", \"he\", or the character's name in third person\n- The two of you are physically together — never reference texting, messaging, screens, or anything virtual\n- Each opening must feel genuinely distinct in tone and energy from the others\n- Include physical actions and expressions in asterisks woven naturally into the message, in first person (e.g. *I glance up* not *she glances up*)\n- Write ONLY your own character's actions and words. Never write what the other person does, says or feels — an opening that has them already sitting down, answering or reacting has decided their move for them\n- Vary locations, times of day, and energy levels\n- 1-3 sentences per opening message{nsfwLine}{excludeClause}\n\nReturn ONLY valid JSON, an array of exactly {count} objects:\n[{\"label\": \"short 2-4 word scenario name\", \"setting\": \"one sentence describing the scene/context\", \"message\": \"the in-character opening\"}]\n\nNo extra text, no markdown, just the JSON array.",
    },

    // ── Option lists ─────────────────────────────────────────────────────────
    options: {
      genders: ["Female", "Male", "Non-binary", "Custom"],
      maritalStatuses: ["Single", "In a relationship", "Engaged", "Married", "Divorced", "Widowed", "It's complicated"],
      hairColours: ["Black", "Dark brown", "Brown", "Auburn", "Dirty blonde", "Blonde", "Platinum blonde", "Red", "Strawberry blonde", "Grey", "White", "Coloured", "Custom"],
      eyeColours: ["Brown", "Dark brown", "Hazel", "Green", "Blue", "Grey", "Amber", "Custom"],
      skinTones: ["Fair", "Light", "Medium", "Olive", "Tan", "Brown", "Dark brown", "Ebony", "Custom"],
    },
  };

  // ── Merge / IO ─────────────────────────────────────────────────────────────
  const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

  // Overrides replace arrays wholesale (a tier list edited in settings.html is
  // the whole list, not a patch) and merge objects key by key, so a config
  // saved before a new default was added still picks that default up.
  function deepMerge(base, override) {
    if (!isPlainObject(base) || !isPlainObject(override)) {
      return override === undefined ? base : override;
    }
    const out = Array.isArray(base) ? base.slice() : { ...base };
    for (const key of Object.keys(override)) {
      out[key] = isPlainObject(base[key]) && isPlainObject(override[key])
        ? deepMerge(base[key], override[key])
        : override[key];
    }
    return out;
  }

  const clone = (v) => JSON.parse(JSON.stringify(v));

  async function call(action, payload) {
    const res = await fetch(DATA_PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, token: ACCESS_TOKEN, ...(payload || {}) }),
    });
    if (!res.ok) throw new Error(`Data proxy error: ${res.status} ${await res.text().catch(() => "")}`);
    const body = await res.json();
    if (body && body.error) throw new Error(body.error);
    return body;
  }

  // Loads the stored override object (not the merged config). Falls back to the
  // generic chat store for deployments whose data-proxy predates the
  // site_config actions, so the client works either side of a backend deploy.
  async function loadOverrides() {
    try {
      const body = await call("get_site_config");
      return isPlainObject(body.config) ? body.config : {};
    } catch (e) {
      if (!/Unknown action/i.test(e.message)) throw e;
    }
    const body = await call("get_chat", { characterId: CONFIG_ROW_ID });
    return isPlainObject(body.messages) ? body.messages : {};
  }

  async function saveOverrides(config) {
    try {
      await call("save_site_config", { config });
      return;
    } catch (e) {
      if (!/Unknown action/i.test(e.message)) throw e;
    }
    await call("save_chat", { characterId: CONFIG_ROW_ID, messages: config });
  }

  // Single entry point for every AI proxy call. Every caller used to read
  // `data.choices[0].message.content` straight off the response, so a proxy
  // error surfaced as a TypeError about `undefined` instead of the actual
  // problem — and in the silent-catch callers, as nothing at all.
  //
  // Lives here rather than in index.html because wardrobe.html needs the same
  // call and the same handling of its failures; index.html keeps a wrapper of
  // the same name that delegates to this, so its fifteen callers are unchanged.
  async function aiComplete({ model, messages, params }) {
    let res;
    try {
      res = await fetch(AI_PROXY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // params are merged into the OpenRouter body — the proxy forwards it
        // verbatim. Only the conversation passes any: the tracker calls want
        // plain, repeatable JSON, and penalties would work against that.
        body: JSON.stringify({ model, messages, ...(params || {}) }),
      });
    } catch (e) {
      throw new Error(`AI proxy unreachable: ${e.message}`);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`AI proxy error ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
    }

    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error("AI proxy returned a non-JSON response");
    }

    if (data && data.error) {
      const msg = typeof data.error === "string" ? data.error : (data.error.message || JSON.stringify(data.error));
      throw new Error(`AI proxy error: ${String(msg).slice(0, 200)}`);
    }

    const content = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : undefined;
    if (typeof content !== "string") throw new Error("AI proxy returned no completion");
    return content;
  }

  // The same call, streamed. Calls onDelta with each fragment as it arrives and
  // resolves with the whole reply, so a caller that ignores onDelta behaves
  // exactly like aiComplete.
  //
  // Falls back to aiComplete whenever streaming cannot be had — an ai-proxy
  // that predates the passthrough, a response that is not an event stream, a
  // browser without a readable body. The fallback only fires when nothing has
  // been emitted yet; once fragments are on screen, re-running the request
  // would write a second, different reply over the one being read.
  async function aiStreamComplete({ model, messages, params, onDelta }) {
    let res;
    try {
      res = await fetch(AI_PROXY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, ...(params || {}), stream: true }),
      });
    } catch (e) {
      throw new Error(`AI proxy unreachable: ${e.message}`);
    }

    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    if (!res.ok || !res.body || !contentType.includes("text/event-stream")) {
      return aiComplete({ model, messages, params });
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    let sawAnyEvent = false;

    const consume = (payload) => {
      if (payload === "[DONE]") return;
      let parsed;
      try { parsed = JSON.parse(payload); } catch { return; }
      sawAnyEvent = true;
      if (parsed && parsed.error) {
        const msg = typeof parsed.error === "string" ? parsed.error : (parsed.error.message || "stream error");
        throw new Error(`AI proxy error: ${String(msg).slice(0, 200)}`);
      }
      const choice = parsed && parsed.choices && parsed.choices[0];
      // delta on a stream, message on the single object some providers send
      // as a final frame.
      const piece = (choice && choice.delta && choice.delta.content)
        || (choice && choice.message && choice.message.content)
        || "";
      if (!piece) return;
      full += piece;
      if (typeof onDelta === "function") onDelta(piece, full);
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Events are separated by a blank line, but a fragment can end
        // mid-event, so only whole lines are consumed and the tail is kept.
        let nl;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl).replace(/\r$/, "").trim();
          buffer = buffer.slice(nl + 1);
          // ": OPENROUTER PROCESSING" and friends are keep-alive comments.
          if (!line || line.startsWith(":")) continue;
          if (line.startsWith("data:")) consume(line.slice(5).trim());
        }
      }
    } catch (e) {
      if (full) throw e;
      try { reader.cancel(); } catch {}
      return aiComplete({ model, messages, params });
    }

    if (!full) {
      // An empty stream is not an empty reply — something went wrong quietly.
      if (!sawAnyEvent) return aiComplete({ model, messages, params });
      throw new Error("AI proxy returned no completion");
    }
    return full;
  }

  // Strips markdown fences and parses. Returns null instead of throwing —
  // callers decide whether a malformed reply is worth surfacing.
  function parseJsonReply(raw) {
    const clean = String(raw).replace(/```json/gi, "").replace(/```/g, "").trim();
    try { return JSON.parse(clean); } catch {}
    const match = clean.match(/[\{\[][\s\S]*[\}\]]/);
    if (match) { try { return JSON.parse(match[0]); } catch {} }
    return null;
  }

  // Merged config, ready to read. Never throws: a proxy that is down or a
  // malformed override must not take the whole app with it, so the built-in
  // defaults stand in and the caller is told what went wrong.
  async function loadConfig() {
    try {
      const overrides = await loadOverrides();
      return { config: deepMerge(clone(DEFAULTS), overrides), overrides, error: null };
    } catch (e) {
      return { config: clone(DEFAULTS), overrides: {}, error: e.message };
    }
  }

  // Picks the first tier whose `max` the value falls at or below. Tiers are
  // ascending and the last is 100, so the fallback only fires on an empty list.
  function tierFor(tiers, value) {
    if (!Array.isArray(tiers) || tiers.length === 0) return null;
    const v = Number.isFinite(value) ? value : 0;
    return tiers.find(t => v <= t.max) || tiers[tiers.length - 1];
  }

  // What cut a garment is, for a library where most garments predate the
  // field. An unset one is whatever wardrobe.defaultGender says, which is
  // Unisex — so an untagged library keeps being offered to everybody exactly
  // as it was before the field existed.
  function garmentGender(garment, cfg) {
    const w = ((cfg || DEFAULTS).wardrobe) || {};
    const list = w.genders || [];
    const g = garment && garment.gender;
    const dflt = w.defaultGender || list[0] || "";
    if (list.includes(g) && g !== dflt) return g;
    return garmentCutHint(garment, cfg) || dflt;
  }

  // What wardrobe.cutHints makes of a garment whose cut was never really
  // decided — "" when nothing matches, which is most garments and is the right
  // answer for them. Name and tags only; see the note on cutHints above.
  function garmentCutHint(garment, cfg) {
    const conf = cfg || DEFAULTS;
    const w = conf.wardrobe || {};
    const hints = w.cutHints || [];
    if (!garment || !hints.length) return "";
    const hay = [garment.name || "", (garment.tags || []).join(" ")].join(" ").toLowerCase();
    if (!hay.trim()) return "";
    const cat = garment.category || "";
    for (const h of hints) {
      if (!h || !h.match || !(w.genders || []).includes(h.cut)) continue;
      if (Array.isArray(h.categories) && h.categories.length && !h.categories.includes(cat)) continue;
      let re;
      try { re = new RegExp(h.match, "i"); } catch { continue; }
      if (re.test(hay)) return h.cut;
    }
    return "";
  }

  // Whether a garment should be offered to someone of this gender.
  //
  // Unisex always passes, and so does an unknown or unset subject gender: the
  // question this answers is "is there a reason NOT to offer this", and with
  // nothing known about who is wearing it there is no reason. A filter that
  // fails closed on missing data hides the whole wardrobe from a character
  // whose gender was never filled in, which is worse than showing too much.
  //
  // The mapping is deliberately blunt. Anything that is not plainly the men's
  // or the women's rail — a custom gender, non-binary, blank — sees
  // everything, because there is no third rail for it to see instead.
  function garmentFitsGender(garment, subjectGender, cfg) {
    const conf = cfg || DEFAULTS;
    const w = conf.wardrobe || {};
    const cut = garmentGender(garment, conf);
    if (cut === (w.defaultGender || "Unisex")) return true;
    const want = (w.genderBySubject || {})[String(subjectGender || "").trim()];
    if (!want) return true;
    return cut === want;
  }

  // ── Generations that outlive the page that asked for them ──────────────────
  //
  // Wiro does the work on its own servers and bills for it whether or not
  // anyone collects the result. The proxy used to wait and hand the image back,
  // but its wall-clock limit meant a slow generation came back 504 while Wiro
  // finished anyway, so the waiting moved into the browser — and that made the
  // browser the only thing holding the task id. A phone locking freezes the
  // page's timers mid-poll and may discard the page outright, which is why
  // "start an image and put the phone down" lost pictures.
  //
  // So the id is written to storage before the first poll, and any later visit
  // to either page can collect what Wiro finished in the meantime. This lives
  // here rather than in index.html because wardrobe.html generates images too,
  // and a garment left running should be collectable from whichever page is
  // opened next — which only works if both pages read the same list and
  // understand every kind of entry in it.
  const PENDING_IMAGES_KEY = "personachat_pending_images";
  // Where a recovered picture goes when it belongs to nothing yet: a character
  // that was still being created has no gallery to file into.
  const RECOVERED_TRAY_KEY = "personachat_recovered_images";
  // A task Wiro has forgotten is not worth asking about forever, and a stale
  // entry means every later visit spends two polls learning nothing.
  const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  const PENDING_LIMIT = 20;
  const TRAY_LIMIT = 12;
  const DEFAULT_GALLERY_LIMIT = 200;

  // localStorage throws rather than returning null in a locked-down browser,
  // and a generation must not fail because of where its receipt is kept.
  function readStore(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) ? parsed : fallback;
    } catch { return fallback; }
  }
  function writeStore(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function pendingImages() {
    return readStore(PENDING_IMAGES_KEY, [])
      .filter(p => p && p.taskId && (Date.now() - (p.startedAt || 0)) < PENDING_MAX_AGE_MS);
  }
  function recordPendingImage(entry) {
    writeStore(PENDING_IMAGES_KEY,
      [entry, ...pendingImages().filter(p => p.taskId !== entry.taskId)].slice(0, PENDING_LIMIT));
  }
  function dropPendingImage(taskId) {
    writeStore(PENDING_IMAGES_KEY, pendingImages().filter(p => p.taskId !== taskId));
  }

  function recoveredImages() { return readStore(RECOVERED_TRAY_KEY, []); }
  function addRecoveredImage(entry) {
    writeStore(RECOVERED_TRAY_KEY, [entry, ...recoveredImages()].slice(0, TRAY_LIMIT));
  }
  function dropRecoveredImage(id) {
    writeStore(RECOVERED_TRAY_KEY, recoveredImages().filter(e => e.id !== id));
  }
  function clearRecoveredImages() { writeStore(RECOVERED_TRAY_KEY, []); }

  // Tasks this tab is already waiting on. The recovery sweep reads the same
  // list from storage, so without this it would poll a generation a screen is
  // still waiting for, collect it first, and file a second copy while the
  // screen that asked also receives one.
  const activeImageTasks = new Set();
  function claimImageTask(taskId) {
    if (activeImageTasks.has(taskId)) return false;
    activeImageTasks.add(taskId);
    return true;
  }
  function releaseImageTask(taskId) { activeImageTasks.delete(taskId); }

  // Poll quickly at first — a fast generation should not wait on a slow
  // schedule — then ease off: past a dozen polls this is a slow one, and a
  // check every two seconds is traffic against a rate limit shared with the
  // generations themselves.
  const POLL_SCHEDULE_MS = [900, 900, 1200, 1500, 2000, 2000, 2000, 2000, 2500, 2500, 3000, 3000, 4000];
  // Where a poll goes when Wiro says it is rate limiting us, unless it sends a
  // Retry-After of its own. Backing off is the only useful response: polling
  // harder cannot make the image arrive sooner, and it is what caused this.
  const THROTTLE_BACKOFF_MS = [4000, 8000, 12000, 20000];
  const MAX_POLLS = 160;
  const MAX_TRANSIENT_POLL_FAILURES = 8;

  // setTimeout, but a backgrounded tab that comes back does not have to wait
  // out the rest of a timer the browser froze. Returning to the app polls at
  // once.
  function sleepUnlessVisible(ms) {
    return new Promise(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        document.removeEventListener("visibilitychange", onVisible);
        resolve();
      };
      const onVisible = () => { if (!document.hidden) finish(); };
      const timer = setTimeout(finish, ms);
      document.addEventListener("visibilitychange", onVisible);
    });
  }

  // Asks the proxy whether a task has finished. Returns the image URL, or null
  // if it is still running after `maxPolls` asks.
  //
  // A failure to get an answer is transient by definition: polling is a read,
  // the task runs on Wiro either way, and giving up throws away an image that
  // is generated and billed regardless. Only a 4xx is fatal — that is this
  // client asking for something wrong, and asking again will not fix it.
  async function pollImageTask({ taskId, outputFormat, modelId, startedAt, maxPolls = MAX_POLLS, onTiming }) {
    let throttled = 0;
    let nextWaitMs = null;
    let transientFailures = 0;
    for (let attempt = 0; attempt < maxPolls; attempt++) {
      await sleepUnlessVisible(nextWaitMs ?? POLL_SCHEDULE_MS[Math.min(attempt, POLL_SCHEDULE_MS.length - 1)]);
      nextWaitMs = null;
      let statusRes;
      try {
        statusRes = await fetch(IMAGE_PROXY_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "status", taskId, outputFormat }),
        });
      } catch {
        transientFailures++;
        if (transientFailures > MAX_TRANSIENT_POLL_FAILURES) {
          throw new Error(`Wiro error: lost contact with the image proxy. Task ${taskId} may still finish.`);
        }
        continue;
      }
      if (statusRes.status === 202) {
        // Still generating — but read the body, because it also says whether
        // Wiro is rate limiting us. Throttled polls are not progress: they are
        // this client competing with its own generations for the project's
        // request budget, and the answer is to ask less often.
        const pending = await statusRes.json().catch(() => null);
        if (pending && pending.throttled) {
          nextWaitMs = (pending.retryAfterSeconds > 0)
            ? pending.retryAfterSeconds * 1000
            : THROTTLE_BACKOFF_MS[Math.min(throttled, THROTTLE_BACKOFF_MS.length - 1)];
          throttled++;
        }
        continue;
      }
      if (statusRes.status >= 500 || statusRes.status === 429) {
        transientFailures++;
        if (transientFailures > MAX_TRANSIENT_POLL_FAILURES) {
          throw new Error(`Wiro error: the image proxy kept failing (${statusRes.status}). Task ${taskId} may still finish.`);
        }
        nextWaitMs = THROTTLE_BACKOFF_MS[Math.min(transientFailures - 1, THROTTLE_BACKOFF_MS.length - 1)];
        continue;
      }
      if (!statusRes.ok) {
        const err = await statusRes.text().catch(() => "");
        throw new Error(`Wiro error: ${statusRes.status} ${err}`);
      }
      transientFailures = 0;
      const done = await statusRes.json();
      if (onTiming) {
        const t = (done && done.timing) || {};
        onTiming({
          at: Date.now(),
          model: modelId,
          total: Number(((Date.now() - (startedAt || Date.now())) / 1000).toFixed(1)),
          queued: t.queuedSeconds ?? null,
          generating: t.generatingSeconds ?? null,
          postprocess: t.postprocessSeconds ?? null,
          throttled,
        });
      }
      return (done && done.imageUrl) || null;
    }
    return null;
  }

  // Copy to Supabase Storage — Wiro's CDN is not somewhere to keep a gallery.
  // The upload function fetches the URL itself, so the bytes never touch the
  // browser. Falls back to the original URL, which at least still renders.
  async function persistGeneratedImage(imageUrl) {
    try {
      const res = await fetch(UPLOAD_IMAGE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceUrl: imageUrl,
          token: ACCESS_TOKEN,
          filename: `img_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        }),
      });
      if (res.ok) {
        const { url } = await res.json();
        if (url) return url;
      }
    } catch {}
    return imageUrl;
  }

  // Where a recovered picture goes. `dest` is recorded when the generation is
  // submitted, because by the time it is collected the screen that knew is
  // gone. Entries written before dest existed carried a bare characterId, and
  // still mean the gallery.
  async function fileRecoveredImage(entry, url, opts) {
    const dest = entry.dest || (entry.characterId ? { kind: "gallery", characterId: entry.characterId } : { kind: "tray" });
    const label = entry.label || dest.label || "Recovered generation";
    if (dest.kind === "gallery" && dest.characterId) {
      const limit = (opts && opts.galleryLimit) || DEFAULT_GALLERY_LIMIT;
      const body = await call("get_gallery", { characterId: dest.characterId });
      const gallery = Array.isArray(body.gallery) ? body.gallery : [];
      const next = [{ url, prompt: label, date: Date.now() }, ...gallery].slice(0, limit);
      await call("save_gallery", { characterId: dest.characterId, gallery: next });
      return { kind: "gallery", characterId: dest.characterId };
    }
    if (dest.kind === "wardrobe" && dest.garmentId) {
      // Read-modify-write of the one row the whole library lives in. Read
      // fresh rather than trusting whatever this page loaded minutes ago:
      // between then and now the picture may not be the only thing that
      // changed about the wardrobe.
      const body = await call("get_chat", { characterId: WARDROBE_ROW_ID });
      const items = Array.isArray(body.messages) ? body.messages : [];
      const idx = items.findIndex(g => g && g.id === dest.garmentId);
      // A garment deleted while its picture was generating has nowhere to put
      // it, so the tray keeps it rather than dropping it on the floor.
      if (idx < 0) { addRecoveredImage({ id: String(Date.now()) + Math.random().toString(36).slice(2), url, label, date: Date.now() }); return { kind: "tray" }; }
      // Only fills a gap. A picture chosen while this one was still generating
      // is the more recent decision, and silently replacing it would undo a
      // choice that was made after the one being collected.
      if (items[idx].image) { addRecoveredImage({ id: String(Date.now()) + Math.random().toString(36).slice(2), url, label, date: Date.now() }); return { kind: "tray" }; }
      items[idx] = { ...items[idx], image: url };
      await call("save_chat", { characterId: WARDROBE_ROW_ID, messages: items });
      return { kind: "wardrobe", garmentId: dest.garmentId, name: items[idx].name || "" };
    }
    addRecoveredImage({ id: String(Date.now()) + Math.random().toString(36).slice(2), url, label, date: Date.now() });
    return { kind: "tray" };
  }

  // One recovered generation, or false if it is still running.
  async function collectOnePendingImage(entry, onCollected, opts) {
    // A short patience: this is a check for something already finished, not a
    // wait for something still running.
    let imageUrl = null;
    try {
      imageUrl = await pollImageTask({ ...entry, maxPolls: 2 });
    } catch {
      dropPendingImage(entry.taskId); // Wiro no longer knows about it
      return false;
    }
    if (!imageUrl) return false; // still going — leave it for next time
    dropPendingImage(entry.taskId);
    try {
      const url = await persistGeneratedImage(imageUrl);
      const filedTo = await fileRecoveredImage(entry, url, opts);
      if (onCollected) onCollected({ ...entry, url, filedTo });
      return true;
    } catch (e) {
      console.warn("Could not file a recovered image:", e);
      return false;
    }
  }

  // Collect anything Wiro finished while nobody was looking. Called on open,
  // on returning to the tab, and on a slow timer while it is in front.
  async function collectPendingImages(opts) {
    const options = opts || {};
    let collected = 0;
    for (const entry of pendingImages()) {
      if (!claimImageTask(entry.taskId)) continue;
      try {
        if (await collectOnePendingImage(entry, options.onCollected, options)) collected += 1;
      } finally {
        releaseImageTask(entry.taskId);
      }
    }
    return collected;
  }

  // Wires the sweep to the events that mean "someone might be looking now".
  // Returns a stop function. Framework-free so wardrobe.html can use it too.
  function startImageTaskSweeps(opts) {
    const options = opts || {};
    const everyMs = options.everyMs || 20000;
    let sweeping = false;
    let stopped = false;
    const sweep = async () => {
      // Hidden means nobody is looking and the browser may be freezing us
      // mid-poll; the visibility handler picks it up on the way back.
      if (stopped || sweeping || document.hidden || !pendingImages().length) return;
      sweeping = true;
      try { await collectPendingImages(options); }
      catch (e) { console.warn("Could not check for finished images:", e); }
      finally { sweeping = false; }
    };
    sweep();
    const timer = setInterval(sweep, everyMs);
    const onVisible = () => { if (!document.hidden) sweep(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }

  // ── Balancing a stocked closet ────────────────────────────────────────────
  // What comes back from the model is a list it liked, not a wardrobe: asked
  // for twenty garments it has answered with six pairs of shoes, no underwear,
  // and tops with nothing to wear under or below them. Asking more firmly
  // helps and does not fix it, because the failure is arithmetic rather than
  // taste — so the arithmetic is done here, afterwards, against
  // wardrobe.closet.quotas.
  //
  // Its choices are kept wherever they fit: this only trims a category that
  // ran away with the answer and fills one it forgot, both out of the same
  // library the model was choosing from. A category the library cannot supply
  // stays empty rather than being filled with something wrong — which is also
  // what keeps dresses off a man, since the cut filter has already emptied
  // that rail before this runs.
  //
  // Sets move as one. A garment sharing a `set` name with others is half an
  // outfit on its own, so everything here adds and removes whole sets.
  //
  // Framework-free and pure, so both the app and a test can call it:
  //   balanceCloset(ids, library, CFG.wardrobe.closet) -> ids
  function balanceCloset(pickedIds, library, closetCfg) {
    const cfg = closetCfg || {};
    const quotas = cfg.quotas || {};
    const lib = (library || []).filter(g => g && g.id);
    if (!lib.length) return [];
    const byId = new Map(lib.map(g => [g.id, g]));
    const catOf = (id) => (byId.get(id) || {}).category || "";

    // A unit is one garment, or one whole set.
    const unitKeyOf = (g) => (g.set ? "set:" + String(g.set).trim().toLowerCase() : "id:" + g.id);
    const units = new Map();
    lib.forEach(g => {
      const k = unitKeyOf(g);
      if (!units.has(k)) units.set(k, []);
      units.get(k).push(g);
    });

    const chosen = new Set();
    const order = [];                       // unit keys, in the order taken
    const take = (k) => {
      if (!units.has(k) || order.includes(k)) return;
      order.push(k);
      units.get(k).forEach(g => chosen.add(g.id));
    };
    const drop = (k) => {
      const i = order.indexOf(k);
      if (i >= 0) order.splice(i, 1);
      (units.get(k) || []).forEach(g => chosen.delete(g.id));
    };
    const count = (cat) => {
      let n = 0;
      chosen.forEach(id => { if (catOf(id) === cat) n++; });
      return n;
    };
    const unitCats = (k) => (units.get(k) || []).map(g => g.category || "");
    const minOf = (cat) => Number((quotas[cat] || {}).min) || 0;
    const maxOf = (cat) => {
      const m = (quotas[cat] || {}).max;
      return Number.isFinite(Number(m)) ? Number(m) : Infinity;
    };

    // Whatever the model chose, in its order, as the starting point.
    (pickedIds || []).forEach(id => {
      const g = byId.get(id);
      if (g) take(unitKeyOf(g));
    });

    // 1. Trim the runaway categories. The last thing taken goes first: the
    //    model's earlier picks are the ones it thought about.
    Object.keys(quotas).forEach(cat => {
      let guard = lib.length + 8;
      while (count(cat) > maxOf(cat) && guard-- > 0) {
        const k = [...order].reverse().find(key => unitCats(key).includes(cat));
        if (!k) break;
        drop(k);
      }
    });

    // Candidate units for a category, freshly shuffled so a restock is not the
    // same answer every time, and whole outfits last — a set drags its other
    // pieces in with it, so it is the expensive way to fill one gap.
    const candidatesFor = (cat) => {
      const seen = new Set();
      const out = [];
      lib.forEach(g => {
        if ((g.category || "") !== cat) return;
        const k = unitKeyOf(g);
        if (seen.has(k) || order.includes(k)) return;
        seen.add(k);
        out.push(k);
      });
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out.sort((a, b) => units.get(a).length - units.get(b).length);
    };

    // Would taking this unit push some OTHER category past its ceiling?
    const overflows = (k) => unitCats(k).some(c => c && count(c) + 1 > maxOf(c));

    // 2. Fill what it forgot, up to each category's floor.
    Object.keys(quotas).forEach(cat => {
      const need = minOf(cat);
      if (!need) return;
      const pool = candidatesFor(cat);
      while (count(cat) < need && pool.length) {
        const k = pool.shift();
        // A set that would break another ceiling is skipped while there is
        // anything else; a floor is worth more than a ceiling, so the last
        // resort takes it anyway.
        if (overflows(k) && pool.length) { pool.push(k); continue; }
        take(k);
      }
    });

    const total = () => chosen.size;
    const hardMax = Number(cfg.maxCount) || Infinity;
    const target = Math.min(Number(cfg.targetCount) || 0, hardMax);

    // 3. Top up towards the target, spreading across whatever still has room,
    //    widest headroom first so it does not all land on one rail.
    if (target > total()) {
      let guard = lib.length + 8;
      while (total() < target && guard-- > 0) {
        const cat = Object.keys(quotas)
          .filter(c => count(c) < maxOf(c) && candidatesFor(c).length)
          .sort((a, b) => (maxOf(b) - count(b)) - (maxOf(a) - count(a)))[0];
        if (!cat) break;
        const pool = candidatesFor(cat);
        const k = pool.find(key => !overflows(key)) || pool[0];
        if (!k) break;
        take(k);
      }
    }

    // 4. And trim back down if it is over, taking only from categories that
    //    are above their floor — the floors are the point of all of this.
    let guard = lib.length + 8;
    while (total() > Math.max(target, 0) && total() > 0 && guard-- > 0) {
      const k = [...order].reverse().find(key =>
        unitCats(key).every(c => !c || count(c) > minOf(c)));
      if (!k) break;
      drop(k);
    }

    // Library order, so a closet reads the same way the wardrobe does.
    return lib.filter(g => chosen.has(g.id)).map(g => g.id).slice(0, hardMax);
  }

  // Which floors the library simply could not meet. balanceCloset fills what it
  // can and stays quiet about the rest, which is right — a closet is not
  // improved by putting the wrong thing in it — but quiet is how you end up
  // wondering why a man owns no underwear for a month. The answer is usually
  // that the wardrobe has none cut for him, and that is worth saying out loud.
  //
  // Returns category names, for the caller to fold into whatever it already
  // reports as missing.
  function closetShortfall(ids, library, closetCfg) {
    const cfg = closetCfg || {};
    const quotas = cfg.quotas || {};
    const chosen = new Set(ids || []);
    const have = {};
    (library || []).forEach(g => {
      if (g && chosen.has(g.id)) have[g.category || ""] = (have[g.category || ""] || 0) + 1;
    });
    return Object.keys(quotas).filter(cat => {
      const q = quotas[cat] || {};
      const min = Number(q.min) || 0;
      return q.essential && min > 0 && (have[cat] || 0) < min;
    });
  }

  function fillTemplate(template, values) {
    return String(template == null ? "" : template)
      .replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match));
  }

  global.SiteConfig = {
    DEFAULTS,
    CONFIG_ROW_ID,
    WARDROBE_ROW_ID,
    ACCESS_TOKEN,
    IMAGE_PROXY_URL,
    UPLOAD_IMAGE_URL,
    AI_PROXY_URL,
    call,
    aiComplete,
    aiStreamComplete,
    // Recoverable image generation — see the block above.
    pendingImages,
    recordPendingImage,
    dropPendingImage,
    claimImageTask,
    releaseImageTask,
    pollImageTask,
    persistGeneratedImage,
    collectPendingImages,
    startImageTaskSweeps,
    recoveredImages,
    dropRecoveredImage,
    clearRecoveredImages,
    parseJsonReply,
    clone,
    deepMerge,
    loadConfig,
    loadOverrides,
    saveOverrides,
    tierFor,
    fillTemplate,
    garmentGender,
    garmentCutHint,
    garmentFitsGender,
    balanceCloset,
    closetShortfall,
  };
})(window);
