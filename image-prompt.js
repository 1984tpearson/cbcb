// PersonaChat — IMAGE PROMPT ASSEMBLY
// Framework-free, like site-config.js, and loaded as a plain script.
// Everything here is pure: state in, prompt string out, no React, no network,
// no DOM.
//
// It lives outside index.html because the whole file used to be inline in the
// app source, which meant the only way to see what a change did to a prompt
// was to play the game and generate an image. Every prompt regression this
// project has had came from tuning blind that way. Kept separate and pure, a
// change can be diffed across cases in a few lines of script before it costs
// a generation.
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
    // "penis" was missing, and it is the word the extractor writes most often
    // for the act this list exists to catch. So the commonest term for it was
    // the one term that did not register as intimate — which silently dropped
    // the user's own explicit detail from those shots, since this same test
    // gates it, and left them with no intimate framing either.
    const POV_INTIMATE_RE = /\b(sex|sexual|fucking|fucks|thrust|thrusting|riding|rides|straddling|straddles|grinding|penetrat\w*|oral|blowjob|blow job|going down on|all fours|doggy|legs apart|legs spread|mounting|mounts|cock|dick|penis|erection|erect|cunnilingus|deepthroat|pussy|clit|nipples?|breasts?|tits|cum|climax|orgasm|moaning|naked|nude|undressed|topless|bare[- ]?chested)\b/i;
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
    // Where an explicit POV shot is composed. See buildPovModifiers: the
    // contact branch returns before the intimate one, so this is the only
    // framing an explicit shot ever gets.
    const POV_INTIMATE_FRAMING = CFG.image.povIntimateFraming;
    // Asserted rather than permitted, and asked for as a moment in a motion.
    // See CFG.image.povIntimateContact for why permission was not enough.
    const POV_INTIMATE_CONTACT = CFG.image.povIntimateContact;
    const POV_INTIMATE_MOTION = CFG.image.povIntimateMotion;

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
    // The viewer's own sex, as a phrase, or "" when it is not known well
    // enough to assert. "Custom" and unset both land on "" deliberately: the
    // user persona has no free-text gender field, so "Custom" carries no word
    // to use, and guessing is the failure this whole path exists to stop.
    function viewerSexPhrase(gender) {
      const words = (CFG.image && CFG.image.viewerSexWords) || {};
      return words[String(gender || "").trim()] || "";
    }

    function buildPovModifiers(sceneText, staging, nsfw, userOutfit, contact, viewerBody, viewerGender, viewerDesc) {
      const scene = sceneText || "";
      const parts = [POV_BASE];
      // Said once, and only where the viewer's body is in the frame at all.
      // Every branch below that draws the viewer calls this; the branches that
      // keep the viewer a camera deliberately do not, because a description of
      // a body the shot does not contain is an invitation to draw one.
      const selfDesc = () => (viewerDesc ? fillTemplate(CFG.image.povViewerDesc, { desc: viewerDesc }) : "");
      if (contact && viewerBody) {
        // viewerBody already says whose the limb is and where it enters, so
        // "the foreground hand and arm belong to the viewer, one pair only"
        // only repeated the ownership and added a second mention of hands and
        // arms. Removing it measurably improved the images.
        // Two ways of putting the viewer in the shot, and which one depends on
        // how much else in the prompt is already talking about the same body.
        //
        // In an ordinary contact shot the scene says nothing about the
        // viewer's anatomy, so viewerBody naming the part and the edge is the
        // only thing placing it, and it works.
        //
        // In an explicit one the scene already says what she is doing and to
        // what. Repeating it as a placed object gave the model two accounts
        // of one thing, and the specifics were what it bent the image to
        // satisfy. So there it is told only that the body may be there.
        if (isIntimateScene(scene, staging, nsfw)) {
          parts.push(POV_INTIMATE_CONTACT, POV_INTIMATE_FRAMING, POV_INTIMATE_MOTION);
          // Only here. This is the shot where the viewer's body may be drawn
          // at all, so it is the only one where drawing it the wrong sex is
          // possible — and every clause added elsewhere is one the model can
          // render literally for no reason.
          const viewerPhrase = viewerSexPhrase(viewerGender);
          if (viewerPhrase) parts.push(fillTemplate(CFG.image.povViewerSex, { viewer: viewerPhrase }));
          parts.push(selfDesc());
        } else {
          parts.push(viewerBody, selfDesc());
        }
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
        // The other intimate branch — contact, but the extractor named no part
        // of the viewer. The shot is just as explicit and was just as static,
        // so it gets the motion clause too. Not the contact clause: with no
        // viewerBody there is no "point the scene describes" to point back at.
        parts.push(POV_INTIMATE_MOTION, selfDesc());
      } else {
        // Arms only. The colouring still applies — a pair of forearms is the
        // one part of the viewer this shot does draw — but nothing else about
        // the body is in frame, so only the colouring is offered.
        parts.push(POV_ARMS_OWNED_MODIFIER, selfDesc());
      }
      return parts.filter(Boolean).join(", ");
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

    // The face editor's settings, turned into prompt text. Structure traits
    // describe the face itself and are emitted plainly; makeup, eyewear and
    // details are things worn on it, so they go through the "wearing {…}"
    // template. Both halves come back from one call because every caller wants
    // them in the same place, and returning them separately only ever produced
    // the same join at each site.
    //
    // Anything sitting on its "None"/"Any" sentinel emits nothing at all — an
    // untouched face has to read to the model exactly as it did before this
    // feature existed, or every existing character's images would shift the
    // first time they were regenerated.
    // The phrase one field contributes, and the single place that decides it.
    // Both the prompt builder and the "has this been set?" checks go through
    // here, so a field can never count as set while contributing nothing, or
    // vice versa — they were separate rules once and drifted apart the moment
    // custom text arrived.
    //
    // A field whose value is the custom sentinel takes its phrase from the
    // companion "<key>Custom" entry, following the same convention the
    // appearance settings already use for hairColour/hairColourCustom.
    function faceFieldPhrase(values, field, cfg, unsetValue) {
      const chosen = values[field.key];
      if (!chosen || chosen === unsetValue) return "";
      if (chosen === cfg.customValue) return String(values[field.key + "Custom"] || "").trim();
      // Structure fields are plain strings; grouped fields carry a phrase.
      if (!field.options || typeof field.options[0] === "string") return chosen;
      const opt = field.options.find(o => o.value === chosen);
      // An unknown value is one the config no longer offers (a list was edited
      // after the character was saved). Fall back to the stored value itself
      // rather than dropping it silently.
      return opt ? opt.phrase : String(chosen).toLowerCase();
    }

    function buildFacePrompt(face) {
      const cfg = (CFG.appearance && CFG.appearance.face) || null;
      if (!face || !cfg) return "";

      // Phrases bucketed by the template that will wrap them, preserving the
      // order the templates were first seen. Grouping this way is what lets
      // makeup, eyewear and details share a single "wearing …" while hair,
      // which uses a different template, stays a separate clause.
      const buckets = new Map();
      for (const group of cfg.groups || []) {
        const template = group.template || cfg.template;
        const values = face[group.key] || {};
        for (const field of group.fields || []) {
          const phrase = faceFieldPhrase(values, field, cfg, cfg.noneValue);
          if (!phrase) continue;
          if (!buckets.has(template)) buckets.set(template, []);
          buckets.get(template).push(phrase);
        }
      }

      const struct = face.structure || {};
      const structural = (cfg.structure || [])
        .map(field => faceFieldPhrase(struct, field, cfg, cfg.unsetValue))
        .filter(Boolean);

      const parts = [];
      if (structural.length) parts.push(fillTemplate(cfg.structureTemplate, { phrases: structural.join(", ") }));
      for (const [template, phrases] of buckets) parts.push(fillTemplate(template, { phrases: phrases.join(", ") }));
      return parts.filter(Boolean).join(", ");
    }

    // True when this group contributes nothing to the prompt. Note that is not
    // quite "every dropdown is on None": a field set to Custom with the text
    // box left empty says nothing, so it counts as unset — otherwise it would
    // drop the group's hold clause while adding no instruction to replace it,
    // which is the one combination that silently lets the hair drift.
    function isFaceGroupUnset(face, group, cfg) {
      const values = (face && face[group.key]) || {};
      return (group.fields || []).every(field => !faceFieldPhrase(values, field, cfg, cfg.noneValue));
    }

    // True when the face's *structure* is unspecified — shape, cheekbones, nose,
    // mouth, eyes, skin.
    //
    // This, not isFaceUnset, is the question pickFaceVariation should be gated
    // on. The variation pools describe those same six traits, so they compete
    // with a chosen face shape and with nothing else: lipstick and a ponytail
    // have no opinion about a jawline. Asking the broader question meant that
    // filling in any makeup at all silenced the face description completely,
    // and every character generated from a vibe came out wearing the model's
    // default face.
    function isFaceStructureUnset(face) {
      const cfg = (CFG.appearance && CFG.appearance.face) || null;
      if (!cfg || !face) return true;
      const struct = face.structure || {};
      return (cfg.structure || []).every(field => !faceFieldPhrase(struct, field, cfg, cfg.unsetValue));
    }

    // True when nothing on the face has been set at all.
    function isFaceUnset(face) {
      const cfg = (CFG.appearance && CFG.appearance.face) || null;
      if (!cfg) return true;
      if (!face) return true;
      const groupsClear = (cfg.groups || []).every(group => isFaceGroupUnset(face, group, cfg));
      const struct = face.structure || {};
      const structClear = (cfg.structure || []).every(field => !faceFieldPhrase(struct, field, cfg, cfg.unsetValue));
      return groupsClear && structClear;
    }

    // What a chat image prompt still needs to say about the character, now that
    // the base image passed as inputImage carries her appearance.
    //
    // Everything the picture shows is left out: hair, eyes, skin, build, chest,
    // waist, hips, and the whole face block. Saying it again cannot make the
    // image more like itself, and it is not free — a longer prompt dilutes the
    // scene, which is the only part that changes shot to shot. Worse, makeup
    // and hair are stored as data AND baked into the base image, so the moment
    // those two disagree the model averages them. One source of truth, and it
    // is the image.
    //
    // Three things stay, because the image does not carry them:
    //   age    — a face reads approximately, and drifts
    //   gender — likewise, and it is one word
    //   height — nothing in a picture cropped at mid-thigh distinguishes 152cm
    //            from 178cm; absolute scale has no visual referent at all.
    //            Which is also why the number alone was not enough: it has no
    //            referent for the model either. It travels with its tier phrase.
    function buildChatCharDesc(character) {
      if (!character) return "";
      const genderDesc = character.gender === "Custom" ? (character.customGender || "") : (character.gender || "");
      const ageDesc = character.age ? `${character.age} year old` : "";
      const a = character.appearance;
      // The measurement AND the tier phrase. On its own "168 cm tall" is a
      // number with no visual referent — the model cannot draw a centimetre,
      // and a figure it cannot draw is one it ignores, which is why height was
      // the one thing here that never arrived. The words it can draw are
      // "short and small-framed" and "tall, above average height", so both go:
      // the number for anything that reads it as data, the phrase for the
      // model. The average tier carries skipInPrompt and drops out, which is
      // right — saying "average height" spends prompt on the default.
      const heightTier = (a && a.height != null) ? tierFor(CFG.appearance.heightTiers, a.height) : null;
      const heightDesc = (a && a.height != null)
        ? fillTemplate(CFG.appearance.heightMeasurementTemplate, { cm: sliderToCm(a.height) })
        : "";
      const heightPhrase = heightTier && !heightTier.skipInPrompt ? heightTier.phrase : "";
      return [ageDesc, genderDesc, heightDesc, heightPhrase].filter(Boolean).join(", ");
    }

    // ── Body base image & avatar ────────────────────────────────────────────
    // Both are editor-only. Nothing here is reachable from buildAppearancePrompt
    // or any chat prompt: tattoos travel into chat images entirely as pixels in
    // the base image, never as words, which is the whole reason the base image
    // is nude. Adding them to prompt assembly as well would be a second source
    // of truth arguing with the first.
    // Which appearance fields differ between the state the current base image
    // was generated from and the state now. Compared shallowly on the scalar
    // fields plus the tattoo object, which is all the holds key off.
    function appearanceDiffKeys(before, after) {
      const a = before || {}, b = after || {};
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      const changed = [];
      // The face is compared one group at a time and reported as "face.hair",
      // "face.structure" and so on, because the holds care which part moved: a
      // restyle contradicts the hair hold, a new jaw contradicts the identity
      // hold, and lipstick contradicts nothing at all.
      if ((a.face || b.face) && JSON.stringify(a.face ?? null) !== JSON.stringify(b.face ?? null)) {
        const fa = a.face || {}, fb = b.face || {};
        for (const g of new Set([...Object.keys(fa), ...Object.keys(fb)])) {
          if (JSON.stringify(fa[g] ?? null) !== JSON.stringify(fb[g] ?? null)) changed.push("face." + g);
        }
      }
      for (const k of keys) {
        if (k === "baseSnapshot" || k === "face") continue;
        const x = a[k], y = b[k];
        const same = (x && typeof x === "object") || (y && typeof y === "object")
          ? JSON.stringify(x ?? null) === JSON.stringify(y ?? null)
          : (x ?? "") === (y ?? "");
        if (!same) changed.push(k);
      }
      return changed;
    }

    // "a, b and c" — the change clause reads as a sentence, so a bare comma
    // list would run into the rest of the clause.
    function joinList(items, join) {
      const sep = join || " and ";
      if (items.length <= 1) return items[0] || "";
      return items.slice(0, -1).join(", ") + sep + items[items.length - 1];
    }

    function buildBodyBasePrompt({ body, charDesc, changedKeys, anchored = true, extra }) {
      const cfg = (CFG.appearance && CFG.appearance.body) || null;
      if (!cfg) return "";
      const values = body || {};
      const marks = (cfg.fields || [])
        .map(field => faceFieldPhrase(values, field, cfg, cfg.noneValue))
        .filter(Boolean);
      // Absence stated rather than implied — left unsaid, the model is free to
      // invent tattoos, and this image is what every later generation copies.
      // Unless the field is left unset, which is a different statement: there
      // the reference image is the record of what ink she has, and "clean
      // unmarked skin" would delete it.
      const unset = (cfg.fields || []).some(f => values[f.key] === cfg.unsetValue);
      const skin = marks.length ? marks.join(", ") : (unset ? "" : cfg.noTattoos);

      // Hold everything the edit did not touch, and only that. A hold whose
      // fields were edited is dropped: keeping it would put "same skin tone"
      // and "dark brown skin" in one prompt, and the reference image would win
      // the argument, which is exactly what made an ethnicity change a no-op.
      // With no reference image there is nothing to hold to: "the same person
      // as the reference image" in a first generation names something that does
      // not exist, and every hold clause is a promise about a picture nobody
      // has seen. The description is the whole brief in that case.
      //
      // A released hold also has to become a stated change. Dropping "the same
      // body shape" only stops the prompt contradicting the edit; it does not
      // ask for anything, and against a whole reference image passed as
      // inputImage a silent prompt loses — which is why a chest edit came back
      // pixel-identical. The change clause goes first, ahead of the continuity
      // preamble, so the edit is the first thing read rather than the last.
      const anchor = [];
      if (anchored) {
        const changed = new Set(changedKeys || []);
        const released = (cfg.baseHolds || []).filter(h => (h.keys || []).some(k => changed.has(k)));
        const holds = (cfg.baseHolds || []).filter(h => !(h.keys || []).some(k => changed.has(k)));
        const aspects = released.map(h => h.change).filter(Boolean);
        if (aspects.length && cfg.baseChangeTemplate) {
          anchor.push(fillTemplate(cfg.baseChangeTemplate, { aspects: joinList(aspects, cfg.baseChangeJoin) }));
        }
        anchor.push(holds.some(h => h.identity) ? cfg.basePreamble : cfg.basePreambleRestyled);
        anchor.push(...holds.map(h => h.phrase));
      }

      return [...anchor, cfg.baseFraming, cfg.baseNudeClause, charDesc, skin, extra, cfg.baseSuffix]
        .filter(Boolean).join(", ");
    }

    // An uploaded photograph turned into a base image: same framing, same
    // nudity, same suffix as every other base image, but described by the
    // picture rather than by the appearance settings.
    //
    // Nothing from buildAppearancePrompt reaches this. The settings were
    // written to describe a character nobody had seen yet; once there is a
    // photograph of her they are a second, worse account of the same person,
    // and the image model splits the difference between them. The photograph
    // wins outright — including the tattoos, which is why the usual "clean
    // unmarked skin" clause is left off here.
    function buildUploadBasePrompt({ extra } = {}) {
      const cfg = (CFG.appearance && CFG.appearance.body) || null;
      if (!cfg) return "";
      return [cfg.uploadPreamble, cfg.uploadHold, cfg.uploadColour, cfg.baseFraming, cfg.baseNudeClause, extra, cfg.baseSuffix]
        .filter(Boolean).join(", ");
    }

    // Which stored expression photograph, if any, belongs with this scene.
    // Returns a URL or null; null is the ordinary answer and means the image is
    // generated exactly as it always was.
    //
    // The scene text is what the extractor wrote, and it is told to put the
    // most important action first — so where two slots both match, the one
    // named earliest wins. Never guesses: an unfilled slot, or a scene that
    // names no expression at all, attaches nothing rather than reaching for
    // whichever photograph happens to exist.
    function pickExpressionReference(photos, sceneText) {
      const slots = (CFG.image && CFG.image.expressions && CFG.image.expressions.slots) || [];
      if (!photos || !slots.length) return null;
      // A slot holds either a bare URL, which is how the first hand-filled ones
      // were stored, or { url, auto } once the reader could fill them itself.
      const urlOf = v => (typeof v === "string" ? v : (v && v.url) || null);
      const text = String(sceneText || "").toLowerCase();
      if (!text) return null;
      let best = null;
      for (const slot of slots) {
        const url = urlOf(photos[slot.key]);
        if (!url) continue; // an empty slot is not a candidate, however well it matches
        for (const word of slot.words || []) {
          // Word boundary at the start only: these are prefixes, so "smil"
          // is meant to catch "smiling" but not to catch the tail of another
          // word.
          const at = text.search(new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
          if (at !== -1 && (!best || at < best.at)) best = { at, url };
        }
      }
      return best ? best.url : null;
    }

    // avatar is { lighting, lightingCustom, outfit } — how this photograph is
    // taken rather than what she looks like, which is why it lives apart from
    // appearance and never reaches a base image.
    function buildAvatarPrompt({ charDesc, avatar, extra }) {
      const cfg = (CFG.appearance && CFG.appearance.body) || null;
      if (!cfg) return "";
      const a = avatar || {};
      const outfit = String(a.outfit || "").trim() || cfg.avatarOutfitFallback;
      const lighting = (cfg.avatarFields || [])
        .map(field => faceFieldPhrase(a, field, cfg, cfg.noneValue))
        .filter(Boolean)
        .join(", ") || cfg.avatarLightingFallback;
      return [
        cfg.avatarPreamble, cfg.avatarFraming,
        outfit ? fillTemplate(cfg.avatarOutfitTemplate, { outfit }) : "",
        lighting, cfg.avatarBackground, charDesc, extra, cfg.avatarSuffix,
      ].filter(Boolean).join(", ");
    }

    // One expression slot, made rather than uploaded. Anchored to the base
    // image, so this says what the face is DOING and nothing about who it
    // belongs to — the reference already carries that, and repeating it is
    // what turns an edit into a fresh generation.
    function buildExpressionPrompt({ expression, extra }) {
      const cfg = ((CFG.image || {}).expressions || {}).generate;
      if (!cfg) return "";
      return [
        cfg.preamble,
        expression ? fillTemplate(cfg.expressionTemplate, { expression }) : "",
        cfg.framing, cfg.lighting, extra, cfg.suffix,
      ].filter(Boolean).join(", ");
    }

    // The change request sent to the image model when regenerating a base image
    // from the face editor. The reference image carries the identity, so this
    // says what the face should now look like rather than re-describing the
    // whole character — re-stating hair, build and colouring alongside an
    // inputImage pulls the result toward a fresh generation instead of an edit.
    function buildFaceEditPrompt({ face, charDesc, loosenIdentity }) {
      const cfg = (CFG.appearance && CFG.appearance.face) || null;
      if (!cfg) return "";
      const facePart = buildFacePrompt(face);
      const preamble = loosenIdentity ? cfg.editPreambleLoose : cfg.editPreamble;
      // With nothing set the editor is being used to re-shoot the base image
      // unchanged, so the preamble and suffix alone are the whole request.
      // A group that declares holdWhenUnset gets that clause while it is
      // untouched, and loses it the moment it is set. Hair is the case that
      // needs it: an edit about lipstick must not restyle the hair, but an
      // edit that IS about the hair cannot also be told to keep it unchanged —
      // asking for both leaves the model to pick one, which it does at random.
      const holds = (cfg.groups || [])
        .filter(g => g.holdWhenUnset && isFaceGroupUnset(face, g, cfg))
        .map(g => g.holdWhenUnset);

      return [preamble, cfg.editFraming, ...holds, charDesc, facePart, cfg.editSuffix].filter(Boolean).join(", ");
    }

    // `measurements` controls the height in centimetres. Words-only readers —
    // the [APPEARANCE] note, the scene extractor, the scenario setup — get it,
    // because a number is exactly the kind of thing a language model uses. The
    // image paths do not: nothing in a frame cropped at mid-thigh gives 195 cm
    // a referent, so the figure was spending prompt attention to say nothing,
    // in a prompt whose body description was already being outweighed.
    // What the LANGUAGE models are told she looks like. A base image can carry
    // its own written description — read off the picture by the vision model —
    // and where one exists it wins: it describes the character that actually
    // exists, while the appearance settings describe the one that was asked
    // for, and on an uploaded photograph those settings never described her at
    // all. No description, and the settings are still the best account there
    // is. The image model never reads either of these; it reads the picture.
    function appearanceWords(appearance) {
      const written = String((appearance && appearance.description) || "").trim();
      return written || buildAppearancePrompt(appearance);
    }

    // The same words with the body marks taken out, for the one reader whose
    // output becomes an image prompt. See CFG.image.bodyMarks for why: a mark
    // the extractor is told about is a mark it writes a scene around, and a
    // scene written around a navel piercing has already decided that the
    // midriff is bare.
    //
    // Sentence granularity, because that is how these descriptions are built —
    // the vision model is asked for two or three sentences and gives a
    // distinguishing feature its own one. A mark sharing a sentence with real
    // description survives, which is the deliberate trade: losing the build and
    // the colouring to remove a piercing is a worse outcome than the piercing.
    //
    // Pure and exported so the rule can be checked across many descriptions in
    // a script rather than one generation at a time.
    function stripBodyMarks(text) {
      const cfg = (CFG.image && CFG.image.bodyMarks) || {};
      const terms = cfg.terms || [];
      const keep = cfg.keepTerms || [];
      const source = String(text || "").trim();
      if (!source || !terms.length) return source;

      // Escaped because the lists are config the owner can edit, and a stray
      // bracket in one should not throw from inside a prompt build.
      const esc = t => String(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const anyOf = list => new RegExp("\\b(?:" + list.map(esc).join("|") + ")\\b", "i");
      const markRe = anyOf(terms);
      const keepRe = keep.length ? anyOf(keep) : null;

      // Kept with their terminators so what survives still reads as prose.
      const sentences = source.match(/[^.!?]+[.!?]*\s*/g) || [source];
      const kept = sentences.filter(sentence => {
        if (!markRe.test(sentence)) return true;
        return keepRe ? keepRe.test(sentence) : false;
      });

      // Everything stripped means the description was nothing but marks. An
      // empty appearance is worse than one carrying a piercing — the extractor
      // would then be told nothing at all about who it is looking at.
      const result = kept.join("").replace(/\s+/g, " ").trim();
      return result || source;
    }

    function buildAppearancePrompt(appearance, { measurements = true } = {}) {
      if (!appearance) return "";
      const a = appearance;
      const cfg = CFG.appearance;
      const parts = [];

      const hair = a.hairColour === "Custom" ? a.hairColourCustom : a.hairColour;
      const eyes = a.eyeColour === "Custom" ? a.eyeColourCustom : a.eyeColour;
      const skin = a.skinTone === "Custom" ? a.skinToneCustom : a.skinTone;

      const ethnicity = a.ethnicity === "Custom" ? a.ethnicityCustom : a.ethnicity;
      if (ethnicity) parts.push(ethnicity.toLowerCase());

      // null means "leave as it is": the field is not described at all, so the
      // hold covering it survives a regeneration and nothing in the prompt
      // argues with the base image about it. An uploaded photograph starts
      // with every one of these unset, because there the picture is the only
      // account of her there has ever been.
      const h = a.height;
      const b = a.build;

      // Free text typed against one of the body fields, following the same
      // "<key>Custom" convention hair/eye/skin already use. When present it
      // replaces that field's tier phrase outright — the tier lists exist to
      // save typing, not to be the only describable shapes.
      const custom = key => String(a[key + "Custom"] || "").trim();

      // A tier marked skipInPrompt is the unremarkable middle one — saying
      // "average height" adds nothing the model can use, so it is only shown as
      // the slider's own preview text.
      const phraseFor = (tiers, value) => {
        const tier = tierFor(tiers, value);
        return tier && !tier.skipInPrompt ? tier.phrase : null;
      };

      // The whole silhouette in one run, immediately after the ethnicity and
      // ahead of hair, eyes and skin. It used to sit behind the colouring, so
      // the part of the description that was being ignored was also the part
      // buried deepest in the prompt.
      //
      // The extreme tiers no longer combine into a single softened phrase.
      // "short, slender frame" and "curvier waistline" were what a maxed-out
      // slider produced, which is how both ends of the scale ended up looking
      // the same: they were guards against caricature written when the tier
      // phrases stacked two vague modifiers, and the phrases they were
      // guarding against no longer exist.
      if (h != null) {
        if (measurements) parts.push(fillTemplate(cfg.heightMeasurementTemplate, { cm: sliderToCm(h) }));
        const heightPhrase = phraseFor(cfg.heightTiers, h);
        if (heightPhrase) parts.push(heightPhrase);
      }
      const buildPhrase = custom("build") || (b != null ? phraseFor(cfg.buildTiers, b) : null);
      if (buildPhrase) parts.push(buildPhrase);

      const chestPhrase = custom("chest") || (a.chest != null ? appearancePhrasePreview("chest", a.chest) : null);
      if (chestPhrase) parts.push(chestPhrase);

      const waistPhrase = custom("waist") || (a.waist != null ? phraseFor(cfg.waistTiers, a.waist) : null);
      if (waistPhrase) parts.push(waistPhrase);
      const hipsPhrase = custom("hips") || (a.hips != null ? phraseFor(cfg.hipsTiers, a.hips) : null);
      if (hipsPhrase) parts.push(hipsPhrase);

      if (hair) parts.push(`${hair.toLowerCase()} hair`);
      if (eyes) parts.push(`${eyes.toLowerCase()} eyes`);
      if (skin) parts.push(`${skin.toLowerCase()} skin`);

      // Face last: the silhouette and colouring establish who this is, and
      // makeup and eyewear are modifiers on top of that.
      const facePart = buildFacePrompt(a.face);
      if (facePart) parts.push(facePart);

      return parts.filter(Boolean).length > 0 ? parts.filter(Boolean).join(", ") : "";
    }

    // Returns { scene, touching, viewerBody } rather than a prompt string. Whether
    // the two of them are touching used to be decided here by regular expression,
    // which is not something a verb list can do: it missed "she nibbles his
    // earlobe" and accepted "I pour a drink and watch her undress". The model is
    // already reading the conversation to write the scene, so it answers that at
    // the same time, and says which of the viewer's own parts are in the shot.
    async function extractScene({ messages, character, model, aiComplete, viewerGender }) {
      const recent = messages.slice(-10).filter(m => m.role !== "image").map(m => `${m.role === "user" ? "User" : character.name}: ${m.content}`).join("\n");
      // Stripped, not the full words: this is the one path whose output is
      // handed to the image model. See stripBodyMarks.
      const appearanceDesc = stripBodyMarks(appearanceWords(character.appearance));
      const genderDesc = character.gender === "Custom" ? (character.customGender || "") : (character.gender || "");
      const ageDesc = character.age ? `${character.age} year old` : "";
      // charDesc may be passed in already built — the lab holds it as editable
      // text rather than a set of appearance sliders.
      const charDesc = character.charDesc || [ageDesc, genderDesc, appearanceDesc].filter(Boolean).join(", ");
      // On an explicit scene the extractor would reliably return pose and mood and
      // drop the act itself, so it is told to report what is happening. Gated on
      // the character's NSFW toggle like every other explicit path in the app.
      //
      // Naming the act was not enough on its own. "Kneeling between the
      // viewer's thighs, mouth against the viewer's cock, looking up" obeys
      // every instruction above and still describes the moment BEFORE the act:
      // two parts placed beside each other. The image model has nothing to draw
      // but what it is told, so it drew exactly that, every time — which is why
      // these shots all came out poised on the edge of starting.
      //
      // So the note now asks for the stage as a physical fact, and rules out
      // the prepositions that place without joining. "Against" is the whole bug
      // in one word: it is true of a mouth an inch away and true of one halfway
      // down, and the model resolves that ambiguity the tamest way it can.
      const actNote = character.nsfw
        ? " State plainly what the two of them are physically doing to each other, including sexual acts where that is what is happening — do not soften it into mood, atmosphere or euphemism, and do not substitute a pose for the act. Say what STAGE the act has reached, as a physical fact: how deep, how far in, how much of it is taken, whose weight is on whom, which surfaces are pressed together. \"Against\", \"at\", \"near\", \"close to\" and \"poised\" only place two parts beside one another — where the text says they are joined, write them joined. Describe the act at the height of it and in motion, never at the moment before it begins. In an intimate scene viewerBody must name the viewer's own anatomy that is actually involved, and the frame edge it enters from."
        : "";
      // When she is wearing garments out of the wardrobe, their photographs go
      // to the image model and the prompt says nothing about them. What the
      // photographs cannot show is what has happened to them since she put
      // them on, so that is asked for here — and only when there is a garment
      // for it to be about, since an unused field is one a model fills in
      // anyway.
      const wornNames = (character.wornNames || []).filter(Boolean);
      const clothingField = wornNames.length ? CFG.image.clothingStateField : "";
      const clothingNote = wornNames.length
        ? fillTemplate(CFG.image.clothingStateNote, { name: character.name, garments: wornNames.join(", ") })
        : "";
      // Who the viewer is, in a prompt that until now only ever said "the
      // User". Asked in an intimate scene to name the viewer's own anatomy
      // with nothing to go on, the model wrote what it assumed — and between
      // two women that anatomy had nowhere to belong, so the image model hung
      // it on the woman in frame. Where the sex is not known the note forbids
      // naming genitals rather than inventing them.
      const viewerPhrase = viewerSexPhrase(viewerGender);
      const viewerNote = viewerPhrase
        ? fillTemplate(CFG.image.viewerNoteKnown, { viewer: viewerPhrase })
        : fillTemplate(CFG.image.viewerNoteUnknown, { name: character.name });
      const content = await aiComplete({ model, messages: [{ role: "user", content: fillTemplate(CFG.image.scenePromptInstruction, { name: character.name, charDesc: charDesc || "not specified", recent, actNote, viewerNote, clothingField, clothingNote }) }] });
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
              clothingState: String(parsed.clothingState || "").trim(),
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

    // ── Which worn garments the image model is shown ──────────────────────────
    // Worn is not the same as visible. See CFG.wardrobe.layers: a garment with
    // something over it stays on her and stays in what the chat model is told,
    // but its photograph is not sent, because a flat lay is an instruction to
    // show that garment.
    //
    // Pure, so the whole rule can be checked across combinations in a script
    // rather than one generation at a time.
    function garmentLayer(garment) {
      const L = (CFG.wardrobe.layers || {});
      const layer = (L.categoryLayer || {})[garment && garment.category];
      return typeof layer === "number" ? layer : 1;
    }

    function garmentRegions(garment) {
      const L = (CFG.wardrobe.layers || {});
      const category = garment && garment.category;
      // Categories that cover two different things are read by name: a
      // Sleepwear "pyjama top" is a torso garment and would otherwise be said
      // to cover her legs, hiding whatever is under them.
      if ((L.nameRegionCategories || []).includes(category)) {
        const hay = [garment.name, (garment.tags || []).join(" ")].join(" ").toLowerCase();
        const rule = (L.nameRegions || []).find(r => new RegExp(r.match, "i").test(hay));
        // Unrecognised underwear covers both, which hides it whenever she is
        // dressed. A garment missing from a picture is a smaller error than
        // one drawn over her clothes.
        return rule ? rule.regions : ["torso", "legs"];
      }
      const regions = (L.categoryRegions || {})[category];
      return Array.isArray(regions) ? regions : ["torso"];
    }

    // A garment is hidden when something on a higher layer covers a part of
    // the body it is on. Equal layers never hide each other: a shirt and jeans
    // are both worn, both visible.
    //
    // A garment only covers while it is where it should be. An open jacket
    // does not hide the shirt under it, a dress pushed aside does not hide the
    // bra, and jeans round her ankles do not hide anything at all — which is
    // the whole reason those pictures are worth making.
    function isGarmentCovered(garment, worn, states) {
      const st = states || {};
      const layer = garmentLayer(garment);
      const regions = garmentRegions(garment);
      if (!regions.length) return false; // shoes, accessories — nothing goes over them
      return worn.some(other => {
        if (!other || other.id === garment.id) return false;
        if (String(st[other.id] || "on").toLowerCase() !== "on") return false;
        if (garmentLayer(other) <= layer) return false;
        return garmentRegions(other).some(r => regions.includes(r));
      });
    }

    // The garments to send as reference images.
    //
    // states maps garment id to how it is being worn. Anything not simply "on"
    // — a shirt hanging open, jeans round her ankles, a bra pulled down — is
    // sent whatever is over it, because a garment out of position is exactly
    // the one the picture is about. That is also why the covering rule cannot
    // be the whole story: it assumes every garment sits where it should, and
    // undressing is the case where none of them do.
    function visibleWornGarments(worn, states) {
      const list = (worn || []).filter(Boolean);
      const st = states || {};
      return list.filter(g => {
        const status = String(st[g.id] || "on").toLowerCase();
        if (status !== "on") return true;
        return !isGarmentCovered(g, list, st);
      });
    }

    // Everything the app assembles a chat image prompt from, in one place, so
    // the lab and the app can never drift into building it differently.
    // charDesc is passed in already built (it comes from the appearance
    // sliders, which are not part of prompt assembly).
    function assembleImagePrompt({
      scenePrompt, charDesc, charOutfit, userOutfit, staging, nsfw,
      explicitDetail, messages, characterName, styleModifiers,
      contact: contactOverride, name, keepSceneVerbatim, viewerBody, viewerGender, viewerDesc, subjectNoun,
      garmentRefs, clothingState,
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
        pov: buildPovModifiers(scene, staging, nsfw, userOutfit, contact, viewerBody, viewerGender, viewerDesc),
        name: name || "",
        charDesc: charDesc || "",
        // Two ways to say what she has on, and only ever one of them.
        //
        // garmentRefs means her clothes are being sent as pictures, appended
        // to the reference image. Then the prompt must not describe them: the
        // model can see them, and words about colour and cut can only argue
        // with what it is looking at. All the prompt says is which references
        // are the clothes, plus whatever the conversation has done to them
        // since — hanging open, pushed up, taken off.
        //
        // Without garments it falls back to the tracked sentence, which is
        // all there was before the wardrobe existed and all there is for a
        // character with no closet.
        // The skin clause rides with the clothing in both forms, because the
        // problem is the same either way: the reference is nude and tattooed,
        // and whatever dresses her has to say that the ink goes under it. It
        // is worded to ask for nothing where no clothing covers her, so a nude
        // shot is unaffected even when a tracked outfit is still on record.
        wardrobe: garmentRefs
          ? joinPromptParts([CFG.wardrobe.chat.refClause, clothingState || "", CFG.wardrobe.chat.skinClause])
          : (charOutfit ? joinPromptParts([`wearing ${charOutfit}`, CFG.wardrobe.chat.skinClause]) : ""),
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
      // Clothing sits before the scene when it is words, and after it when it
      // is pictures.
      //
      // As words it is a short phrase that needs the weight an early position
      // gives it. As pictures it needs the opposite: the flat lays are already
      // the loudest thing in the call, and reading them out first as well cost
      // the act entirely — she was rendered standing and dressed, modelling
      // the clothes, in a scene that was nothing of the kind. Demoted to just
      // before the style, the references still dress her and the act leads.
      const subjectOrder = garmentRefs
        ? ["name", "charDesc", "staging", "scene", "explicit", "wardrobe", "style"]
        : ["name", "charDesc", "wardrobe", "staging", "scene", "explicit", "style"];
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
      appearancePhrasePreview, buildAppearancePrompt, appearanceWords, stripBodyMarks, pickFaceVariation,
      buildFacePrompt, buildFaceEditPrompt, faceFieldPhrase, isFaceUnset, isFaceStructureUnset,
      buildBodyBasePrompt, buildUploadBasePrompt, buildAvatarPrompt, buildExpressionPrompt, buildChatCharDesc, appearanceDiffKeys,
      pickExpressionReference,
      isUserUndressed, povSelfBody, isIntimateScene,
      garmentLayer, garmentRegions, isGarmentCovered, visibleWornGarments,
      beatShowsContact, detectPhysicalContact, stripViewerLimbs,
      buildPovModifiers, joinPromptParts, subjectFor, assembleImagePrompt,
      extractScene, parseSceneExtraction, viewerSexPhrase,
    };
  },
};
