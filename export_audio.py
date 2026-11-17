from common import *
import numpy as np, struct, json, os, re, collections, wave
vfs=mount()
os.makedirs('export/audio',exist_ok=True)
IDX=[-1,-1,-1,-1,2,4,6,8]
STEP=[7,8,9,10,11,12,13,14,16,17,19,21,23,25,28,31,34,37,41,45,50,55,60,66,73,80,88,97,107,118,130,143,157,173,190,209,230,253,279,307,337,371,408,449,494,544,598,658,724,796,876,963,1060,1166,1282,1411,1552,1707,1878,2066,2272,2499,2749,3024,3327,3660,4026,4428,4871,5358,5894,6484,7132,7845,8630,9493,10442,11487,12635,13899,15289,16818,18500,20350,22385,24623,27086,29794,32767]
def decode(d):
    ch,rate,align=struct.unpack('<HI',d[22:24]+d[24:28])[0],struct.unpack('<I',d[24:28])[0],struct.unpack('<H',d[32:34])[0]
    ch=struct.unpack('<H',d[22:24])[0]
    # find data chunk
    p=12; data=None
    while p<len(d)-8:
        cid=d[p:p+4]; sz=struct.unpack('<I',d[p+4:p+8])[0]
        if cid==b'data': data=d[p+8:p+8+sz]; break
        p+=8+sz+(sz&1)
    out=[]
    for b in range(0,len(data)-align+1,align):
        blk=data[b:b+align]
        pred,idx=struct.unpack('<hB',blk[:3]); out.append(pred)
        for byte in blk[4:]:
            for nib in (byte&15,byte>>4):
                step=STEP[idx]; diff=step>>3
                if nib&1: diff+=step>>2
                if nib&2: diff+=step>>1
                if nib&4: diff+=step
                if nib&8: diff=-diff
                pred=max(-32768,min(32767,pred+diff)); idx=max(0,min(88,idx+IDX[nib&7])); out.append(pred)
    return rate,np.array(out,dtype=np.int16)
done=set()
def conv(name):
    name=name.upper()
    if name in done: return True
    f=vfs.find(name+'.WAV')
    if not f: return False
    d=read_bytes(f)
    fmt=struct.unpack('<H',d[20:22])[0]
    if fmt==17: rate,a=decode(d)
    else:
        w=wave.open(__import__('io').BytesIO(d)); rate=w.getframerate(); a=np.frombuffer(w.readframes(w.getnframes()),dtype=np.int16)
        if w.getnchannels()==2: a=a.reshape(-1,2).mean(1).astype(np.int16)
    with wave.open(f'export/audio/{name}.wav','wb') as o:
        o.setnchannels(1); o.setsampwidth(2); o.setframerate(rate); o.writeframes(a.tobytes())
    done.add(name); return True
lines=json.load(open('export/all_lines.json'))
CAST=[('KIRGO','05','Kirgo','arena fighter'),('THORUS','09','Thorus','castle guard captain'),('BLOODWYN','08','Bloodwyn','Shadow enforcer'),('FLETCHER','06','Fletcher','Old Camp thug'),('SNAF','01','Snaf','cook'),('WHISTLER','11','Whistler','Shadow')]
cast=[]
for npc,v,disp,role in CAST:
    topics=collections.defaultdict(list)
    for k,(who,t) in lines.items():
        m=re.match(r'(?:INFO|DIA)_'+npc+r'_(.+)_(\d+)_(\d+)$',k)
        if not m or m.group(2) not in (v,'15'): continue
        topics[m.group(1)].append((int(m.group(3)),who,t,k))
    ts=[]
    for name,l in topics.items():
        l.sort()
        if len(l)>=2 and any(x[1]=='self' for x in l) and len(l)<=8:
            ts.append({'id':name,'lines':[{'who':'npc' if x[1]=='self' else 'player','text':x[2],'wav':x[3]} for x in l]})
    ts.sort(key=lambda t:-len(t['lines'])); ts=ts[:5]
    for t in ts:
        t['lines']=[ln for ln in t['lines'] if conv(ln['wav'])]
    ts=[t for t in ts if t['lines']]
    barks={}
    for b in ['AARGH_1','AARGH_2','AARGH_3','CHEERFIGHT','THERESAFIGHT','ITWASAGOODFIGHT','DEAD','HEYYOU','FRIENDLYGREETINGS','YOUDEFEATEDMEWELL','WATCHYOURAIM','YEAHWELLDONE','OOH','SMALLTALK01','SMALLTALK02','SMALLTALK03',
              # reactions to the hero: sneaking up on them, walking around with a drawn weapon, after a duel
              'WHATAREYOUDOING','HEYHEYHEY','WEAPONDOWN','ISAIDWEAPONDOWN','YOUASKEDFORIT','HEDEFEATEDHIM','YOUSTILLNOTHAVEENOUGH','WISEMOVE']:
        if conv(f'SVM_{int(v)}_{b}'): barks[b]=f'SVM_{int(v)}_{b}'.upper()
    cast.append({'id':npc,'name':disp,'role':role,'voice':v,'topics':ts,'barks':barks})
    print(disp,len(ts),[len(t['lines']) for t in ts],len(barks))
sfx=['SWORD_DRAW_01','SWORD_DRAW_02','SWORD_FINALHIT','SWORD_UNDRAW_01','STEP_EARTH_01','STEP_EARTH_02','STEP_EARTH_03','STEP_STONE_01','STEP_STONE_02','STEP_STONE_03','CAMPFIRE_01','FIRE_MEDIUM01','BIRD_01','BIRD_03','BIRD_07','BIRD_08','ANVILHIT01','ANVILHIT02','ORC_AMBIENT01',
     # combat collision sounds: weapon on weapon (parry), weapon on flesh (hit), body falling
     *[f'CS_IAI_ME_ME_0{i}' for i in range(1,10)], *[f'CS_IAM_UD_FL_0{i}' for i in range(1,6)], 'M_FALL_SMALL01',
     *[f'STEP_{m}_0{i}' for m in ('EARTH','STONE','WOOD','SAND') for i in range(1,6)],
     # the barrier's crackle and bolts, and the rain loop (export_sky.py exports their textures)
     'MFX_BARRIERE_AMBIENT','MFX_BARRIERE_SHOOT','MFX_BARRIERE_WARNING','RAIN_01']
sfx=[s for s in sfx if conv(s)]
print('sfx',sfx,'files',len(done))
for e in ['SVM_15_AARGH_1','SVM_15_AARGH_2','SVM_6_AARGH_3']: conv(e)
json.dump({'cast':cast,'sfx':sfx},open('export/dialogue.json','w'),indent=0)
