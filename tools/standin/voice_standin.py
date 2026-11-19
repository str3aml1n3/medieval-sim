"""Voices for the stand-in cast -> standin/audio/VO_<NPC>_<TOPIC>_<NN>.wav (committed).

Stock synthetic voices, not copies of anyone: Piper (MIT) with its en_US-libritts_r-medium model, trained on the
LibriTTS-R corpus (CC BY 4.0, https://www.openslr.org/141/). Each character gets one of the model's speakers, cast
by measured pitch from deepest (the captain) to youngest. Names in the lines are the stand-in names.
Output: 16 kHz mono, trimmed and normalised, so the 91 lines stay small. Deterministic for a given Piper version.

Setup once:  tools/voice/.venv/Scripts/pip install piper-tts
             tools/voice/.venv/Scripts/python -m piper.download_voices --download-dir tools/voice/piper en_US-libritts_r-medium
Run:         tools/voice/.venv/Scripts/python tools/standin/voice_standin.py
"""
import io, json, os, re, sys, wave
import numpy as np
from scipy.signal import resample_poly

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)
from dialogue import tree as story_tree
from piper import PiperVoice, SynthesisConfig

MODEL = os.path.join(ROOT, 'tools', 'voice', 'piper', 'en_US-libritts_r-medium.onnx')
OUT = os.path.join(ROOT, 'standin', 'audio')
# speaker id in the model, length scale (> 1 slower). Measured median pitch in the comments.
CAST = {'THORUS': (36, 1.08),     # 91 Hz: the captain, deepest and unhurried
        'BLOODWYN': (594, 1.0),   # 93 Hz
        'KHARIM': (552, 0.97),    # 96 Hz: brash
        'GORHANIS': (438, 1.08),  # 100 Hz: measured, devout
        'FLETCHER': (288, 1.0),   # 104 Hz
        'SNAF': (720, 1.0),       # 107 Hz
        'HERO': (474, 1.0),       # 110 Hz
        'WHISTLER': (636, 0.94),  # 111 Hz: quick and sly
        'KIRGO': (264, 1.0)}      # 120 Hz: the youngest
RATE = 16000

voice = PiperVoice.load(MODEL)
names = {c['id']: c['name'] for c in json.load(open(os.path.join(ROOT, 'standin', 'dialogue.json'), encoding='utf-8'))['cast']}
fill = lambda t: re.sub(r'\{([A-Z_]+)\}', lambda m: names.get(m.group(1), m.group(1).title()), t)
os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    if f.startswith('VO_'): os.remove(os.path.join(OUT, f))
n = 0
for cid, who, text, vo in story_tree.all_lines(story_tree.load()):
    sid, ls = CAST['HERO' if who == 'hero' else cid]
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as w:
        voice.synthesize_wav(fill(text), w, syn_config=SynthesisConfig(speaker_id=sid, length_scale=ls, noise_scale=0.6, noise_w_scale=0.7))
    buf.seek(0); w = wave.open(buf); sr = w.getframerate()
    x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
    x = resample_poly(x, RATE, sr) if sr != RATE else x
    nz = np.where(np.abs(x) > 0.02)[0]
    if len(nz): x = x[max(0, nz[0] - int(0.04 * RATE)):nz[-1] + int(0.12 * RATE)]
    x = x / max(1e-6, np.abs(x).max()) * 0.85
    with wave.open(os.path.join(OUT, vo + '.wav'), 'wb') as o:
        o.setnchannels(1); o.setsampwidth(2); o.setframerate(RATE); o.writeframes((x * 32767).astype(np.int16).tobytes())
    n += 1
size = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT) if f.startswith('VO_'))
print(f'{n} stand-in voice lines, {size / 1e6:.1f} MB')
