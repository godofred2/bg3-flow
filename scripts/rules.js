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
  hideRollDetails: "none"
});

/** Shallow copy of `current` with `preset` keys overriding; unknown keys in `current` survive. */
export function mergePreset(current, preset) {
  const out = { ...current };
  for (const [k, v] of Object.entries(preset)) out[k] = Array.isArray(v) ? [...v] : v;
  return out;
}
