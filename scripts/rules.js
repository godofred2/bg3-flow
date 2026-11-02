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
