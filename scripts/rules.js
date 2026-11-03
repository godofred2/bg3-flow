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
  gmDamageDsn: "show"
});

/** Copy of `current` with `preset` keys overriding. Keys Midi does not know (absent from `current`) are skipped. */
export function mergePreset(current, preset) {
  const out = { ...current };
  for (const [k, v] of Object.entries(preset)) {
    if (k in current) out[k] = Array.isArray(v) ? [...v] : v;
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
