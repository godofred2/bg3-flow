# Action economy (piece 6) — design

Date: 2026-11-11. Requested after the v0.10.0 target picker: "it is not limiting the actions a player can do on a turn, so there must be something to show the action and bonus action, like the green dot and orange triangle in Baldur's Gate".

## What the table gets

- Each combatant has, per turn of its group: one **action**, one **bonus action**, its movement (piece 2) and its reaction (Midi enforces it already, preset `enforceReactions: all`).
- **Extra Attack**: a creature with a feature named *Extra Attack* (or *Ataque extra/adicional*) makes 2 weapon attacks inside its action (3 with 11 fighter levels, 4 with 20). Once it has attacked, its action is the Attack action: no spell or other action-type use on top. Any non-attack action use spends the whole action.
- **Off-hand attack**: an attack rolled in dnd5e's *offhand* mode (two-weapon fighting) spends the bonus action, not an attack of the action (user decision).
- **Action Surge** (*Acción impetuosa*): using it grants one extra action this turn (a fresh action: attacks count from zero again).
- Everything else is free: reactions (Midi's), legendary and lair (the DM's / piece 5), activation "none", special, minute/hour/day.
- **Who is blocked** (user decision): player characters. A player whose action is spent gets "X has no action left this turn" and the use is dropped before anything is spent. The GM is only warned and goes ahead (the referee improvises). Monsters on the autopilot are never checked: the planner spends one action and one bonus action by itself (Multiattack is several attack uses).
- **Shown on the map** (user decision: on the token, Argon's HUD for detail): above every token of the acting group, a **green dot** (action) and an **orange triangle** (bonus action), filled while available, hollow grey once spent. Seen by whoever sees the token, like the reach circle. Reset when the group's turn starts and at combat start.
- Setting *Action economy*: `players` (default: players blocked, GM warned), `display` (icons only), `off`.

## Mechanics

- State per combatant, flag `bg3-flow.economy = { attacks, action, bonus, extra }`: attacks made inside the current action, whether a non-attack action was used, whether the bonus action was used, extra actions granted (Action Surge).
- Cost of a use: from `activity.activation.type` and, after the roll, `workflow.attackMode`: `attack` (action-type attack activity), `action` (any other action-type activity), `bonus`, `free`. Before the roll the attack mode is unknown: an attack is allowed if either an attack of the action or the bonus action is free.
- Check in `midi-qol.preTargetingV2` (false aborts the use, nothing spent); spend in `midi-qol.RollComplete` (not aborted). Only for combatants in the acting group (`activeIds`): an off-turn use is a reaction or an opportunity attack, Midi's business. Uses that bring their own targets (the autopilot's `midiOptions.targetUuids`) and combatants on the autopilot are skipped.
- Reset on `combatTurnChange` for the new acting group and on `combatStart`, by the lead GM.
- Icons: a PIXI layer like the reach circle, redrawn on the same hooks plus `updateCombatant` (the flag) and `refreshToken` position changes. Drawn with the PIXI 7 API too: Foundry 14.369 ships PIXI 7.4.3 (v0.11.1).

## Amendments (v0.11.1, after the v0.11.0 web run)

- The pre-roll "it may be the off-hand swing" allowance applies only to a weapon whose `attackModes` offer *offhand* (light weapons); a Longsword with the action gone is refused. Such a swing, once rolled in any mode with the action gone, costs the bonus action.
- `spend` never goes negative: what cannot be paid (the GM going ahead) leaves the state spent as it is.
- Attacks are paid at `midi-qol.AttackRollComplete` (mode from `workflow.attackMode` or dnd5e's `attackRoll.options.attackMode`), once per workflow; the rest at `RollComplete`.
- The economy check is registered before the target picker, so a refusal comes before any pick.
- v0.11.2: the icon layer has zIndex 300 (canvas.interface sorts by zIndex; the TokenLayer is 200); non-attack uses are paid at `dnd5e.postUseActivity` (the card), whose `usageConfig.workflow` is Midi's workflow; a light weapon refused with the bonus action spent says "no bonus action left".

## Out of scope

- The bonus-action-spell rule (no leveled spell after a bonus action spell), Ready, Haste's extra action, the 2024 rules' changes to Extra Attack. Monsters played by hand by the DM are only warned.
