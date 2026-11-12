// Pure decision logic. No Foundry globals here so it runs under `node --test`.

/** "14.6.5" -> [14, 6]; null/undefined -> null */
function majorMinor(version) {
  if (typeof version !== "string") return null;
  const [maj, min = 0] = version.split(".").map(Number);
  return Number.isFinite(maj) ? [maj, Number.isFinite(min) ? min : 0] : null;
}

function atLeast(version, [maj, min]) {
  const v = majorMinor(version);
  return !!v && (v[0] > maj || (v[0] === maj && v[1] >= min));
}

/**
 * @param {{dnd5e: string|null, midi: string|null, libWrapper: boolean, socketlib: boolean}} deps
 * @returns {{ok: boolean, missing: string[]}}
 */
export function depsOk({ dnd5e, midi, libWrapper, socketlib }) {
  const missing = [];
  if (!atLeast(dnd5e, [6, 0])) missing.push("dnd5e >= 6.0");
  if (!atLeast(midi, [14, 6])) missing.push("midi-qol >= 14.6");
  if (!libWrapper) missing.push("lib-wrapper");
  if (!socketlib) missing.push("socketlib");
  return { ok: missing.length === 0, missing };
}

const FAST_FORWARD_ALL = Object.freeze(["attack", "damage", "check", "save", "skill", "tool"]);

/** Midi QOL ConfigSettings values for the BG3 preset (see spec, Feature 1). */
export const MIDI_PRESET = Object.freeze({
  autoRollAttack: true,
  gmAutoAttack: true,
  autoRollDamage: "onHit",
  gmAutoDamage: "onHit",
  autoFastForward: FAST_FORWARD_ALL,
  gmAutoFastForward: FAST_FORWARD_ALL,
  autoCheckHit: "all",
  autoCheckSaves: "allShow",
  autoApplyDamage: "yes",
  playerRollSaves: "nonePublic",
  rollNPCSaves: "auto",
  autoTarget: "wallsBlock",
  gmAttackDisplay: "full",
  gmDamageDisplay: "full",
  gmAttackDsn: "show",
  gmDamageDsn: "show",
  // Reactions: same keys as Midi's own "Turn on Reaction processing" quick setup.
  doReactions: "all",
  gmDoReactions: "all",
  reactionTimeout: 30,
  showReactionAttackRoll: "all",
  enforceReactions: "all",
  recordAOO: "all",
  autoItemEffects: "applyRemove", // a reaction's effect (Shield +5 AC, Uncanny Dodge half damage) applies itself
  optionalRules: Object.freeze({ hiddenAdvantage: "effect" }) // the Hiding status (bg3-flow's Hide) gives the attack advantage; Midi's default only asks whether the target can see the attacker
});

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
/** Copy of `current` with `preset` keys overriding. Keys Midi does not know (absent from `current`) are skipped; a nested object (optionalRules) merges into Midi's. */
export function mergePreset(current, preset) {
  const out = { ...current };
  for (const [k, v] of Object.entries(preset)) {
    if (!(k in current)) continue;
    out[k] = Array.isArray(v) ? [...v] : isObj(v) && isObj(current[k]) ? { ...current[k], ...v } : v;
  }
  return out;
}

/** Preset keys that the installed Midi config does not have. */
export function presetUnknownKeys(current, preset) {
  return Object.keys(preset).filter((k) => !(k in current));
}

// ---- Friend-or-foe prompt (Feature 1) ----
// A "target" here is {id, name, disposition}; disposition is the token's CONST.TOKEN_DISPOSITIONS number.

/** Prompt for choice-enabled areas only; Midi honours the flag only when the activity also has a template. */
export function shouldPrompt({ choice, templateType }) {
  return choice === true && !!templateType;
}

/** Allies share the caster's disposition. The caster's own token is never an ally here: self effects must stay. */
export function splitTargets(casterDisposition, targets, casterId = null) {
  const friends = [], foes = [];
  for (const t of targets) (t.disposition === casterDisposition && t.id !== casterId ? friends : foes).push(t);
  return { friends, foes };
}

/** @param {{choice: "enemies"|"everyone", friends, foes}} _ @returns targets to keep */
export function applyChoice({ choice, friends, foes }) {
  return choice === "enemies" ? [...foes] : [...foes, ...friends];
}

/** Midi regionActivity dispositionFilter: -1 enemies, 0 all, 1 allies. null = leave untouched. */
export function dispositionFilterFor(choice) {
  if (choice === "enemies") return -1;
  if (choice === "everyone") return 0;
  return null;
}

// ---- Turn flow (Feature 2) ----
// A "turn" entry here is {id, side}; side is the token disposition number. Groups are derived, never stored.

/** Runs of 2+ consecutive combatants on the same side, in turn order. No wrap across the round boundary. */
export function groupBySide(turns) {
  const groups = [];
  let run = [];
  const flush = () => { if (run.length >= 2) groups.push({ side: run[0].side, ids: run.map((t) => t.id) }); run = []; };
  for (const t of turns) {
    if (run.length && run[0].side !== t.side) flush();
    run.push(t);
  }
  flush();
  return groups;
}

export function groupOf(groups, id) {
  return groups.find((g) => g.ids.includes(id)) ?? null;
}

/** First index at or after `from` (wrapping once) whose combatant is live, honouring Foundry's skipDefeated. */
function firstLive(turns, from, skipDefeated) {
  for (let i = from; i < turns.length; i++) if (!skipDefeated || !turns[i].defeated) return i;
  return null;
}

/**
 * Where the turn pointer should land instead of turn±1, or null to leave Foundry's choice alone.
 * Forward: first live index after the current combatant's group (wrapping to the next round's first live index).
 * Backward: first live member of the group that contains turn-1.
 */
export function jumpTurn({ turns, groups, turn, direction, skipDefeated = false }) {
  if (direction > 0) {
    const g = groupOf(groups, turns[turn]?.id);
    if (!g) return null;
    const last = turns.findIndex((t) => t.id === g.ids.at(-1));
    const next = firstLive(turns, last + 1, skipDefeated);
    return next !== null ? { turn: next, roundDelta: 0 } : { turn: firstLive(turns, 0, skipDefeated) ?? 0, roundDelta: 1 };
  }
  const g = groupOf(groups, turns[turn - 1]?.id);
  if (!g) return null;
  const first = turns.findIndex((t) => t.id === g.ids[0]);
  return { turn: firstLive(turns, first, skipDefeated) ?? first, roundDelta: 0 };
}

/** True when turns[turn] is the member of its group that acts first (the first live one when skipDefeated). */
export function isGroupStart(groups, turns, turn, skipDefeated = false) {
  const id = turns[turn]?.id;
  const g = id ? groupOf(groups, id) : null;
  if (!g) return false;
  const first = turns.findIndex((t) => t.id === g.ids[0]);
  return (firstLive(turns, first, skipDefeated) ?? first) === turn;
}

/** dnd5e ruler rule: the action's speed, walk as floor when the action falls back to walk; doubled by Dash. */
export function speedLimit({ speeds, action, walkFallback, dash }) {
  if (!speeds) return 0;
  let speed = speeds[action] ?? 0;
  if (walkFallback) speed = Math.max(speed, speeds.walk ?? 0);
  return speed * (dash ? 2 : 1);
}

/** A limit of 0 means "unknown speed", which never blocks. */
export function canMove({ spent, cost, limit }) {
  if (limit > 0 && spent + cost > limit + 1e-6) return { ok: false, reason: "budget" };
  return { ok: true, reason: null };
}

// ---- Feature 3: encounters and stealth ----

/** BG3 obscurity at a point: 0 clear, 1 lightly obscured (dim light), 2 heavily obscured (unlit darkness), 3 magical darkness (a darkness source). */
export function obscurity({ dark, bright, dim, darknessSource }) {
  if (darknessSource) return 3;
  if (!dark || bright) return 0;
  return dim ? 1 : 2;
}

/** BG3 sight: an unhidden creature is seen on sight. A hidden one is seen in the clear, must beat passive Perception
 *  in dim light (meeting it stays hidden) and is unseen in darkness. Darkvision in range lowers the level one step,
 *  but not inside magical darkness. */
export function spotsBg3({ hidden, level, los, passive, stealth, darkvision = false }) {
  if (!los) return false;
  if (!hidden) return true;
  if (level >= 3) return false;
  const l = Math.max(0, level - (darkvision ? 1 : 0));
  return l === 0 || (l === 1 && passive > stealth);
}

/** Marked tokens grouped by encounter id (unmarked tokens skipped). */
export function encounterGroups(tokens) {
  const groups = new Map();
  for (const t of tokens) {
    const id = t.flags?.["bg3-flow"]?.encounter?.id;
    if (id) (groups.get(id) ?? groups.set(id, []).get(id)).push(t);
  }
  return groups;
}

export const withinRadius = (distance, radius) => distance <= radius;
