#!/usr/bin/env bash
# Run the whole asset pipeline in dependency order. Takes a few minutes (audio decoding dominates).
#   GOTHIC_DIR="/path/to/Gothic" PYTHON=python ./export_all.sh
# Music needs the dmusic renderer built first (see docs/PIPELINE.md); it is skipped if missing.
set -euo pipefail
cd "$(dirname "$0")"
step() { echo; echo "== $*"; }
step "world (terrain, props, textures)";  ./run.sh export_world.py
step "characters (skeleton, armors, heads, weapons)"; ./run.sh export_chars.py
step "animations";                        ./run.sh export_anims.py
step "HUD fonts and bars";                ./run.sh export_ui.py
step "waypoints";                         ./run.sh export_wp.py
step "dialogue text index";               ./run.sh export_lines.py
step "speech, barks and sound effects";   ./run.sh export_audio.py
if [ -x tools/render/build/render-music.exe ] || [ -x tools/render/build/render-music ]; then
  step "music";                           ./run.sh export_music.py
else
  echo; echo "== music: skipped (build tools/render first, see docs/PIPELINE.md)"
fi
echo; echo "done -> export/"
