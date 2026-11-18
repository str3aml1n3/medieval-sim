# medieval-sim

A small medieval town simulation in the browser, built with three.js: the whole Old Camp with Gothic's own baked
lighting, NPCs who duel, watch and cheer, voiced dialogue, Gothic-style sword fighting (combo windows, parries,
fighting talents) with the original animations, walking/running/sneaking, and adaptive music.

It runs on assets **extracted locally from your own copy of Gothic 1** (Piranha Bytes, 2001) using
[ZenKit](https://github.com/GothicKit/ZenKit) and [dmusic](https://github.com/GothicKit/dmusic). Those assets are
copyrighted, so this repo never contains them: `export/` is git-ignored and never published.

For development and tests without Gothic, the repo includes **stand-in assets** (`standin/`): original placeholder
content in the same formats (a small arena with huts, doors and climbable crates, a boxy cast, procedural
animations, fonts, sounds). A plain clone runs on them, and so does the GitHub Pages build.

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

For Gothic's own music, build the renderer first (needs CMake + a C compiler). See
[docs/PIPELINE.md](docs/PIPELINE.md#export_musicpy--toolsrender--musicwav). Without it, the game plays a
generated score.

## Controls

Two schemes, switchable in the pause menu (Esc). **Modern** is the default; **Gothic** keeps the original's keys.
The mouse turns the hero in both.

| Action | Modern | Gothic |
|---|---|---|
| move / strafe | W S / A D | W S / A D |
| walk | Shift (hold) | Shift (hold) |
| jump; facing a ledge: climb up | Space | Alt or V |
| sneak on/off | X | C |
| draw / sheathe weapon | Ctrl | Space or F |
| action key | left mouse or E | – |
| focus lock on the target in front | hold the action key | – |
| attack forward / left / right | action + W / A / D | left click / A or D + left click |
| chain a combo | repeat as the swing ends (too early breaks it) | same |
| parry | right click, or action + S | right click, or S + left click |
| jump back (weapon drawn) | S | S |
| talk | action key (weapon sheathed) | E |
| pick a dialogue option | ↑/↓ + Enter, or 1–7 | same |
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
| `export_all.sh` | runs all of the above in order |
| `run.sh` | runs one script with the right `PYTHONPATH`, filtering ZenKit exit noise |
| `start.ps1`, `start.bat` | serve the repo locally and open the game |
| `tools/render/` | `render-music.c`: C renderer on GothicKit/dmusic (dmusic itself is cloned to `tools/dmusic`, git-ignored) |
| `web/` | the game: `index.html` + `game.js` |
| `standin/` | committed stand-in assets (original, not from Gothic) used when `export/` is missing |
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
