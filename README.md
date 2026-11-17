# medieval-sim

A small medieval town simulation in the browser, built with three.js: the whole Old Camp with Gothic's own baked
lighting, NPCs who duel, watch and cheer, voiced dialogue, Gothic-style sword fighting (combo windows, parries,
fighting talents) with the original animations, walking/running/sneaking, and adaptive music.

It runs on assets **extracted locally from your own copy of Gothic 1** (Piranha Bytes, 2001) using
[ZenKit](https://github.com/GothicKit/ZenKit) and [dmusic](https://github.com/GothicKit/dmusic). Those assets are
copyrighted, so this repo contains **only code**. `export/` is git-ignored, and the GitHub Pages build publishes the
engine without them. Play it locally.

## Quick start

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

Gothic's layout, with the mouse turning the hero.

| Key | Action |
|---|---|
| Mouse | turn (camera stays behind you) |
| W / S | run forward / walk back |
| A / D | strafe |
| Shift (hold) | walk |
| Alt or V | jump (forward while moving, straight up when standing) |
| C | sneak on/off (silent: NPCs only notice what they see) |
| Space or F | draw / sheathe weapon |
| Left click | attack; click again as the swing ends to chain a combo (clicking too early breaks it) |
| A / D + left click | swing left / right |
| Right click, or S + left click | parry |
| S (weapon drawn) | jump back |
| T | one-handed talent: untrained / trained / master (longer combos) |
| E, then 1–7 | talk, pick a dialogue option |
| M | music on/off |
| R | get up after being knocked down |
| Esc / P | pause menu (controls, volume, brightness, mouse speed, restart) |

## Repository layout

| Path | What |
|---|---|
| `common.py` | shared config (`GOTHIC_DIR`, export region) and VFS/world helpers |
| `export_world.py` | world mesh + props + decals + lights of the Old Camp, with baked lighting → `world.json`, `world.bin` |
| `export_anims.py` | Gothic's human animations + combat event frames → `anims.json` |
| `export_ui.py` | Gothic's HUD fonts, health bar graphics and day sky textures → `ui/` |
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
| `.github/workflows/pages.yml` | deploys `web/` to GitHub Pages (engine only, no assets) |
| `docs/PIPELINE.md` | how extraction works, file formats, coordinate conversion, pitfalls |
| `docs/GAME.md` | game architecture: collision, characters & animation, combat, AI, dialogue, audio, debug hooks |

## GitHub Pages

The workflow deploys `web/` on every push to `main` that touches it. Enable it under **Settings → Pages → Source:
GitHub Actions**. Private repos need a plan that includes Pages. The hosted page shows a "game assets not found"
notice, because the Gothic-derived assets are never published.

## Credits

Gothic © Piranha Bytes / THQ Nordic. This is a non-commercial fan project and requires an owned copy of the game.
ZenKit and dmusic by the GothicKit contributors (MIT). three.js (MIT).
