# Asset pipeline

The game ships **no Gothic assets**. Everything it loads from `export/` is extracted from your own Gothic 1
install by the scripts in this repo. `export/` is git-ignored and is never committed or deployed.

```
Gothic install                    scripts                       export/
─────────────────────────────     ───────────────────────────   ──────────────────────────────
Data/*.VDF ─┬─ WORLD.ZEN ───────► export_world.py ─────────────► world.json, world.bin, tex/*.png
            │                   ► export_wp.py ────────────────► waypoints.json
            ├─ HUMANS.MDH, *.MDM, *.MMB, *.MRM ► export_chars.py ► chars.json, tex/*.png
            ├─ HUMANS*.MDS, HUMANS*-*.MAN ─► export_anims.py ─────────────► anims.json
            ├─ FONT_OLD_*.FNT, BAR_*.TEX, SKYDAY_*.TEX ► export_ui.py ─────► ui/fonts.json, ui/*.png
            └─ SOUND/*.WAV ─────┐
_work/Data/scripts/_compiled/   │
   OUINFO.INF ─────────────────► export_lines.py ─────────────► all_lines.json
                                └► export_audio.py ────────────► audio/*.wav, dialogue.json
_work/Data/Music/orchestra/ ───► tools/render + export_music.py ► music/oc_std.wav, oc_fgt.wav
```

## Requirements

| Need | For | Install |
|---|---|---|
| Gothic 1 (Steam/GOG) | source data | — |
| Python 3.11+ | all `export_*.py` | `winget install Python.Python.3.13` |
| `zenkit`, `pillow`, `numpy` | reading Gothic formats, PNG, audio maths | `pip install zenkit pillow numpy` |
| CMake, Ninja, C11 compiler | music renderer only | `winget install Kitware.CMake Ninja-build.Ninja BrechtSanders.WinLibs.POSIX.UCRT` |

## Configuration

All shared settings live in `common.py`:

| Setting | Default | Meaning |
|---|---|---|
| `GOTHIC_DIR` (env var) | `C:\Program Files (x86)\Steam\steamapps\common\Gothic` | Gothic 1 install folder (contains `Data/` and `_work/`) |
| `REGION_CX`, `REGION_CZ`, `REGION_R` | `-400, -900, 12000` | Square of the colony exported, in Gothic units (cm): the whole Old Camp (palisade, moat, castle) plus a margin of valley. |

`run.sh` runs a script with the repo on `PYTHONPATH` and filters ZenKit's harmless `__del__` messages printed at
interpreter exit. Set `PYTHON` if `python` on your PATH isn't the one with ZenKit installed.

## Running

```bash
export GOTHIC_DIR="/c/Program Files (x86)/Steam/steamapps/common/Gothic"
export PYTHON=python          # or a full path
./export_all.sh               # everything, in order (a few minutes; audio decoding dominates)
./run.sh export_world.py      # or one step at a time
```

Then serve the repo root and open the game:

```bash
python -m http.server 8000 --bind 127.0.0.1
# http://127.0.0.1:8000/web/
```

## Scripts

### `export_world.py` → `world.json`, `world.bin`, `tex/*.png`
Loads `WORLD.ZEN` and keeps, inside the region:

- **World mesh polygons** referenced by a leaf of the BSP tree (`bsp_tree.leaf_polygon_indices`), fan-triangulated.
  That is what Gothic renders: about a quarter of the mesh is leftover geometry it never draws (huge stretched
  triangles through the camp, buried pieces). Ghost occluders are skipped; **portal** polygons (door curtains) stay
  visible but don't collide; **water** materials are translucent and don't collide.
- **Baked lighting** as vertex colours: each polygon vertex's light colour, or, for lightmapped polygons (indoors),
  a bilinear sample of the polygon's lightmap at that vertex (UV = `lightmap.normal · (P − origin)`), pulled 15%
  toward the polygon centre because lightmap borders are often black.
- **Props**: `.3DS` visuals (compiled `.MRM`) and `.ASC`/`.MDS` models (compiled `.MDL`, or `.MDH` + `.MDM` for the
  locked chests that ship without one: node-hierarchy attachments and soft-skin meshes in bind pose), transformed by
  the vob's rotation (`rotation.columns` are the matrix columns, verified against the stored world bounding boxes)
  and position. Props take the baked light of the floor below them. Vobs without `cd_dynamic` and all **doors**
  (closed in the ZEN, opened by use in Gothic) are flagged `nocol`.
- **Decals** (`.TGA` visuals): a double-sided quad of `dimension` (half extents) + `offset` in the vob's plane,
  flagged by the decal's alpha function: `decal_add` (spider silk, dirt patches), `decal_mul2` (wall runes), etc.
- **Dynamic lights** (torches, fires): position, colour, range, whether they flicker.

Geometry is grouped by `(texture, flag)` and written to `world.bin` (float32 positions, float32 UVs, uint8 RGB
vertex colours per group). `world.json`: `{ meshes: [{ tex, alpha, flag, n, p, u, c }], lights, center }`, where
`p/u/c` are byte offsets into `world.bin`, `n` the vertex count and `flag` one of `'' | nocol | portal | water | decal | decal_add | decal_blend | decal_mul | decal_mul2`.

### `export_chars.py` → `chars.json`, `tex/*.png`
Builds skinned human models from the shared `HUMANS.MDH` skeleton (34 nodes):

- **outfits**: `HUM_<X>_ARMOR.MDM` soft-skin meshes (GRDM, STTM, SLDM, VLKM, NOVM, ORGM, KDFM) and the naked body
- **heads**: `HUM_HEAD_<X>.MMB` morph meshes, rigidly weighted to `BIP01 HEAD`
- **weapons**: `ITMW_*.MRM` meshes, rigidly weighted to the `ZS_RIGHTHAND` attachment node (`weapons`), and the
  same meshes in their own node-local space (`weaponsLocal`), which the game hangs on `ZS_SWORD` or `ZS_RIGHTHAND`

Soft-skin vertices are stored per bone as *node-local* positions with weights. The script resolves them to
bind-pose model space (`Σ weight · nodeWorld · localPos`) and keeps up to 4 influences.

`chars.json`: `{ bones: [{ name, parent, m: [16] }], outfits: {id: [part]}, heads: {…}, weapons: {…} }`, where
`m` is the bone's local matrix (column-major, metres) and each part is
`{ tex, p, u, si: [4 bone indices/vertex], sw: [4 weights/vertex] }`. The model origin is the pelvis. The game
lifts it by the lowest vertex so feet sit on the ground.

### `export_anims.py` → `anims.json`
Gothic animates humans with `HUMANS.MDS` (model script: clip names, frame ranges, layers, event tags) and one
`HUMANS-<CLIP>.MAN` per clip (per frame, per bone: local rotation quaternion + position). Fighting talents are overlay
scripts (`HUMANS_1HST1.MDS`, `HUMANS_1HST2.MDS`) with their own `.MAN` files for attacks, parade and stance.

The script exports the clips the game uses (locomotion for running/walking/sneaking, jumping and falling, one-handed fighting, hit
reactions, knock-out, spectating, guarding, dialogue gestures) plus the trained/master variants as `1HST1:<CLIP>`
and `1HST2:<CLIP>`. Per clip: `fps`, frame count `n`, `nodes` (bone indices), `q` (rotations, x,y,z,w per frame per
node), `root` (BIP01 translation per frame, metres), `speed` (average horizontal root speed, m/s), `layer` and `ev`:
the combat event frames `optimal_frame` (blow lands), `hit_end` (combo segment ends) and `combo_window` (pairs of
frames in which the next attack input chains), converted from ASC frame numbers to clip frames.

**Quaternion convention**: the ZenKit Python binding's `Quat` fields come out rotated (the true w,x,y,z are the
fields `.z,.w,.x,.y`) and Gothic stores the inverse rotation. This was determined by matching every bone of
`S_RUN`'s first frame against the `HUMANS.MDH` rest pose (median error 0.005); then the z-mirror is applied as
`(w, −x, −y, z)`.

### `export_ui.py` → `ui/fonts.json`, `ui/*.png`
Gothic's HUD graphics: `BAR_BACK` (status bar frame) and `BAR_HEALTH` (its red fill), and the bitmap fonts
`FONT_OLD_10_WHITE` / `FONT_OLD_20_WHITE` with their highlighted `_HI` variants. A `.FNT` file is a table of 256 glyphs
indexed by Windows-1252 code, each with a pixel width and the UV corners of its cell in the font texture;
`fonts.json` stores `{ <font>: { tex, size, height, glyphs: [[u0, v0, u1, v1, width], …] } }`.
It also saves Gothic's day sky: `SKYDAY_LAYER0_A0` (opaque cloud base), `SKYDAY_LAYER1_A0` (alpha clouds) and the
sun `UNSUN5`.

### `export_wp.py` → `waypoints.json`
Waynet points inside the region: `[{ n: name, x, y, z }]`. The game uses them to place NPCs and to find the arena.
The arena floor is around the `OCR_ARENABATTLE` points; `OCR_ARENA_01…09` is the spectator ring above it.

### `export_lines.py` → `all_lines.json`
Parses `OUINFO.INF`, the script compiler's index of every `AI_Output(speaker, listener, "WAV_ID"); //text` call.
It maps each speech WAV id to `(speaker, subtitle)`, keeping only ids whose WAV exists in the VDFs.

### `export_audio.py` → `audio/*.wav`, `dialogue.json`
- Picks a cast of six Old Camp NPCs (`CAST`), groups their lines into conversation **topics** by the
  `INFO_<NPC>_<TOPIC>_<voice>_<n>` naming scheme (NPC voice + hero voice 15), ordered by `n`.
- Adds per-voice **barks** (`SVM_<voice>_<NAME>`: pain, cheering, greetings, reactions to sneaking and drawn
  weapons, …) and sound effects: footsteps per ground material, Gothic's collision sounds `CS_IAI_ME_ME_*`
  (weapon on weapon) and `CS_IAM_UD_FL_*` (weapon on flesh), and `M_FALL_SMALL01`.
- Decodes Gothic's **IMA ADPCM** WAVs (format tag 17, which browsers don't play) to 16-bit PCM in pure Python.

`dialogue.json`: `{ cast: [{ id, name, role, voice, topics: [{ id, lines: [{ who, text, wav }] }], barks }], sfx }`.

### `export_music.py` + `tools/render` → `music/*.wav`
Gothic's music is **DirectMusic**: `.sgt` segments + `.sty` styles + `.dls` instrument banks, assembled in real
time. Browsers can't play it, so it's rendered offline with [GothicKit/dmusic](https://github.com/GothicKit/dmusic)
(MIT), an open re-implementation of DirectMusic.

Build the renderer once:

```bash
git clone --recursive https://github.com/GothicKit/dmusic tools/dmusic      # git-ignored
cmake -S tools/render -B tools/render/build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build tools/render/build
```

`tools/render/render-music.c` loads one segment through a file resolver rooted at the music folder, plays it
on a `DmPerformance` and writes N seconds of 44.1 kHz stereo PCM to a WAV:

```
render-music <music-dir> <segment.sgt> <out.wav> <seconds> [volume=0.5]
```

`export_music.py` renders each theme in `THEMES` for 126 s, **crossfades the last 6 s into the start** so the
120 s result loops seamlessly, resamples to 32 kHz and normalises to −1 dBFS. Volume 0.45 avoids clipping in
the synth. Add other themes, such as `OW_Day_Std.sgt` or `CAM_Ngt_Std.sgt`, to `THEMES` to render them.

## Coordinate conversion

Gothic is **left-handed**, Y-up, in centimetres. three.js is right-handed, Y-up, in metres. Every exported
position is `(x, y, -z) · 0.01`. Bone matrices are mirrored as `F·M·F` with `F = diag(1, 1, -1)`, translation
scaled by 0.01.

The z-flip mirrors the geometry, which would normally reverse triangle winding. In this data, keeping Gothic's
original vertex order after the flip gives correct front faces. This was verified: up-facing floor area
outweighs down-facing area about 5:1.

## Pitfalls we hit (and the fixes)

| Symptom | Cause | Fix |
|---|---|---|
| World and bodies inside-out; characters snap to roof undersides | triangle winding reversed after z-flip | keep original order `(0,1,2)`; check floor normals |
| Limbs stretch ~2×, models ~1 m too low | skinned meshes bound before their parent's world matrix was updated | `root.updateMatrixWorld(true)` before `mesh.bind()` |
| Half the terrain missing | filtered `is_lod` polygons; in Gothic 1 most outdoor terrain has that flag | don't filter `is_lod` |
| Empty mesh after loading | `World.load` is a static constructor; calling it on an instance does nothing | `w = zenkit.World.load(...)` |
| Speech plays as noise / not at all | IMA ADPCM WAVs | decode to PCM in `export_audio.py` |
| Music clips | dmusic synth runs hot at full volume | render at 0.45, then normalise |
| Stretched ground smeared across the camp, "things underground" | exported every mesh polygon, including ~24% Gothic never draws | keep only BSP leaf polygons |
| Dirt patches/webs/runes as hard blotches | decals alpha-tested instead of blended | blend by the decal's alpha function |
| Camp cut off mid-air, moat floating | export square centred on the arena, 84 m wide | region covers the whole camp (240 m) |
| World flat and unreadable | baked light not exported | per-vertex light + sampled lightmaps as vertex colours |
| Doors, chests, benches, torches missing | only `.3DS` vobs exported | load `.MDL` (or `.MDH`+`.MDM`) for `.ASC`/`.MDS` visuals |
| Characters walk through props | `cd_static` used for collision; it is off for most props | `cd_dynamic` is the "NPCs collide" flag |
| Animated bones twisted | quaternion field order / inverse rotation | see *Quaternion convention* above |
