"""Build export/all_lines.json: speech WAV id -> (speaker, subtitle text).

Source: _work/Data/scripts/_compiled/OUINFO.INF, the compiler's index of every AI_Output(...) call
in the Daedalus scripts. Each call names the WAV and carries the line's text as a trailing // comment.
Only lines whose WAV actually exists in the mounted VDFs are kept.
Consumed by export_audio.py.
"""
import json, os, re
from common import *

vfs = mount()
have = set()
def walk(n):
    for c in n.children:
        if c.is_dir(): walk(c)
        elif c.name.upper().endswith('.WAV'): have.add(c.name.upper()[:-4])
walk(vfs.root)

txt = open(os.path.join(WORK, 'scripts', '_compiled', 'OUINFO.INF'), encoding='latin-1').read()
lines = {}
for m in re.finditer(r'AI_Output\s*\(\s*(\w+)\s*,\s*(\w+)\s*,\s*"([^"]+)"\)\s*;\s*//([^\n}]*)', txt):
    wav = m.group(3).upper()
    if wav in have:
        lines[wav] = (m.group(1), m.group(4).strip())   # speaker is 'self' (NPC) or 'other' (hero)
os.makedirs(OUT, exist_ok=True)
json.dump(lines, open(os.path.join(OUT, 'all_lines.json'), 'w'))
print('lines with audio:', len(lines))
