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
step "barrier and weather";               ./run.sh export_sky.py
step "waypoints";                         ./run.sh export_wp.py
step "dialogue text index";               ./run.sh export_lines.py
step "speech, barks and sound effects";   ./run.sh export_audio.py
step "voice references for the story";    ./run.sh export_voice_refs.py
if [ -x tools/voice/.venv/Scripts/python.exe ] || [ -x tools/voice/.venv/bin/python ]; then
  VPY=tools/voice/.venv/Scripts/python.exe; [ -x "$VPY" ] || VPY=tools/voice/.venv/bin/python
  step "story voices (only changed lines)"; "$VPY" tools/voice/synth_voices.py
else
  echo; echo "== story voices: skipped (set up tools/voice first, see README)"
fi
if [ -x tools/render/build/render-music.exe ] || [ -x tools/render/build/render-music ]; then
  step "music";                           ./run.sh export_music.py
else
  echo; echo "== music: skipped (build tools/render first, see docs/PIPELINE.md)"
fi
echo; echo "done -> export/"
