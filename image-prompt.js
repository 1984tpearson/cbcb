// PersonaChat — IMAGE PROMPT ASSEMBLY
// Framework-free, like site-config.js, so both the app and prompt-lab.html can
// load it as a plain script. Everything here is pure: state in, prompt string
// out, no React, no network, no DOM.
//
// It lives outside index.html because the whole file used to be inline in the
// app source, which meant the only way to see what a change did to a prompt
// was to play the game and generate an image. Every prompt regression this
// project has had came from tuning blind that way. Now prompt-lab.html loads
// this same code and shows the finished prompt for any scene state instantly,
// so a change can be diffed across cases before it costs a generation.
//
// create(CFG) rather than top-level consts: the config is fetched at runtime,
// so nothing here can read CFG until the caller hands it over.
window.ImagePrompt = {
  create(CFG) {
    const { tierFor, fillTemplate } = window.SiteConfig;

    const ACTION_TEXT_RE = /\*{1,2}([^*]+)\*{1,2}/g;
    function extractActionText(messages, characterName) {
      return messages.filter(m => m.role !== "image").slice(-4).map(m => {
        const who = m.role === "user" ? "User" : characterName;
        const beats = [...String(m.content || "").matchAll(ACTION_TEXT_RE)]
          .map(match => match[1].trim()).filter(Boolean);
        return beats.length ? `${who}: ${beats.join(" / ")}` : "";
      }).filter(Boolean).join("\n");
    }

    const EMPTY_STAGING = { location: null, charPose: null, userPose: null, proximity: null };
    const STAGING_KEYS = ["location", "charPose", "userPose", "proximity"];
    function hasStaging(staging) {
      return !!staging && STAGING_KEYS.some(k => staging[k]);
    }
    // Phrases for the image prompt, ordered the way the shot reads: where we are,
    // what the camera (the user) is doing, how far away she is, what she is doing.
    function buildStagingImageDesc(staging) {
      if (!hasStaging(staging)) return "";
      const parts = [];
      if (staging.location) parts.push(staging.location);
      // userPose used to be emitted as "camera positioned as someone standing",
      // which describes the camera as an object placed in the scene and fights
      // the POV clause saying it is the viewer's own eyes — one model drew the
      // camera held out to the side. The pose is already implied by where the
      // viewer's body enters the frame.
      if (staging.proximity) parts.push(staging.proximity);
      // The pose goes in bare — SD reads "sitting on the edge of the bed" as a
      // pose directive, while a "she is ..." sentence just adds noise tokens.
      if (staging.charPose) parts.push(staging.charPose);
      return parts.filter(Boolean).join(", ");
    }

    // Images generated during a chat are shot from the user's own eyes - the user
    // is the camera. Their own hands, arms and legs still belong in frame when they
    // are touching or reaching for something, the way they do in a first-person
    // game; what never appears is their face, head or back, since the camera
    // cannot see itself. Deliberately not applied on the character creation
    // screen, where a third-person reference portrait is wanted.
    const POV_BASE = CFG.image.povBase;
    // Which of the viewer's own body parts belong in frame depends on what they
    // are doing, so the clause is assembled per image rather than fixed. Asking
    // for them unconditionally puts disembodied limbs in every shot, including
    // ones where the user is just standing and watching.
    //
    // Arms come from the scene text, since reaching and touching is what the
    // action beats describe. Legs and torso come from the *user's own pose*
    // instead: limb words in the scene text are ambiguous about whose limb it is
    // ("her legs crossed" must not put the viewer's legs in the foreground),
    // while the staging tracker knows who is sitting or lying down.
    // Matching bare limb words does not work: "her hands clasped in front of her"
    // describes HER hands, and matching a contact verb catches her actions too
    // ("holding a glass of wine"). Both were putting the viewer's arms into shots
    // where the user was touching nothing, reaching in from the sides of frame.
    // Ownership has to be explicit, so the scene extractor is instructed to write
    // the user's own limbs as "viewer's hand" / "viewer's arm", and only that
    // counts. The custom prompt box is hand-written, where "my hand" is natural.
    const POV_VIEWER_LIMB_RE = /\b(?:viewer|user)(?:'|\u2019)?s?\s+(?:own\s+)?(?:hand|hands|arm|arms|forearm|forearms|finger|fingers|palm|palms|wrist|wrists)\b/i;
    const POV_CUSTOM_LIMB_RE = /\b(?:my|your|our)\s+(?:own\s+)?(?:hand|hands|arm|arms|forearm|forearms|finger|fingers|palm|palms)\b/i;
    const POV_ARMS_MODIFIER = CFG.image.povArmsModifier;
    // Seedream leans toward putting hands into a POV frame whether or not anything
    // asked for them, so when the viewer is touching nothing, say so explicitly.
    const POV_NO_LIMBS = CFG.image.povNoLimbs;
    // When the scene already names the limb, claim it rather than adding another:
    // this tells the model whose arms those are and that there is only one pair,
    // instead of introducing a second pair alongside them.
    const POV_ARMS_OWNED_MODIFIER = CFG.image.povArmsOwnedModifier;
    // In an intimate scene the viewer's own body is part of the shot, and framing
    // it out is what makes these images read as wrong — a POV that crops at the
    // wrists during sex is stranger than one that doesn't. Gated on the
    // character's NSFW toggle, same as every other explicit path in the app, so
    // an SFW character never gets this clause regardless of scene wording.
    const POV_INTIMATE_RE = /\b(sex|sexual|fucking|fucks|thrust|thrusting|riding|rides|straddling|straddles|grinding|penetrat\w*|oral|blowjob|going down on|cock|dick|pussy|clit|nipples?|breasts?|tits|cum|climax|orgasm|moaning|naked|nude|undressed|topless|bare[- ]?chested)\b/i;
    // Whether the VIEWER is dressed is decided by the tracked userOutfit, never by
    // the scene text: "naked" and "undressed" in a scene prompt are almost always
    // describing the character, and reading them as the viewer's state stripped
    // the user in shots where they were fully clothed.
    const UNDRESSED_VALUES = ["nothing", "nude", "naked", "undressed", "none", "no clothes", "topless"];
    function isUserUndressed(userOutfit) {
      if (!userOutfit) return false; // unknown is not the same as naked
      return UNDRESSED_VALUES.includes(String(userOutfit).trim().toLowerCase());
    }
    // Says what the viewer's own body looks like from inside the frame. Clothing
    // wins whenever it is known — a POV shot that crops to a bare chest when the
    // user is in a shirt and jeans is the same error as the spare arms.
    function povSelfBody(userOutfit, bare, clothed) {
      if (!userOutfit || isUserUndressed(userOutfit)) return bare;
      return `${clothed}, the viewer wearing ${userOutfit}`;
    }
    const POV_INTIMATE_MODIFIER = CFG.image.povIntimateModifier;
    function isIntimateScene(sceneText, staging, nsfw) {
      const userPose = (staging && staging.userPose) || "";
      return !!nsfw && POV_INTIMATE_RE.test(`${sceneText || ""} ${userPose}`);
    }
    // Whether the two of them are ACTUALLY touching, read from the action beats
    // rather than from the image prompt. Naked, moaning and intimate are states,
    // not contact, and treating them as contact is what kept putting the viewer's
    // body into shots where nobody had laid a hand on anyone. A beat counts only
    // when a contact verb and a reference to the other person appear together, so
    // "I pour myself a drink" does not qualify and "I rest my hand on her knee"
    // does.
    const CONTACT_VERB_RE = /\b(touch\w*|hold\w*|held|grab\w*|grasp\w*|grip\w*|takes?|taking|took|reach\w*|stroke\w*|caress\w*|kiss\w*|hug\w*|embrac\w*|cuddl\w*|pull\w*|push\w*|press\w*|squeez\w*|cup\w*|brush\w*|rest\w*|place[sd]?|placing|slid\w*|slip\w*|lean\w*|straddl\w*|climb\w*|wrap\w*|tug\w*|guid\w*|lift\w*|carr\w*|thrust\w*|rid(?:e|es|ing)|grind\w*|fuck\w*|undress\w*|unbutton\w*|unzip\w*)\b/i;
    // The object has to be the OTHER person. Accepting "my" and "me" made almost
    // every beat count — "I lean back in my chair", "I take a sip of my drink",
    // "I rest my head against the wall" are all a contact verb next to a
    // possessive, and none of them involve touching anybody. So which pronouns
    // qualify depends on who is speaking: the character reaches for "you", the
    // user reaches for "her".
    const CONTACT_TARGET_BY_CHARACTER = /\b(you|your|yours)\b/i;
    const CONTACT_TARGET_BY_USER = /\b(her|hers|him|his|she|he|them|their)\b/i;
    const MUTUAL_RE = /\b(each other|one another|together|our hands|between us)\b/i;
    function beatShowsContact(beat, speakerIsUser, characterName) {
      if (!CONTACT_VERB_RE.test(beat)) return false;
      if (MUTUAL_RE.test(beat)) return true;
      if (speakerIsUser) {
        const namePattern = characterName
          ? new RegExp(`\\b${characterName.split(/\s+/)[0].replace(/[^\w]/g, "")}\\b`, "i")
          : null;
        return CONTACT_TARGET_BY_USER.test(beat) || (!!namePattern && namePattern.test(beat));
      }
      return CONTACT_TARGET_BY_CHARACTER.test(beat);
    }
    // Last line of defence. The scene extractor is a language model told not to
    // mention the viewer's limbs unless they are touching something, and it does
    // not always comply — so when there is no contact, any clause naming the
    // viewer's hands or arms is cut from its output before the prompt is built.
    // A rule the code enforces beats a rule the model is asked to follow.
    const VIEWER_LIMB_CLAUSE_RE = /\b(?:viewer|user|my|your|his|her|the)?\s*(?:own\s+)?(?:hand|hands|arm|arms|forearm|forearms|finger|fingers|palm|palms|wrist|wrists)\b[^,]*\b(?:foreground|frame|camera|reaching|entering|extends?|extending|visible)\b|\b(?:foreground|frame|camera)\b[^,]*\b(?:hand|hands|arm|arms|forearm|fingers)\b/i;
    function stripViewerLimbs(sceneText) {
      if (!sceneText) return sceneText;
      const kept = String(sceneText)
        .split(",")
        .filter(clause => !VIEWER_LIMB_CLAUSE_RE.test(clause))
        .map(c => c.trim())
        .filter(Boolean);
      return kept.join(", ");
    }

    function detectPhysicalContact(messages, characterName) {
      // Only the latest exchange: contact three turns ago is over.
      const beats = extractActionText((messages || []).slice(-2), characterName);
      if (!beats) return false;
      return beats.split("\n").some(line => {
        // extractActionText labels each line with who acted, which is what makes
        // the pronoun test possible at all.
        const speakerIsUser = /^User:/i.test(line);
        return beatShowsContact(line.replace(/^[^:]*:\s*/, ""), speakerIsUser, characterName);
      });
    }

    // contact is the only gate on the viewer's body appearing. Nothing about the
    // scene's wording or the character's state opens it on its own — she can be
    // undressed, or the scene explicit, and the viewer still is not in frame
    // unless an action beat shows the two of them touching.
    // viewerBody comes from the extractor: the viewer's own parts that are in
    // the shot, and the frame edge they enter from. When it is present it
    // replaces the generic clauses entirely — "the viewer's own body framing
    // the bottom of the shot" is what the image model kept resolving into a
    // stray limb, because nothing said which part or where it attached.
    function buildPovModifiers(sceneText, staging, nsfw, userOutfit, contact, viewerBody) {
      const scene = sceneText || "";
      const parts = [POV_BASE];
      if (contact && viewerBody) {
        // viewerBody already says whose the limb is and where it enters, so
        // "the foreground hand and arm belong to the viewer, one pair only"
        // only repeated the ownership and added a second mention of hands and
        // arms. Removing it measurably improved the images.
        parts.push(viewerBody);
        // What the viewer is wearing is decided by the tracked outfit, never
        // by the scene text: "naked" in a scene prompt is almost always
        // describing her, and reading it as the viewer's state stripped the
        // user in shots where they were fully dressed.
        if (userOutfit && !isUserUndressed(userOutfit)) {
          parts.push(`the viewer wearing ${userOutfit}`);
        }
        return parts.filter(Boolean).join(", ");
      }
      if (!contact) {
        // Hand-typed prompts are the one exception: someone who wrote "my hand on
        // her waist" is asking for it explicitly.
        parts.push(POV_CUSTOM_LIMB_RE.test(scene) ? POV_ARMS_MODIFIER : POV_NO_LIMBS);
        return parts.join(", ");
      }
      if (isIntimateScene(scene, staging, nsfw)) {
        parts.push(povSelfBody(
          userOutfit,
          `${POV_INTIMATE_MODIFIER}, bare chest and hips`,
          `${POV_INTIMATE_MODIFIER}, still dressed`,
        ));
      } else {
        parts.push(POV_ARMS_OWNED_MODIFIER);
      }
      return parts.join(", ");
    }

    // The prompt is assembled from sources that each describe the scene in their
    // own words, so the same fact arrived two or three times — the tracked outfit
    // beside the scene's mention of it, the staging location beside the
    // extractor's. Dropping repeated phrases keeps the prompt short enough that
    // the parts that matter still carry weight.
    function joinPromptParts(parts) {
      const seen = new Set();
      const kept = [];
      for (const part of parts) {
        if (!part) continue;
        for (const phrase of String(part).split(",")) {
          const trimmed = phrase.trim();
          if (!trimmed) continue;
          const key = trimmed.toLowerCase().replace(/[^a-z0-9 ]/g, "");
          if (key.length > 3 && seen.has(key)) continue;
          seen.add(key);
          kept.push(trimmed);
        }
      }
      return kept.join(", ");
    }

    const HEIGHT_CM_MIN = CFG.appearance.heightCmMin;
    const HEIGHT_CM_MAX = CFG.appearance.heightCmMax;
    const sliderToCm = (value) => Math.round(HEIGHT_CM_MIN + ((value ?? 50) / 100) * (HEIGHT_CM_MAX - HEIGHT_CM_MIN));
    const cmToSlider = (cm) => Math.min(100, Math.max(0, Math.round(((cm - HEIGHT_CM_MIN) / (HEIGHT_CM_MAX - HEIGHT_CM_MIN)) * 100)));

    function appearancePhrasePreview(key, value) {
      const a = CFG.appearance;
      switch (key) {
        case "height": {
          // Both the measurement and a descriptive phrase: image models read
          // "tall" far more reliably than they read a number, but the number is
          // what the user actually set.
          const tier = tierFor(a.heightTiers, value);
          return `${sliderToCm(value)} cm, ${tier ? tier.phrase : ""}`;
        }
        case "build": {
          const tier = tierFor(a.buildTiers, value);
          return tier ? tier.phrase : "";
        }
        case "chest": {
          const cups = a.chestCups || [];
          if (cups.length === 0) return "";
          const idx = Math.min(cups.length - 1, Math.floor(value / (100 / cups.length)));
          return fillTemplate(a.chestTemplate, { cup: cups[idx] });
        }
        case "waist": {
          const tier = tierFor(a.waistTiers, value);
          return tier ? tier.phrase : "";
        }
        case "hips": {
          const tier = tierFor(a.hipsTiers, value);
          return tier ? tier.phrase : "";
        }
        default:
          return "";
      }
    }

    // The appearance sliders describe hair, eyes, skin and body, but nothing
    // about facial structure, so the face was left entirely to the model's prior
    // — which lands on the same default face almost every time. Randomising the
    // seed alone does not move identity much on Seedream-class models; the face
    // has to actually be described.
    function pickFaceVariation() {
      const all = CFG.appearance.faceVariationPools || [];
      const count = CFG.appearance.faceVariationPoolCount ?? 4;
      const pools = [...all].sort(() => Math.random() - 0.5).slice(0, count);
      return pools.map(pool => pool[Math.floor(Math.random() * pool.length)]).join(", ");
    }

    function buildAppearancePrompt(appearance) {
      if (!appearance) return "";
      const a = appearance;
      const cfg = CFG.appearance;
      const parts = [];

      const hair = a.hairColour === "Custom" ? a.hairColourCustom : a.hairColour;
      const eyes = a.eyeColour === "Custom" ? a.eyeColourCustom : a.eyeColour;
      const skin = a.skinTone === "Custom" ? a.skinToneCustom : a.skinTone;

      const ethnicity = a.ethnicity === "Custom" ? a.ethnicityCustom : a.ethnicity;
      if (ethnicity) parts.push(ethnicity.toLowerCase());
      if (hair) parts.push(`${hair.toLowerCase()} hair`);
      if (eyes) parts.push(`${eyes.toLowerCase()} eyes`);
      if (skin) parts.push(`${skin.toLowerCase()} skin`);

      const h = a.height ?? 50;
      const b = a.build ?? 50;

      // A tier marked skipInPrompt is the unremarkable middle one — saying
      // "average height" adds nothing the model can use, so it is only shown as
      // the slider's own preview text.
      const phraseFor = (tiers, value) => {
        const tier = tierFor(tiers, value);
        return tier && !tier.skipInPrompt ? tier.phrase : null;
      };

      // Height + build combined into one phrase when both land at the extreme
      // low end, instead of stacking two separate "very short" / "very slim"
      // modifiers — that combination is what was pushing generations toward
      // caricature proportions (tiny torso, stretched limbs) rather than a
      // proportionally short, slim figure.
      const heightCm = fillTemplate(cfg.heightMeasurementTemplate, { cm: sliderToCm(h) });
      if (h <= 25 && b <= 20) {
        parts.push(`${heightCm}, ${cfg.combinedShortSlim}`);
      } else {
        parts.push(heightCm);
        const heightPhrase = phraseFor(cfg.heightTiers, h);
        if (heightPhrase) parts.push(heightPhrase);
        const buildPhrase = phraseFor(cfg.buildTiers, b);
        if (buildPhrase) parts.push(buildPhrase);
      }

      const chest = a.chest ?? 50;
      parts.push(appearancePhrasePreview("chest", chest));

      const waist = a.waist ?? 50;
      const hips = a.hips ?? 50;

      // Waist + hips combined when both point the same direction — "narrow
      // waist, narrow hips" as two separate phrases reads as more extreme than
      // either was meant to be individually, since they're largely describing
      // the same silhouette.
      if (waist <= 30 && hips <= 30) {
        parts.push(cfg.combinedSlenderWaistline);
      } else if (waist >= 70 && hips >= 70) {
        parts.push(cfg.combinedCurvyWaistline);
      } else {
        const waistPhrase = phraseFor(cfg.waistTiers, waist);
        if (waistPhrase) parts.push(waistPhrase);
        const hipsPhrase = phraseFor(cfg.hipsTiers, hips);
        if (hipsPhrase) parts.push(hipsPhrase);
      }

      return parts.filter(Boolean).length > 0 ? parts.filter(Boolean).join(", ") : "";
    }

    // Returns { scene, touching, viewerBody } rather than a prompt string. Whether
    // the two of them are touching used to be decided here by regular expression,
    // which is not something a verb list can do: it missed "she nibbles his
    // earlobe" and accepted "I pour a drink and watch her undress". The model is
    // already reading the conversation to write the scene, so it answers that at
    // the same time, and says which of the viewer's own parts are in the shot.
    async function extractScene({ messages, character, model, aiComplete }) {
      const recent = messages.slice(-10).filter(m => m.role !== "image").map(m => `${m.role === "user" ? "User" : character.name}: ${m.content}`).join("\n");
      const appearanceDesc = buildAppearancePrompt(character.appearance);
      const genderDesc = character.gender === "Custom" ? (character.customGender || "") : (character.gender || "");
      const ageDesc = character.age ? `${character.age} year old` : "";
      // charDesc may be passed in already built — the lab holds it as editable
      // text rather than a set of appearance sliders.
      const charDesc = character.charDesc || [ageDesc, genderDesc, appearanceDesc].filter(Boolean).join(", ");
      // On an explicit scene the extractor would reliably return pose and mood and
      // drop the act itself, so it is told to report what is happening. Gated on
      // the character's NSFW toggle like every other explicit path in the app.
      const actNote = character.nsfw
        ? " State plainly what the two of them are physically doing to each other, including sexual acts where that is what is happening — do not soften it into mood, atmosphere or euphemism, and do not substitute a pose for the act. In an intimate scene viewerBody must name the viewer's own anatomy that is actually involved, and the frame edge it enters from. Give it a plain, ordinary size - write \"the viewer's normal sized penis\" rather than leaving the size unsaid, since unqualified the image model tends toward the exaggerated."
        : "";
      const content = await aiComplete({ model, messages: [{ role: "user", content: fillTemplate(CFG.image.scenePromptInstruction, { name: character.name, charDesc: charDesc || "not specified", recent, actNote }) }] });
      return parseSceneExtraction(content, messages, character.name);
    }

    // The extractor is a language model asked for JSON, so it sometimes wraps it in
    // a code fence or adds a sentence around it. Pull the object out rather than
    // failing the whole generation over punctuation.
    function parseSceneExtraction(content, messages, characterName) {
      const text = String(content || "").trim();
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          const parsed = JSON.parse(match[0]);
          const scene = String(parsed.scene || "").trim();
          if (scene) {
            return {
              scene: scene.replace(/^"|"$/g, ""),
              // Models emit the boolean as a JSON string often enough that
              // requiring a real true silently reported touching scenes as not.
              touching: parsed.touching === true || /^(true|yes)$/i.test(String(parsed.touching)),
              viewerBody: String(parsed.viewerBody || "").trim(),
            };
          }
        } catch {} // fall through to the plain-text reading below
      }
      // No usable JSON. Treat the whole reply as the scene and fall back to the
      // old keyword detector for contact — it is wrong often enough that it was
      // replaced, but it beats defaulting a touching scene to "nobody is touching".
      return {
        scene: text.replace(/^```(?:json)?|```$/g, "").trim().replace(/^"|"$/g, ""),
        touching: detectPhysicalContact(messages, characterName),
        viewerBody: "",
      };
    }

    // Read off the description rather than plumbed through from the character
    // record, so the lab (which holds charDesc as editable text) and the app
    // arrive at the same subject without a second source of truth.
    function subjectFor(charDesc) {
      const d = String(charDesc || "");
      if (/\bfemale\b|\bwoman\b|\bgirl\b/i.test(d)) return "a woman";
      if (/\bmale\b|\bman\b|\bboy\b/i.test(d)) return "a man";
      return "a person";
    }

    // Everything the app assembles a chat image prompt from, in one place, so
    // the lab and the app can never drift into building it differently.
    // charDesc is passed in already built (it comes from the appearance
    // sliders, which are not part of prompt assembly).
    function assembleImagePrompt({
      scenePrompt, charDesc, charOutfit, userOutfit, staging, nsfw,
      explicitDetail, messages, characterName, styleModifiers,
      contact: contactOverride, name, keepSceneVerbatim, viewerBody, subjectNoun,
    }) {
      const contact = contactOverride !== undefined
        ? contactOverride
        : detectPhysicalContact(messages || [], characterName);
      // The extractor writes the scene text, so it is the one place a stray
      // hand can still get in. Cut those clauses when nobody is touching.
      // keepSceneVerbatim is the hand-typed prompt box: if someone wrote a
      // hand into it they meant it, so only the POV clause reacts to contact.
      const scene = (contact || keepSceneVerbatim)
        ? scenePrompt
        : stripViewerLimbs(scenePrompt);
      const parts = {
        pov: buildPovModifiers(scene, staging, nsfw, userOutfit, contact, viewerBody),
        name: name || "",
        charDesc: charDesc || "",
        wardrobe: charOutfit ? `wearing ${charOutfit}` : "",
        staging: buildStagingImageDesc(staging),
        scene: scene || "",
        explicit: isIntimateScene(scene, staging, nsfw) ? (explicitDetail || "") : "",
        style: styleModifiers || "photorealistic, natural lighting, 50mm, sharp focus",
      };
      // Two sentences, not one comma run. Everything before the full stop is
      // the viewer; everything after it is her. Run together, "the viewer
      // wearing boxers, 19 year old, Female, ... wearing nothing" is two
      // people's clothing in one list with nothing saying which is whose.
      const viewerOrder = ["pov"];
      const subjectOrder = ["name", "charDesc", "wardrobe", "staging", "scene", "explicit", "style"];
      // parts is returned alongside the finished string so the lab can show
      // which source each clause came from — the thing that was impossible to
      // see when this was a single joinPromptParts call inline in the app.
      // "a woman, 19 years old, caucasian, ..." — the description had no
      // subject at all, so it read as a continuation of the viewer's sentence.
      const subject = subjectNoun !== undefined ? subjectNoun : subjectFor(charDesc);
      const viewerText = joinPromptParts(viewerOrder.map(k => parts[k]));
      const subjectText = joinPromptParts([subject].concat(subjectOrder.map(k => parts[k])));
      return {
        prompt: [viewerText, subjectText].filter(Boolean).join(". "),
        parts,
        contact,
        intimate: isIntimateScene(scene, staging, nsfw),
        viewerBody: (contact && viewerBody) ? viewerBody : "",
        strippedLimbs: scene !== scenePrompt,
      };
    }

    return {
      ACTION_TEXT_RE, extractActionText,
      EMPTY_STAGING, STAGING_KEYS, hasStaging, buildStagingImageDesc,
      HEIGHT_CM_MIN, HEIGHT_CM_MAX, sliderToCm, cmToSlider,
      appearancePhrasePreview, buildAppearancePrompt,
      isUserUndressed, povSelfBody, isIntimateScene,
      beatShowsContact, detectPhysicalContact, stripViewerLimbs,
      buildPovModifiers, joinPromptParts, subjectFor, assembleImagePrompt,
      extractScene, parseSceneExtraction,
    };
  },
};
