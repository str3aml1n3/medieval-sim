"""Synthesises the arena story's voice lines -> export/audio/VO_<NPC>_<TOPIC>_<NN>.wav (local only, never committed).

Each speaker's voice is conditioned on clips of that character's own original lines (export/voice_refs/<ID>/, made by
export_voice_refs.py from your Gothic install); the hero's on his. Model: XTTS-v2 (Coqui, runs on the CPU; its
licence allows non-commercial use only). Only lines whose text changed since the last run are re-synthesised.

Setup once (see README):  python -m venv tools/voice/.venv && tools/voice/.venv/Scripts/pip install torch torchaudio
  --index-url https://download.pytorch.org/whl/cpu coqui-tts torchcodec
Run:                      tools/voice/.venv/Scripts/python tools/voice/synth_voices.py [--only KHARIM] [--limit N]
"""
import argparse, glob, hashlib, json, os, re, sys, time, wave
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)
os.environ.setdefault('COQUI_TOS_AGREED', '1')                                # XTTS-v2: non-commercial licence (CPML)
# the model (~1.8 GB) downloads once into the Hugging Face cache (~/.cache/huggingface)
from dialogue import tree as story_tree

EXPORT = os.path.join(ROOT, 'export')
SETTINGS = {'model': 'xtts_v2', 'temperature': 0.65, 'speed': 1.0, 'v': 1}  # part of the cache key: change to redo all

ap = argparse.ArgumentParser()
ap.add_argument('--only', help='only this speaker id (or HERO)')
ap.add_argument('--limit', type=int, default=0, help='synthesise at most N lines (for a quick test)')
args = ap.parse_args()

story = story_tree.load()
names = {c['id']: c['name'] for c in json.load(open(os.path.join(EXPORT, 'dialogue.json')))['cast']}
fill = lambda t: re.sub(r'\{([A-Z_]+)\}', lambda m: names.get(m.group(1), m.group(1).title()), t)
man_path = os.path.join(EXPORT, 'voice_refs', 'manifest.json')
manifest = json.load(open(man_path)) if os.path.exists(man_path) else {}

todo = []
for cid, who, text, vo in story_tree.all_lines(story):
    speaker = 'HERO' if who == 'hero' else cid
    if args.only and speaker != args.only: continue
    spoken = fill(text)
    key = hashlib.sha1(json.dumps([speaker, spoken, SETTINGS]).encode()).hexdigest()
    if manifest.get(vo) == key and os.path.exists(os.path.join(EXPORT, 'audio', vo + '.wav')): continue
    todo.append((speaker, spoken, vo, key))
if args.limit: todo = todo[:args.limit]
print(f'{len(todo)} lines to synthesise')
if not todo: sys.exit(0)

# load XTTS directly: TTS.api imports every model type, and one of them needs a compiled helper that Windows'
# application control may block. XTTS itself doesn't use it.
from TTS.utils.manage import ModelManager
from TTS.tts.configs.xtts_config import XttsConfig
from TTS.tts.models.xtts import Xtts
import soundfile, torch, torchaudio, TTS.tts.models.xtts as xtts_mod
def _load_audio(path, sampling_rate):  # read reference WAVs with soundfile: torchaudio's new loader needs FFmpeg DLLs
    data, sr = soundfile.read(path, dtype='float32', always_2d=True)
    audio = torch.from_numpy(data.mean(axis=1))[None]
    if sr != sampling_rate: audio = torchaudio.functional.resample(audio, sr, sampling_rate)
    return audio.clamp(-1, 1)
xtts_mod.load_audio = _load_audio
model_dir = ModelManager().download_model('tts_models/multilingual/multi-dataset/xtts_v2')[0]
if os.path.isfile(model_dir): model_dir = os.path.dirname(model_dir)  # some versions return the checkpoint file
cfg = XttsConfig(); cfg.load_json(os.path.join(model_dir, 'config.json'))
model = Xtts.init_from_config(cfg); model.load_checkpoint(cfg, checkpoint_dir=model_dir, eval=True)
latents = {}


def write(path, x, sr):
    x = np.asarray(x, np.float32)
    nz = np.where(np.abs(x) > 0.02)[0]                          # trim leading/trailing silence, keep a short margin
    if len(nz): x = x[max(0, nz[0] - int(0.05 * sr)):nz[-1] + int(0.15 * sr)]
    x = x / max(1e-6, np.abs(x).max()) * 0.85
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes((x * 32767).astype(np.int16).tobytes())


t0 = time.time()
for i, (speaker, text, vo, key) in enumerate(todo):
    if speaker not in latents:
        refs = sorted(glob.glob(os.path.join(EXPORT, 'voice_refs', speaker, '*.wav')))
        if not refs: print('no reference clips for', speaker, '- run export_voice_refs.py'); continue
        latents[speaker] = model.get_conditioning_latents(audio_path=refs)
    gpt, spk = latents[speaker]
    out = model.inference(text, 'en', gpt, spk, temperature=SETTINGS['temperature'], speed=SETTINGS['speed'], enable_text_splitting=True)
    write(os.path.join(EXPORT, 'audio', vo + '.wav'), out['wav'], 24000)
    manifest[vo] = key; json.dump(manifest, open(man_path, 'w'), indent=0)
    el = time.time() - t0
    print(f'[{i + 1}/{len(todo)}] {vo} ({speaker}) {el / (i + 1):.1f}s/line, ~{el / (i + 1) * (len(todo) - i - 1) / 60:.0f} min left: {text[:60]}', flush=True)
