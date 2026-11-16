# Game architecture (`web/`)

A single ES module, `web/game.js`, on three.js 0.160 (loaded from jsDelivr via an import map). No build step. It
reads the JSON/PNG/WAV files from `../export/`; if they're missing, the start screen says so.

## Startup
1. Fetch `world.json`, `chars.json`, `dialogue.json`, `waypoints.json` in parallel.
2. Build world meshes (Lambert material, alpha-tested where needed) and the **collision grid**.
3. **Calibrate** the skeleton on a throw-away character (see Animation).
4. Spawn the player and the cast, preload sound effects and barks, start the two arena duellists.
5. Click on the start screen → resume the AudioContext, start music, capture the mouse.

## Collision (`groundAt`, `pushOut`, `canStand`, `settle`)
Every opaque, non-portal world triangle is stored once and indexed in a 3 m XZ grid.

- **Ground**: the highest up-facing triangle (`n.y ≥ 0.45`) under a point and no higher than the feet plus step
  height (barycentric height in XZ).
- **Walls**: triangles with `|n.y| < 0.45` overlapping knee-to-head height. The closest point on each triangle to
  a capsule centre pushes the character out horizontally. Neighbouring cells are included near borders.
- **canStand** rejects a move with no ground, or with a floor between knee and head height (too-steep slope).
- **settle** applies gravity, but snaps to ground when walking downhill so characters don't bounce.

The camera uses a double-sided invisible copy of the world meshes to stop in front of walls.

## Characters (`class Char`)
Each character builds its own `THREE.Bone` hierarchy from `chars.bones` and a `SkinnedMesh` per body, head and
weapon part. Geometry is shared between characters; materials and skeletons are not. `body` is offset by
`feetOffset` (pelvis origin → feet on ground) and by `MODEL_YAW` (facing, derived from the toe bones). It must
have an up-to-date world matrix **before** `mesh.bind()`.

### Animation (procedural)
Each frame every bone resets to its bind rotation, then a few bones rotate about calibrated axes:
`rot(boneName, angle)` with `angle > 0` meaning "child moves forward".

Calibration tries the bone's local X/Y/Z axes, measures which one moves the child joint furthest along the model's
forward direction, and records that axis and its sign. This avoids hard-coding Gothic's bone orientations.

| State | What moves |
|---|---|
| walk / run | thighs swing in antiphase, knees bend on the back-swing, arms counter-swing, slight lean |
| weapon drawn | right arm raised and elbow bent |
| attack (0.7 s) | wind-up overhead → strike down with forward lean; the hit test happens at 0.34 s |
| block | sword arm raised across the body |
| talk / cheer / hurt | gestures / both arms up / lean back |
| dead | root tips over (YXZ euler) |

## Combat
- `strike()`: everyone within 2.3 m and ~66° in front of the attacker takes damage.
- **Blocking** while facing the attacker cuts damage to 15% and plays a metal clang instead of a hit.
- Hitting a neutral NPC makes it hostile; spectators near a fight cheer (voice barks).
- The two duellists fight each other forever. When one falls, the duel restarts after 9 s. Other NPCs get back up
  after 20 s. The player gets up with **R**.

## NPC AI (`aiStep`)
| Duty | Behaviour |
|---|---|
| `duel` | fights its assigned opponent in the arena pit |
| `watch` | faces the arena, cheers occasionally and when blows land |
| `idle` | wanders within 3 m of its post |
| any, hostile | chase (walk/run), attack with cooldown, random blocks, back off when too close |

## Dialogue
Press **E** near a non-hostile NPC. The menu lists that NPC's topics (labelled by the hero's opening line), an
optional challenge to fight, and Goodbye. Picking a topic plays each line's original voice WAV with a subtitle, one
after another, then returns to the menu. Keys **1–7** or clicks pick options.

## Audio
- **Positional** sound effects and barks: `THREE.PositionalAudio`, one per sound, removed when it ends.
- **Voice**: one non-positional `THREE.Audio`; a new line stops the previous one.
- **Music**: two looping buffers, `oc_std` and `oc_fgt`, with an equal-power crossfade driven by `intensity`, which
  eases toward 1 while any NPC is hostile. If the files are missing, a small procedural score plays instead.
- Volumes: **Music** slider → music gain node; **Effects & voices** slider → `AudioListener` master volume.

## Pause menu
**Esc** (the browser releases the mouse, and `pointerlockchange` opens the menu) or **P**. While paused the world
is frozen (render only). The menu has the controls legend, both volume sliders, Resume and Restart arena.

## Debug hooks
Used by the Playwright screenshot scripts:

| Hook | Effect |
|---|---|
| `?auto=1` | skip the start screen |
| `window.__game` | `{ player, npcs, camera, scene, THREE, yaw, pitch, CAL, startDuel }` |
| `window.__freezeAI = true` | stop NPC AI and physics (for posed screenshots) |
| `window.__dbgCam = { pos, target }` | override the camera |

Headless Chrome renders in software at about 3 fps, and the simulation clamps `dt` to 50 ms, so headless runs
play in slow motion. That's fine for still frames, but not for judging how smooth play feels.
