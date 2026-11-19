# medieval-sim

A small medieval town simulation in the browser, built with three.js: the whole Old Camp with Gothic's own baked
lighting, NPCs who duel, watch and cheer, voiced dialogue, Gothic-style sword fighting (combo windows, parries,
fighting talents) with the original animations, walking/running/sneaking, and adaptive music.

It runs on assets **extracted locally from your own copy of Gothic 1** (Piranha Bytes, 2001) using
[ZenKit](https://github.com/GothicKit/ZenKit) and [dmusic](https://github.com/GothicKit/dmusic). Those assets are
copyrighted, so this repo never contains them: `export/` is git-ignored and never published.

For development and tests without Gothic, the repo includes **stand-in assets** (`standin/`): original placeholder
content in the same formats (a small arena with huts, doors and climbable crates, a boxy cast, procedural
animations, fonts, sounds, and the arena story voiced with stock synthetic voices). A plain clone runs on them, and
so does the GitHub Pages build.

## Quick start

**Without Gothic (stand-in assets):** serve the repo root and open the game. It uses `standin/` automatically when
`export/` doesn't exist; a "stand-in assets" tag shows in the corner.

```bash
python -m http.server 8000 --bind 127.0.0.1       # from the repo root
# open http://127.0.0.1:8000/web/   (on Windows: double-click start.bat)
```

**With your Gothic 1 install:**

```bash
pip install zenkit pillow numpy
export GOTHIC_DIR="/c/Program Files (x86)/Steam/steamapps/common/Gothic"   # your Gothic 1 folder
./export_all.sh                                   # extracts world, characters, animations, dialogue, audio (+ music if built)
python -m http.server 8000 --bind 127.0.0.1       # from the repo root
# open http://127.0.0.1:8000/web/   (on Windows: double-click start.bat)
```

**Story voices (optional, local only):** the arena story's lines are voiced by a speech model conditioned on each
character's own original recordings from your install. The output stays in `export/` and is never committed.
XTTS-v2's licence is non-commercial; on a CPU it takes roughly 20 s per line (about 35 minutes for the story).

```bash
python -m venv tools/voice/.venv
tools/voice/.venv/Scripts/pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
tools/voice/.venv/Scripts/pip install coqui-tts torchcodec six msvc-runtime
./run.sh export_voice_refs.py                                   # reference clips -> export/voice_refs/
tools/voice/.venv/Scripts/python tools/voice/synth_voices.py    # voices -> export/audio/VO_*.wav (only changed lines)
```

On Windows without the Visual C++ runtime, copy the DLLs `msvc-runtime` puts in `tools/voice/.venv/` into
`tools/voice/.venv/Lib/site-packages/torch/lib/`.

For Gothic's own music, build the renderer first (needs CMake + a C compiler). See
[docs/PIPELINE.md](docs/PIPELINE.md#export_musicpy--toolsrender--musicwav). Without it, the game plays a
generated score.

## Controls

Two schemes, switchable in the pause menu (Esc). **Modern** is the default; **Gothic** keeps the original's keys.
The mouse turns the hero in both.

| Action | Modern | Gothic |
|---|---|---|
| move | W / S | W / S |
| turn on the spot | A / D | – (mouse) |
| strafe | right mouse or Space (hold) + A / D | A / D |
| walk / run | Tab switches for good, Shift while held | same |
| jump; facing a ledge: climb up | Space | Alt or V |
| sneak on/off | X | C |
| draw / sheathe weapon | Ctrl | Space or F |
| melee weapon / bow or crossbow | 1 / 2 (again: sheathe) | 1 / 2 |
| shoot (bow / crossbow drawn) | action + W, at the target in focus | left click |
| action key | left mouse or E | – |
| focus lock on the target in front | hold the action key | – |
| attack forward / left / right | action + W / A / D | left click / A or D + left click |
| chain a combo | repeat as the swing ends (too early breaks it) | same |
| parry | right mouse + S, or action + S | right click, or S + left click |
| jump back (weapon drawn) | Space + S | S |
| talk | action key (weapon sheathed) | E |
| pick a dialogue option | mouse wheel + left click, ↑/↓ + Enter, or 1–7 | same |
| skip the line being spoken | right click | right click |
| look back | R (hold) | – |
| get up after a knock-down | R | R |
| one-handed talent | T | T |
| music on/off | M | M |
| pause menu | Esc / P | Esc / P |

NPCs' looks, hit points, strength, armour, weapons, talents and walk overlays come from Gothic's scripts.
Damage is Gothic 1's: strength + weapon damage − the target's protection against that damage type.

## Repository layout

| Path | What |
|---|---|
| `common.py` | shared config (`GOTHIC_DIR`, export region) and VFS/world helpers |
| `export_world.py` | world mesh + props + decals + lights of the Old Camp, with baked lighting → `world.json`, `world.bin` |
| `export_anims.py` | Gothic's human animations + combat event frames → `anims.json` |
| `export_ui.py` | Gothic's HUD fonts, health bar graphics and day sky textures → `ui/` |
| `export_sky.py` | the magic barrier's dome + lightning textures, rain clouds → `barrier.json`, `ui/` |
| `export_chars.py` | skeleton, armors, heads, weapons → `chars.json` |
| `export_wp.py` | waypoints → `waypoints.json` |
| `export_lines.py` | subtitle text index from `OUINFO.INF` → `all_lines.json` |
| `export_audio.py` | speech, barks, SFX incl. combat sounds (ADPCM → PCM) + dialogue topics → `audio/`, `dialogue.json` |
| `export_music.py` | DirectMusic themes → looping WAVs via `tools/render` → `music/` |
| `dialogue/arena.json`, `dialogue/tree.py` | the authored arena story "The Fixed Fight" (conditions, flags, journal, effects) and its loader |
| `export_voice_refs.py` | reference clips of each character's own lines → `voice_refs/` (for the voice model) |
| `tools/voice/synth_voices.py` | synthesises the story's voice lines with XTTS-v2 → `audio/VO_*.wav` (local only) |
| `export_all.sh` | runs all of the above in order |
| `run.sh` | runs one script with the right `PYTHONPATH`, filtering ZenKit exit noise |
| `start.ps1`, `start.bat` | serve the repo locally and open the game |
| `tools/render/` | `render-music.c`: C renderer on GothicKit/dmusic (dmusic itself is cloned to `tools/dmusic`, git-ignored) |
| `web/` | the game: `index.html` + `game.js` |
| `standin/` | committed stand-in assets (original, not from Gothic) used when `export/` is missing |
| `tools/standin/voice_standin.py` | voices the stand-in cast's story lines with stock Piper voices → `standin/audio/VO_*.wav` |
| `tools/standin/make_standin.py` | generates `standin/` (numpy + Pillow only, deterministic). `?assets=standin` / `?assets=export` forces a set |
| `.github/workflows/pages.yml` | deploys `web/` + `standin/` to GitHub Pages (never Gothic's assets) |
| `docs/PIPELINE.md` | how extraction works, file formats, coordinate conversion, pitfalls |
| `docs/GAME.md` | game architecture: collision, characters & animation, combat, AI, dialogue, audio, debug hooks |

## GitHub Pages

The workflow deploys `web/` on every push to `main` that touches it. Enable it under **Settings → Pages → Source:
GitHub Actions**. Private repos need a plan that includes Pages. The hosted page runs on the stand-in assets; the
Gothic-derived assets are never published.

## Credits

Gothic © Piranha Bytes / THQ Nordic. This is a non-commercial fan project and requires an owned copy of the game.
ZenKit and dmusic by the GothicKit contributors (MIT). three.js (MIT).
Stand-in voices: generated with [Piper](https://github.com/rhasspy/piper) (MIT) using the `en_US-libritts_r-medium`
voice, trained on [LibriTTS-R](https://www.openslr.org/141/) (CC BY 4.0, Koizumi et al., 2023).
