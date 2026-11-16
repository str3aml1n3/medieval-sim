# Asset pipeline

The game ships **no Gothic assets**. Everything it loads from `export/` is extracted from your own Gothic 1
install by the scripts in this repo. `export/` is git-ignored and is never committed or deployed.

```
Gothic install                    scripts                       export/
─────────────────────────────     ───────────────────────────   ──────────────────────────────
Data/*.VDF ─┬─ WORLD.ZEN ───────► export_world.py ─────────────► world.json, tex/*.png
            │                   ► export_wp.py ────────────────► waypoints.json
            ├─ HUMANS.MDH, *.MDM, *.MMB, *.MRM ► export_chars.py ► chars.json, tex/*.png
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
| `REGION_CX`, `REGION_CZ`, `REGION_R` | `4300, 3400, 4200` | Square of the colony exported, in Gothic units (cm). Centred on the Old Camp arena. |

`run.sh` runs a script with the repo on `PYTHONPATH` and filters ZenKit's harmless `__del__` messages printed at
interpreter exit. Set `PYTHON` if `python` on your PATH isn't the one with ZenKit installed.

## Running

```bash
export GOTHIC_DIR="/c/Program Files (x86)/Steam/steamapps/common/Gothic"
export PYTHON=python          # or a full path
./export_all.sh               # everything, in order (~15–30 min; WORLD.ZEN parsing dominates)
./run.sh export_world.py      # or one step at a time
```

Then serve the repo root and open the game:

```bash
python -m http.server 8000 --bind 127.0.0.1
# http://127.0.0.1:8000/web/
```

## Scripts

### `export_world.py` → `world.json`, `tex/*.png`
Loads `WORLD.ZEN`, keeps the static world mesh polygons inside the region, plus every static prop
(VOB with a `.3DS` visual, compiled as `.MRM`) placed inside it, transformed by the VOB's position and
rotation. Polygons are fan-triangulated and grouped by texture. Each texture is decoded from `<NAME>-C.TEX`
to PNG.

- Skips **ghost occluders** (invisible helper polygons).
- **Portal** polygons (hut door curtains) are kept visible but tagged `portal: true` so the game doesn't
  collide with them.
- `alpha: true` marks textures with transparency (foliage, fences): rendered with alpha test, no collision.

`world.json`: `{ meshes: [{ tex, alpha, portal, p: [x,y,z,…], u: [u,v,…] }], center }`. Triangle soup in
metres, three.js coordinates.

### `export_chars.py` → `chars.json`, `tex/*.png`
Builds skinned human models from the shared `HUMANS.MDH` skeleton (34 nodes):

- **outfits**: `HUM_<X>_ARMOR.MDM` soft-skin meshes (GRDM, STTM, SLDM, VLKM, NOVM, ORGM, KDFM) and the naked body
- **heads**: `HUM_HEAD_<X>.MMB` morph meshes, rigidly weighted to `BIP01 HEAD`
- **weapons**: `ITMW_*.MRM` meshes, rigidly weighted to the `ZS_RIGHTHAND` attachment node

Soft-skin vertices are stored per bone as *node-local* positions with weights. The script resolves them to
bind-pose model space (`Σ weight · nodeWorld · localPos`) and keeps up to 4 influences.

`chars.json`: `{ bones: [{ name, parent, m: [16] }], outfits: {id: [part]}, heads: {…}, weapons: {…} }`, where
`m` is the bone's local matrix (column-major, metres) and each part is
`{ tex, p, u, si: [4 bone indices/vertex], sw: [4 weights/vertex] }`. The model origin is the pelvis. The game
lifts it by the lowest vertex so feet sit on the ground.

### `export_wp.py` → `waypoints.json`
Waynet points inside the region: `[{ n: name, x, y, z }]`. The game uses them to place NPCs and to find the arena.
The arena floor is around the `OCR_ARENABATTLE` points; `OCR_ARENA_01…09` is the spectator ring above it.

### `export_lines.py` → `all_lines.json`
Parses `OUINFO.INF`, the script compiler's index of every `AI_Output(speaker, listener, "WAV_ID"); //text` call.
It maps each speech WAV id to `(speaker, subtitle)`, keeping only ids whose WAV exists in the VDFs.

### `export_audio.py` → `audio/*.wav`, `dialogue.json`
- Picks a cast of six Old Camp NPCs (`CAST`), groups their lines into conversation **topics** by the
  `INFO_<NPC>_<TOPIC>_<voice>_<n>` naming scheme (NPC voice + hero voice 15), ordered by `n`.
- Adds per-voice **barks** (`SVM_<voice>_<NAME>`: pain, cheering, greetings, …) and a list of sound effects.
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
