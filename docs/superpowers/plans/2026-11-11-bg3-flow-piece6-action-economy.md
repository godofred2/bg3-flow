# Action economy (piece 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One action and one bonus action per turn for player characters (Extra Attack, off-hand and Action Surge understood), shown above the token as BG3's green dot and orange triangle.

**Architecture:** One new module `scripts/economy.js`: pure rules (`allowanceOf`, `costOf`, `canSpend`, `spend`), two Midi hooks (check in `midi-qol.preTargetingV2`, spend in `midi-qol.RollComplete`), a reset on turn change, and a PIXI layer drawn like the reach circle. State lives in a combatant flag.

**Tech Stack:** Foundry 14, dnd5e 6.0.6, Midi QOL 14.6.8, node:test.

**Spec:** docs/superpowers/specs/2026-11-11-action-economy-design.md

## Global Constraints

- Players blocked, GM warned, autopilot uses (midiOptions.targetUuids) skipped; off-turn uses never touched.
- Setting `actionEconomy`: players (default) | display | off. Lang en/es for every string.
- Tests: `timeout 100 node --test test/*.test.mjs`, all green before a commit; CRLF files; commit message in a file.

## Review Focus

- A player's second attack with Extra Attack must pass; a spell after an attack must not.
- An off-hand attack must spend the bonus action, not block on the action.
- A reaction (Shield) or an opportunity attack off turn must never be counted or blocked.
- Icons must leave the canvas on deleteCombat and follow a moving token.

---

### Task 1: rules and hooks (`scripts/economy.js`, `test/economy.test.mjs`)

- [ ] Failing tests for `allowanceOf`, `costOf`, `canSpend`/`spend` sequences (fighter 5 and 11, off-hand, Action Surge, bonus once), `onPreTargetingEconomy` (player blocked → false + warning; GM warned → undefined; off turn → undefined; targetUuids → undefined; setting display → never false), `onRollCompleteEconomy` (spends into the combatant flag; aborted → nothing; Action Surge grants).
- [ ] Implement; suite green; commit.

### Task 2: reset and icons

- [ ] Failing tests: `resetEconomy` on `combatTurnChange` unsets the flag for the new acting group (lead GM only) and on `combatStart` for everyone; `drawEconomy` draws a filled dot and triangle for an active visible token, hollow once spent, nothing without a combat.
- [ ] Implement with a PIXI layer like `drawReach`; hooks registered in `registerEconomy()`; commit.

### Task 3: wiring, docs, release

- [ ] Setting `actionEconomy` (choices), lang en/es, `registerEconomy()` from main's ready, README section, player guides, test guide section 4b (Y1-Y8), version 0.11.0, commit, tag, zip.
