# Renders Gothic's DirectMusic themes to seamless-looping WAVs with tools/render (GothicKit/dmusic).
import subprocess, wave, numpy as np, os, sys, json
from common import WORK
GOTHIC = os.path.join(WORK, "Music", "orchestra")
EXE = os.path.join('tools', 'render', 'build', 'render-music.exe')
OUT = os.path.join('export', 'music'); os.makedirs(OUT, exist_ok=True)
THEMES = {'oc_std': 'OC_Day_Std.sgt', 'oc_fgt': 'OC_Day_Fgt.sgt'}
LOOP, XF, RATE_OUT = 120.0, 6.0, 32000
meta = {}
for key, sgt in THEMES.items():
    raw = os.path.join(OUT, key + '_raw.wav')
    subprocess.run([EXE, GOTHIC, sgt, raw, str(LOOP + XF), '0.45'], check=True, capture_output=True)
    w = wave.open(raw); rate = w.getframerate()
    a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).reshape(-1, 2).astype(np.float32); w.close(); os.remove(raw)
    # seamless loop: crossfade the extra tail into the head, then drop the tail
    n, x = int(LOOP * rate), int(XF * rate)
    ramp = np.linspace(0, 1, x, dtype=np.float32)[:, None]
    loop = a[:n].copy(); loop[:x] = a[n:n + x] * (1 - ramp) + a[:x] * ramp
    # resample to 32 kHz (linear) to keep files smaller, normalise to -1 dBFS
    t = np.arange(0, len(loop), rate / RATE_OUT)
    res = np.stack([np.interp(t, np.arange(len(loop)), loop[:, c]) for c in (0, 1)], 1)
    res *= (0.89 * 32767) / max(1.0, np.abs(res).max())
    with wave.open(os.path.join(OUT, key + '.wav'), 'wb') as o:
        o.setnchannels(2); o.setsampwidth(2); o.setframerate(RATE_OUT); o.writeframes(res.astype(np.int16).tobytes())
    rms = float(np.sqrt((res ** 2).mean()))
    meta[key] = {'segment': sgt, 'seconds': LOOP}
    print(key, sgt, f'{os.path.getsize(os.path.join(OUT, key + ".wav")) / 1e6:.1f} MB', 'rms', round(rms))
json.dump(meta, open(os.path.join(OUT, 'music.json'), 'w'), indent=1)
