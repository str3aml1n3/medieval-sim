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
gamma-space modulation; `MIN_LIGHT` adds Gothic's ambient floor and `LIGHT_GAIN` scales the result. The
**brightness** setting (pause menu, default 1.6) divides the 2.2 gamma of that conversion, which brightens shadows
and hut interiors much more than sunlit ground; changing it rewrites the vertex colours in place (`setBrightness`). Alpha textures (foliage, fences) are alpha-tested and double-sided; decals blend like
Gothic's alpha functions (additive, multiply ×2, alpha blend); water is translucent. Textures use the GPU's maximum
anisotropic filtering, since most ground is seen at grazing angles. Fog hides the edge of the exported square.

The **sky** is Gothic's day sky: a dome following the camera whose shader projects two slowly scrolling layers onto
a flat sky plane: `SKYDAY_LAYER0` tinted sky blue as the base, `SKYDAY_LAYER1`'s alpha clouds over it, fading into the
fog colour at the horizon. The `UNSUN5` sun sprite sits in the direction of the sun light.

Characters use Lambert materials lit by a hemisphere light + sun, and are **tinted by the baked light of the floor
triangle they stand on**, so they darken indoors. Like in Gothic, each character casts a **blob shadow**: a soft dark
disc on the floor triangle below it, tilted to its slope, fading and growing while the character is in the air. The 7 dynamic light vobs (torches, fires) become flickering point
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
| jump | Alt or V | moving forward: `T_RUNL_2_JUMP` → `S_JUMP` → `T_JUMP_2_STAND`; standing: `T_STAND_2_JUMPUP` → `S_JUMPUP` → `S_FALLDN` → `T_FALLDN_2_STAND` |

**Jumping and falling.** A jump launches the character ballistically (`air`, gravity 14 m/s², 4.6–5 m/s up, 5 m/s
forward from a run, 3.2 from a walk); horizontal movement still goes through the wall collision, and it lands when
the feet reach a floor again (`settle` → `landed`). Clips flagged `fixY` keep the standing root height, so the arc
comes from the physics and not twice from the clip. Still holding forward after a running jump goes straight back
into the run. Walking off a ledge switches to `S_FALLDN` after 0.3 s in the air and plays `T_FALLDN_2_STAND` on
landing.

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

## Bows and crossbows
Gothic's loadout from the scripts: Thorus (two-handed sword) and Fletcher carry a light crossbow with 30 bolts,
Whistler a rider's bow with 10 arrows; the player has a guard's light crossbow with 30 bolts (dexterity 50). On the
back they hang at `ZS_CROSSBOW` / `ZS_BOW`; drawn (Gothic's `T_MOVE_2_BOWMOVE` / `T_MOVE_2_CBOWMOVE`, keys **1** / **2**)
a bow sits in the left hand and a crossbow in the right, as Gothic binds them, and a bow shows its nocked arrow.

A shot raises the weapon (`T_xRUN_2_xAIM`), holds the aim pose (`C_x_5`), releases (`S_xSHOOT`) and reloads
(`T_xRELOAD`, the next arrow appears at its `MUNITION_PLACE` frame). Rules as OpenGothic implements Gothic 1: the
projectile flies at 30 m/s under gravity, aimed at the target's centre with the arc compensated; the hit chance is
100 % up close, the shooter's dexterity % at 20 m and nothing beyond 45 m (a miss is shot off to the side); a hit
does the weapon's damage minus the target's protection against arrows (`point`); shots can't be parried. Anyone in
the way is hit too; projectiles stick in walls. NPCs with ammunition and a clear line of sight shoot from beyond 7 m
and switch to their melee weapon closer than 4.5 m.

## Fire, smoke, torches; the sun
Fires, smoke, wall torches, embers and bubbling cauldrons are Gothic's particle effects: export_world.py collects the
`.PFX` vobs (FIRE, FIRE_SMOKE, TORCH, COALGLOW, FIRE_MEDIUM, CAULDRON_BUBBLES) and their settings from
PARTICLEFX.DAT (emission rate, lifetime, emitter shape, direction and speed, gravity, size growth, colour and alpha
over life, additive or blended, texture), converted to metres and seconds. The game runs them as camera-facing
points for the emitters within 45 m of the camera. Fire light vobs still light the scene and flicker, without the
old flat glow blob. The sun (`UNSUN5`) is drawn with the sky, so the world covers it.

## Sitting
Every chair, bench and throne (Gothic mob models) brings its seat slots (`ZS_POS*` nodes): where the sitter ends up
and which way he faces. Near a free slot in front of the hero (weapon sheathed) the action key / E sits down with the
human model's own clips (`T_x_STAND_2_S0` -> `T_x_S0_2_S1` -> `S_x_S1`; chairs add `R_CHAIR_RANDOM_*` fidgets); any
movement or the action key plays them backwards. Their root carries the step onto the seat, so it is drawn rather than
moving the character. Idle NPCs (Snaf) start on the seat at their post, get up after a while, and sit down on free
seats near home now and then; a hit gets them up.

## NPC AI (`aiStep`)
| Duty | Behaviour |
|---|---|
| `duel` | Kharim and Gor Hanis (Gothic's arena fighters, an even match) fight in the pit; 4 s after both are up again they restart |
| `watch` | face the pit in `S_WATCHFIGHT`, random gestures, cheer/groan + bark when blows land |
| `guard` | Thorus stands in `S_HGUARD` |
| `idle` | Snaf wanders within 3 m of his post (walking) |
| hostile | run in, attack (forward combos, side swings), parry or jump back from incoming blows (chance = `skill`), strafe |

**Perception** of the hero: noise radius by gait (run 7 m, walk 2.5 m, sneak 0, attacking 10 m) and a forward sight
cone (9 m). Heard/seen → the NPC turns to look. Sneaking in view → *"What are you doing?"*. A drawn weapon in view
→ *"Weapon down!"*, *"I said weapon down!"*; guards then attack (*"You asked for it"*).

## Dialogue and the story
Talk with the action key (or **E**) near a non-hostile NPC with your weapon sheathed. The choices are that NPC's
topics, an optional challenge to fight, and Goodbye. Lines show a subtitle and play their voice file; the NPC
gestures with the dialogue gesture clips. Arrows + Enter, **1–7** or clicks pick; right click skips a line.

The topics are an authored story, **"The Fixed Fight"** (`dialogue/arena.json`, original writing), not Gothic's own
conversations. Like Gothic's info conditions, a topic shows while its conditions hold (`cond.has` / `cond.not` flags)
and, unless `once: false`, until it has been heard. When it ends it can set flags, add a journal entry, give ore, and
trigger an effect: `fight` (this NPC attacks), `hostile:ID` (another NPC attacks after the talk), `weaken:ID:N`
(lower an NPC's strength). `{ID}` in a text becomes that NPC's name, so the stand-in cast uses the same story.

The plot: Bloodwyn keeps the arena's betting book, is deep in debt, has bet on Kharim and paid Snaf to spike Gor
Hanis's stew. Kirgo and Fletcher hint at it, Whistler sells the truth. The hero can dump the stew (Snaf), warn Gor
Hanis, and report Snaf's confession to Thorus (100 ore; Bloodwyn attacks), or take Bloodwyn's 50 ore and serve the
stew (Gor Hanis really fights weakened). Topics about the camp, the Barons, the New Camp and the Brotherhood carry the
world-building. The pause menu's **Journal** lists the quest entries and the hero's ore. Story state lives in memory
for the session.

Voices: `export_voice_refs.py` takes clips of each character's own original lines from your Gothic install, and
`tools/voice/synth_voices.py` synthesises every story line with XTTS-v2 conditioned on them, to
`export/audio/VO_<NPC>_<TOPIC>_<NN>.wav`. Both stay local (git-ignored). Without the files, each line shows for 1.5 s.

## Audio
- **Positional** effects and barks (`THREE.PositionalAudio`): footsteps by ground material and gait, Gothic's
  weapon-on-flesh / weapon-on-weapon collision sounds, body fall, a synthesised sword whoosh.
- **Voice**: one non-positional `THREE.Audio`; a new line stops the previous one.
- **Music**: like Gothic, one theme at a time: the camp theme `oc_std`, or the fight theme `oc_fgt` while an NPC
  is fighting the hero (watching the arena duel doesn't count). It switches to fight music at once and back to calm
  after 6 s of peace, with a short crossfade. A hidden browser tab suspends all audio, so two open tabs never play
  over each other. Procedural fallback if the WAVs are missing.

## HUD (Gothic's own graphics)
Text is drawn in Gothic's bitmap fonts: `setText(el, [[text, font], …], maxWidth)` lays glyphs out from
`ui/fonts.json` onto a canvas (word-wrapped, centred), scaled with the window height like Gothic scales its
800×600 UI. `FONT_OLD_10_WHITE` for names, prompts, subtitles and dialogue choices (the hovered choice and the
speaker's name use the `_HI` variant), `FONT_OLD_20_WHITE` for messages and titles. Health bars are `BAR_BACK` with
`BAR_HEALTH` inset into it: the hero's at the bottom left, the focused opponent's at the top. Without `ui/` (an older
export) the text falls back to plain CSS. The pause-menu legend is still CSS text.

## Pause menu
**Esc** (the browser releases the mouse, and `pointerlockchange` opens the menu) or **P**. While paused the world
is frozen. The menu has the controls legend, volumes, brightness, mouse speed, the current one-handed talent, Resume and
Restart.

## Debug hooks
| Hook | Effect |
|---|---|
| `?auto=1` | skip the start screen |
| `window.__game` | `{ player, npcs, camera, scene, THREE, CLIPS, PIT, yaw, pitch, sneak, theme, startAttack, parade, jump, jumpBack, toggleWeapon, actionInput, setStyle, setBrightness, hurt, knockDown, startDuel }` |
| `window.__freezeAI = true` | stop NPC AI and physics (for posed screenshots) |
| `window.__dbgCam = { pos, target }` | override the camera |
