# medieval-sim

Three.js medieval town simulation (arena, NPCs, music, dialogue, fighting) built from assets extracted from a local Gothic 1 install with ZenKit.

Extracted assets (`export/`) are copyrighted and are git-ignored. Regenerate them with `./run.sh export_world.py`.

## Running

1. Install Python 3 and `pip install zenkit pillow numpy`.
2. Edit `G` in `common.py` to point at your Gothic 1 `Data` folder.
3. `./run.sh export_world.py && ./run.sh export_chars.py && ./run.sh export_wp.py`, then extract the dialogue text and audio with `export_audio.py` (it needs `export/all_lines.json`, built from `_work/Data/scripts/_compiled/OUINFO.INF`).
4. From the repo root: `python -m http.server 8000`, then open <http://localhost:8000/web/>.

## GitHub Pages

`.github/workflows/pages.yml` deploys only `web/` (the engine). The Gothic-derived assets are not
committed or published, so the hosted page shows a "game assets not found" notice; play locally.
Enable it under Settings > Pages > Source: GitHub Actions (private repos need a plan that supports Pages).
