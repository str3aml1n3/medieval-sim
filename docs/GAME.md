# Game architecture (`web/`)

A single ES module, `web/game.js`, on three.js 0.160 (loaded from jsDelivr via an import map). No build step. It
reads the JSON/BIN/PNG/WAV files from `../export/`. If they're missing or from an older export, the start screen says so.

## Startup
1. Fetch `world.json` + `world.bin`, `chars.json`, `anims.json`, `dialogue.json`, `waypoints.json` in parallel.
2. Build world meshes and the **collision grid**.
3. Pose a throw-away character in Gothic's standing clip to find `FOOT_ADJ` (soles on the ground).
4. Spawn the player and the cast, preload sound effects and barks, start the arena duel.
5. Click on the start screen → resume the AudioContext, start music, capture the mouse.

## World rendering
Each world mesh is `MeshBasicMaterial` with **vertex colours**: Gothic's baked light (per-vertex light, or a
lightmap sampled at export). The bytes are converted from sRGB to linear so that texture × light matches Gothic's
gamma-space modulation; `MIN_LIGHT` adds Gothic's ambient floor so hut interiors stay readable, and `LIGHT_GAIN`
scales the result. Alpha textures (foliage, fences) are alpha-tested and double-sided; decals blend like
Gothic's alpha functions (additive, multiply ×2, alpha blend); water is translucent. Textures use the GPU's maximum
anisotropic filtering, since most ground is seen at grazing angles. A gradient sky dome follows the camera; fog hides the edge of the exported square.

Characters use Lambert materials lit by a hemisphere light + sun, and are **tinted by the baked light of the floor
triangle they stand on**, so they darken indoors. The 7 dynamic light vobs (torches, fires) become flickering point
lights + glow sprites.

## Collision (`groundAt`, `pushOut`, `canStand`, `settle`, `segCast`)
Opaque world triangles and props flagged `cd_dynamic` are stored once and indexed in a 3 m XZ grid (doors, decals,
door curtains, water and foliage are excluded). Each triangle keeps its baked light colour and a footstep material
(earth/wood/stone/sand, guessed from the texture name).

- **Ground**: the highest up-facing triangle (`n.y ≥ 0.45`) under a point, no higher than the feet + step height.
- **Walls**: triangles with `|n.y| < 0.45` overlapping knee-to-head height push the character out horizontally.
- **canStand** rejects a move with no ground, or with a floor between knee and head height (too-steep slope).
- **settle** applies gravity, but snaps to ground when walking downhill so characters don't bounce.
- **segCast** (camera): segment vs. triangles from the grid cells along it; the camera stops in front of walls.

## Characters (`class Char`)
Each character builds its own `THREE.Bone` hierarchy from `chars.bones` and a `SkinnedMesh` per body and head part.
The weapon is a plain mesh parented to a slot bone: `ZS_SWORD` (hip) when sheathed, `ZS_RIGHTHAND` when drawn.

### Animation (Gothic's own clips)
`anims.json` holds per-frame local bone rotations and the root (`BIP01`) translation of each clip.

- **Base layer** (`play`): one full-body clip, looping or one-shot, optionally reversed (Gothic plays e.g. walking
  backwards as the walk clip in reverse), cross-faded from the previous pose (`slerpFlat` per bone).
- **Overlay layer** (`overlay`): a partial clip mixed onto its own bones with a short fade in/out: drawing the
  weapon while moving, spectators' cheering gestures, dialogue gestures.
- **Root height** comes from the clip (crouched sneaking, falling down). **Root motion** (horizontal root
  translation) moves the character for attacks, jump back and stumbles (`rm: true`) through the normal collision.
  Locomotion moves at the clip's measured root speed, so feet don't slide.

Fighting talent (`style`) selects clips: `''` = untrained (base `HUMANS.MDS`), `1HST1` / `1HST2` = the trained and
master overlay scripts, which replace the attack, parade and stance clips.

## Movement
| Gait | Key | Speed (from the clip's root motion) |
|---|---|---|
| run | default | 3.45 m/s (`S_RUNL`) |
| walk | hold Shift | 1.43 m/s (`S_WALKL`), 1.95 m/s weapon drawn |
| sneak | toggle C | 0.77 m/s (`S_SNEAKL`), 1.17 m/s weapon drawn |
| back | S | walk clip reversed; with a weapon drawn, S is a jump back (`T_1HPARADEJUMPB`) |
| strafe | A / D | `T_*STRAFEL/R` clips |

The mouse turns the hero (Gothic's mouse control); the camera is rigidly behind him, its pivot only smoothed
vertically. Mouse deltas above 300 px/event are dropped (a Chrome-on-Windows pointer-lock glitch) and pointer lock
asks for unaccelerated movement. Mouse speed is a pause-menu slider (stored in `localStorage`).

## Combat (Gothic 1 rules)
- **Attacks**: forward = `S_1HATTACK` (a combo clip), left/right = `T_1HATTACKL/R`. Event frames from the model
  script drive everything: the blow lands at `OPTIMAL_FRAME`, the segment ends at `HIT_END`, and an attack input
  inside `COMBO_WINDOW` chains the next segment. Input **before** the window breaks the combo (button mashing
  doesn't work, as in Gothic). Untrained: 1 hit that repeats; trained/master: 4-hit chains.
- **Hit test** at the optimal frame: within 2.1 m, ~57° cone for forward swings, wider for side swings. The swing
  start turns the fighter toward the focused enemy.
- **Parade** (`T_1HPARADE_O`): blocks a blow from the front completely (metal clash) and breaks the attacker's combo.
- **Damage** = strength + weapon damage − armour protection (minimum 1). Hits play `T_STUMBLE` / `T_STUMBLEB`
  (hit from behind), which interrupts the victim.
- **Knock-out**: at 1 HP a human goes down unconscious (`T_STAND_2_WOUNDED` → `S_WOUNDED`) instead of dying, as in
  Gothic's arena fights. NPCs get up after 12–16 s; the player with R (or after 8 s).
- **Focus**: the NPC in front of the hero; its name floats above it, its health shows at the top while fighting.

## NPC AI (`aiStep`)
| Duty | Behaviour |
|---|---|
| `duel` | Kirgo and Whistler fight in the pit; 4 s after both are up again they restart |
| `watch` | face the pit in `S_WATCHFIGHT`, random gestures, cheer/groan + bark when blows land |
| `guard` | Thorus stands in `S_HGUARD` |
| `idle` | Snaf wanders within 3 m of his post (walking) |
| hostile | run in, attack (forward combos, side swings), parry or jump back from incoming blows (chance = `skill`), strafe |

**Perception** of the hero: noise radius by gait (run 7 m, walk 2.5 m, sneak 0, attacking 10 m) and a forward sight
cone (9 m). Heard/seen → the NPC turns to look. Sneaking in view → *"What are you doing?"*. A drawn weapon in view
→ *"Weapon down!"*, *"I said weapon down!"*; guards then attack (*"You asked for it"*).

## Dialogue
Press **E** near a non-hostile NPC with your weapon sheathed. The menu lists that NPC's topics (labelled by the
hero's opening line), an optional challenge to fight, and Goodbye. Lines play their original voice WAV with a
subtitle; the NPC gestures with Gothic's dialogue gesture clips. Keys **1–7** or clicks pick options.

## Audio
- **Positional** effects and barks (`THREE.PositionalAudio`): footsteps by ground material and gait, Gothic's
  weapon-on-flesh / weapon-on-weapon collision sounds, body fall, a synthesised sword whoosh.
- **Voice**: one non-positional `THREE.Audio`; a new line stops the previous one.
- **Music**: `oc_std` and `oc_fgt` crossfaded by combat intensity; procedural fallback if missing.

## HUD (Gothic's own graphics)
Text is drawn in Gothic's bitmap fonts: `setText(el, [[text, font], …], maxWidth)` lays glyphs out from
`ui/fonts.json` onto a canvas (word-wrapped, centred), scaled with the window height like Gothic scales its
800×600 UI. `FONT_OLD_10_WHITE` for names, prompts, subtitles and dialogue choices (the hovered choice and the
speaker's name use the `_HI` variant), `FONT_OLD_20_WHITE` for messages and titles. Health bars are `BAR_BACK` with
`BAR_HEALTH` inset into it: the hero's at the bottom left, the focused opponent's at the top. Without `ui/` (an older
export) the text falls back to plain CSS. The pause-menu legend is still CSS text.

## Pause menu
**Esc** (the browser releases the mouse, and `pointerlockchange` opens the menu) or **P**. While paused the world
is frozen. The menu has the controls legend, volumes, mouse speed, the current one-handed talent, Resume and Restart.

## Debug hooks
| Hook | Effect |
|---|---|
| `?auto=1` | skip the start screen |
| `window.__game` | `{ player, npcs, camera, scene, THREE, CLIPS, PIT, yaw, pitch, sneak, startAttack, parade, jumpBack, toggleWeapon, actionInput, setStyle, hurt, knockDown, startDuel }` |
| `window.__freezeAI = true` | stop NPC AI and physics (for posed screenshots) |
| `window.__dbgCam = { pos, target }` | override the camera |
