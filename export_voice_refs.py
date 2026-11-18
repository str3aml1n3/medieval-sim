"""Reference clips for the synthesised voices -> export/voice_refs/<ID>/NN.wav (local only, never committed).

For each speaker in the arena story (dialogue/arena.json) this picks a handful of clean 3-10 s lines from that
character's own dialogue in your Gothic install (INFO_<ID>_..._<voice>_NN / DIA_<ID>_...), and for the hero
(HERO) lines of his voice (15). tools/voice/synth_voices.py conditions the voice model on them.
"""
import os, re, wave, collections
import numpy as np
from common import *

src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'export_audio.py')).read()
exec(src[:src.index('done=set()')])  # vfs + Gothic's ADPCM decoder (decode) from export_audio.py
from dialogue import tree as story_tree

VOICE = {'KIRGO': '05', 'THORUS': '09', 'BLOODWYN': '08', 'FLETCHER': '06', 'SNAF': '01', 'WHISTLER': '11', 'KHARIM': '09', 'GORHANIS': '08', 'HERO': '15'}
PER_SPEAKER, MIN_S, MAX_S = 8, 3.0, 10.0

wavs = []
def walk(n):
    for c in n.children:
        if c.is_dir(): walk(c)
        elif c.name.upper().endswith('.WAV'): wavs.append(c)
walk(vfs.root)
by_name = {c.name.upper()[:-4]: c for c in wavs}


def clips_for(speaker):
    v = VOICE[speaker]
    if speaker == 'HERO':  # the hero's side of many conversations: any dialogue line spoken with voice 15
        pat = re.compile(r'^(INFO|DIA)_[A-Z0-9_]+_15_\d+$')
    else:
        pat = re.compile(r'^(INFO|DIA)_(\w+_)?' + speaker + r'_[A-Z0-9_]+_' + v + r'_\d+$')
    return [n for n in by_name if pat.match(n)]


def load(name):
    d = read_bytes(by_name[name])
    fmt = struct.unpack('<H', d[20:22])[0]
    if fmt == 17: rate, a = decode(d)
    else:
        w = wave.open(__import__('io').BytesIO(d)); rate = w.getframerate(); a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
    return rate, a


speakers = sorted({cid for cid in story_tree.load()['cast']} | {'HERO'})
for sp in speakers:
    out = os.path.join(OUT, 'voice_refs', sp); os.makedirs(out, exist_ok=True)
    for f in os.listdir(out): os.remove(os.path.join(out, f))
    cands = []
    for name in clips_for(sp):
        rate, a = load(name); dur = len(a) / rate
        if MIN_S <= dur <= MAX_S: cands.append((dur, name, rate, a))
    # longest clean clips first, but spread over different conversations for variety
    cands.sort(reverse=True); picked, topics = [], collections.Counter()
    for dur, name, rate, a in cands:
        topic = name.rsplit('_', 2)[0]
        if topics[topic] >= 2: continue
        topics[topic] += 1; picked.append((name, rate, a))
        if len(picked) >= PER_SPEAKER: break
    for i, (name, rate, a) in enumerate(picked):
        with wave.open(os.path.join(out, f'{i:02d}.wav'), 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(a.astype(np.int16).tobytes())
    total = sum(len(a) / r for _, r, a in picked)
    print(f'{sp}: {len(picked)} clips, {total:.0f} s (of {len(cands)} candidates)')
