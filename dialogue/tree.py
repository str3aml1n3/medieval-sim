"""Turns the authored dialogue (dialogue/arena.json) into the topics the game reads from dialogue.json.

Used by export_audio.py (with your Gothic install) and tools/standin/make_standin.py (the stand-ins), so both get
the same story. Each line gets a voice file name VO_<NPC>_<TOPIC>_<NN> (synthesised by tools/voice/synth_voices.py;
the game shows a subtitle for 1.5 s when the file is missing). Texts keep their {ID} tokens: the game fills in names.
"""
import json, os

PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'arena.json')
KEYS = ('cond', 'once', 'set', 'journal', 'ore', 'effect', 'label')


def load():
    return json.load(open(PATH, encoding='utf-8'))


def voice_name(cid, tid, i):
    return f'VO_{cid}_{tid}_{i:02d}'


def topics(tree, cid):
    out = []
    for t in tree['cast'][cid]['topics']:
        topic = {'id': t['id'], 'lines': [{'who': 'npc' if who == 'npc' else 'player', 'text': text, 'wav': voice_name(cid, t['id'], i)}
                                          for i, (who, text) in enumerate(t['lines'])]}
        topic.update({k: t[k] for k in KEYS if k in t})
        out.append(topic)
    return out


def all_lines(tree):
    """(npc id, speaker 'npc'|'hero', text, voice name) for every line, for the voice synthesiser"""
    for cid, c in tree['cast'].items():
        for t in c['topics']:
            for i, (who, text) in enumerate(t['lines']):
                yield cid, who, text, voice_name(cid, t['id'], i)
