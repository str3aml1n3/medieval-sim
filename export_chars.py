from common import *
import numpy as np, json, os, collections
from PIL import Image
vfs=mount()
S=0.01
F=np.diag([1,1,-1,1.0])
def m4(m):
    a=np.zeros((4,4))
    for j,c in enumerate(m.columns): a[:,j]=[c.x,c.y,c.z,c.w]
    return a
h=zenkit.ModelHierarchy.load(vfs.find('HUMANS.MDH').open())
nodes=h.nodes; n=len(nodes)
local=[m4(x.transform) for x in nodes]
world=[None]*n
def getw(i):
    if world[i] is None:
        p=nodes[i].parent
        world[i]=local[i] if p<0 else getw(p)@local[i]
    return world[i]
for i in range(n): getw(i)
bones=[]
for i,x in enumerate(nodes):
    L=F@local[i]@F; L[:3,3]*=S
    bones.append({'name':x.name,'parent':x.parent,'m':[round(float(v),6) for v in L.T.flatten()]})
names={x.name:i for i,x in enumerate(nodes)}
print('bones',n, 'head',names.get('BIP01 HEAD'))
texsave=set()
def savetex(tex):
    base=tex.upper().rsplit('.',1)[0]
    if base in texsave: return base
    f=vfs.find(base+'-C.TEX')
    if not f: return None
    t=zenkit.Texture.load(f.open())
    Image.frombytes('RGBA',(t.width,t.height),t.mipmap_rgba(0)).save(f'export/tex/{base}.png'); texsave.add(base); return base
def conv(P):  # model-space cm -> three space
    P=(F@np.append(P,1.0))[:3]*S; return P
def skin_parts(mdm):
    mm=zenkit.ModelMesh.load(vfs.find(mdm).open()); parts=[]
    for sm in mm.meshes:
        M=sm.mesh
        verts=[]
        for wl in sm.weights:
            wl=sorted(wl,key=lambda x:-x.weight)[:4]
            P=np.zeros(3); tot=sum(x.weight for x in wl) or 1
            for x in wl:
                P+= (world[x.index]@np.array([x.position.x,x.position.y,x.position.z,1.0]))[:3]*x.weight/tot
            si=[x.index for x in wl]+[0]*(4-len(wl)); sw=[x.weight/tot for x in wl]+[0]*(4-len(wl))
            verts.append((conv(P),si,sw))
        for sub in M.submeshes:
            t=savetex(sub.material.texture or '')
            if not t: continue
            p=[];u=[];si=[];sw=[]
            for tr in sub.triangles:
                for k in (0,1,2):
                    wd=sub.wedges[tr.wedges[k]]
                    v=verts[wd.index]
                    p+= [round(float(c),4) for c in v[0]]; u+=[round(wd.texture.x,4),round(1-wd.texture.y,4)]
                    si+=v[1]; sw+=[round(c,3) for c in v[2]]
            parts.append({'tex':t,'p':p,'u':u,'si':si,'sw':sw})
    return parts
def rigid_part(mesh, bone, tex_override=None):
    parts=[]
    W=world[names[bone]]
    for sub in mesh.submeshes:
        t=savetex(tex_override or sub.material.texture or '')
        if not t: continue
        p=[];u=[];si=[];sw=[]
        for tr in sub.triangles:
            for k in (0,1,2):
                wd=sub.wedges[tr.wedges[k]]; q=mesh.positions[wd.index]
                P=conv((W@np.array([q.x,q.y,q.z,1.0]))[:3])
                p+=[round(float(c),4) for c in P]; u+=[round(wd.texture.x,4),round(1-wd.texture.y,4)]
                si+=[names[bone],0,0,0]; sw+=[1,0,0,0]
        parts.append({'tex':t,'p':p,'u':u,'si':si,'sw':sw})
    return parts
def local_part(mesh):
    # vertices in the attachment node's own (mirrored) space: the game parents these to ZS_RIGHTHAND / ZS_SWORD
    parts=[]
    for sub in mesh.submeshes:
        t=savetex(sub.material.texture or '')
        if not t: continue
        p=[];u=[]
        for tr in sub.triangles:
            for k in (0,1,2):
                wd=sub.wedges[tr.wedges[k]]; q=mesh.positions[wd.index]
                p+=[round(q.x*S,4),round(q.y*S,4),round(-q.z*S,4)]; u+=[round(wd.texture.x,4),round(1-wd.texture.y,4)]
        parts.append({'tex':t,'p':p,'u':u})
    return parts
os.makedirs('export/tex',exist_ok=True)
out={'bones':bones,'outfits':{},'heads':{},'weapons':{},'weaponsLocal':{}}
for o in ['GRDM','STTM','SLDM','VLKM','NOVM','ORGM','KDFM']:
    try: out['outfits'][o]=skin_parts(f'HUM_{o}_ARMOR.MDM')
    except Exception as e: print('skip',o,e)
out['outfits']['NAKED']=skin_parts('HUM_BODY_NAKED0.MDM')
for hd in ['FIGHTER','THIEF','PONY','BALD','FATBALD','PSIONIC']:
    try:
        mm=zenkit.MorphMesh.load(vfs.find(f'HUM_HEAD_{hd}.MMB').open())
        out['heads'][hd]=rigid_part(mm.mesh,'BIP01 HEAD')
    except Exception as e: print('skip head',hd,e)
for wn,mrm in [('sword','ITMW_1H_SWORD_01.MRM'),('axe','ITMW_1H_AXE_01.MRM'),('mace','ITMW_1H_MACE_01.MRM'),('hammer','ITMW_1H_SLEDGEHAMMER_01.MRM')]:
    try:
        m=zenkit.MultiResolutionMesh.load(vfs.find(mrm).open()); out['weapons'][wn]=rigid_part(m,'ZS_RIGHTHAND'); out['weaponsLocal'][wn]=local_part(m)
    except Exception as e: print('skip weapon',wn,e)
# --- the cast's real looks, read by running each NPC's instance in Gothic's compiled scripts (GOTHIC.DAT):
# Mdl_SetVisualBody(npc, body, bodyTex, skin, head, headTex, teeth, armor) picks the meshes and texture variants,
# EquipItem gives the melee weapon, Mdl_SetModelScale the build. (Same NPC ids as export_audio.py's CAST.)
CAST_IDS=['KIRGO','THORUS','BLOODWYN','FLETCHER','SNAF','WHISTLER','KHARIM','GORHANIS',
          'HERO']  # PC_HERO: the player's own head, face and skin (he keeps the guard armour)
vm=zenkit.DaedalusVm.load(os.path.join(WORK,'scripts','_compiled','GOTHIC.DAT'))
DI=zenkit.DaedalusInstance; rec={}
def _vis(npc,body,btex,skin,head,htex,teeth,armor): rec.update(body=body,btex=btex,skin=skin,head=head,htex=htex,teeth=teeth,armor=armor)
def _eq(npc,item): rec.setdefault('equip',[]).append(item)
def _scale(npc,x,y,z): rec['scale']=[round(x,3),round(y,3),round(z,3)]
vm.register_external('Mdl_SetVisualBody',_vis,DI,str,int,int,str,int,int,int)
vm.register_external('EquipItem',_eq,DI,int)
vm.register_external('Mdl_SetModelScale',_scale,DI,float,float,float)
vm.register_external('Mdl_SetModelFatness',lambda n,f: rec.update(fat=round(f,3)),DI,float)
vm.register_external('Mdl_ApplyOverlayMds',lambda n,m: rec.update(overlay=stem(m).replace('HUMANS_','')),DI,str)
vm.register_external('CreateInvItems',lambda n,i,c: rec.setdefault('inv',{}).update({vm.get_symbol_by_index(i).name: c}),DI,int,int)
vm.register_external('Npc_SetTalentSkill',lambda n,t,v: rec.setdefault('talent',{}).update({t:v}),DI,int,int)
vm.register_external_default(lambda s: None)   # every other external (routines, attributes, inventory) is irrelevant here
ITEM_SWD,ITEM_AXE,ITEM_2HD_SWD,ITEM_2HD_AXE,ITEM_KAT_NF,ITEM_KAT_FF,ITEM_CROSSBOW=16384,32768,65536,131072,2,4,1048576
NPC_TALENT_1H,NPC_TALENT_2H=1,2
from zenkit.daedalus.npc import NpcInstanceAttribute as ATR, DamageType as DMG
DAMAGE_NAMES=['barrier','blunt','edge','fire','fly','magic','point','fall']   # Gothic's DAM_INDEX_* order
def item(name): return vm.init_instance(name, zenkit.DaedalusInstanceType.ITEM)
def protection(it): return {DAMAGE_NAMES[i]:it.get_protection(DMG(i)) for i in range(8) if it.get_protection(DMG(i))}
def dtype(it): return DAMAGE_NAMES[(it.damage_type & -it.damage_type).bit_length()-1] if it.damage_type else 'edge'
# the player's own gear (not scripted): guard armour and a crude sword, with Gothic's values
out['items']={n:{'prot':protection(item(n))} for n in ['GRD_ARMOR_M']}
_sw=item('ITMW_1H_SWORD_01'); out['items']['ITMW_1H_SWORD_01']={'dmg':_sw.damage_total,'dtype':dtype(_sw),'range':_sw.range}
_cb=item('ITRW_CROSSBOW_01'); out['items']['ITRW_CROSSBOW_01']={'id':'ITRW_CROSSBOW_01','name':_cb.name,'kind':'cbow','slot':'ZS_CROSSBOW','dmg':_cb.damage_total,'dtype':dtype(_cb),'ammoId':'ITAMBOLT'}
def stem(f): return os.path.splitext(f)[0].upper()
def variant(tex,v=None,c=None):
    # Gothic swaps texture variants by name: ..._V<n> is the body/head/teeth variant, _C<n> the skin colour
    import re
    if v is not None: tex=re.sub(r'_V\d+',f'_V{v}',tex,count=1)
    if c is not None: tex=re.sub(r'_C\d+',f'_C{c}',tex,count=1)
    return tex
out['looks']={}
def ammo_mesh(ammo_id):
    # arrows and bolts: the ammunition item's own mesh, shown nocked and in flight
    if ammo_id and ammo_id not in out['weaponsLocal']:
        it=item(ammo_id); out['weaponsLocal'][ammo_id]=local_part(zenkit.MultiResolutionMesh.load(vfs.find(stem(it.visual)+'.MRM').open()))
for cid in CAST_IDS:
    inst=next(x.name for x in vm.symbols if x.name.endswith('_'+cid) and x.type==zenkit.DaedalusDataType.INSTANCE)
    rec.clear(); npc=vm.init_instance(inst, zenkit.DaedalusInstanceType.NPC)
    # body: the armour's model replaces the naked body (keeping its bare-skin parts); no armour -> the body mesh itself
    prot={}
    if rec['armor']>=0:
        arm=vm.init_instance(vm.get_symbol_by_index(rec['armor']).name, zenkit.DaedalusInstanceType.ITEM)
        mdm=stem(arm.visual_change)+'.MDM'; prot=protection(arm)
    else: mdm=stem(rec['body'])+'.MDM'
    okey=stem(mdm).replace('HUM_','').replace('_ARMOR','')
    if okey not in out['outfits']: out['outfits'][okey]=skin_parts(mdm)
    hkey=stem(rec['head']).replace('HUM_HEAD_','')
    if hkey not in out['heads']:
        out['heads'][hkey]=rigid_part(zenkit.MorphMesh.load(vfs.find(stem(rec['head'])+'.MMB').open()).mesh,'BIP01 HEAD')
    swap={}
    for p in out['outfits'][okey]:
        if p['tex'].startswith('HUM_BODY_'): swap[p['tex']]=variant(p['tex'],rec['btex'],rec['skin'])
        elif '_V0' in p['tex']: swap[p['tex']]=variant(p['tex'],rec['btex'])
    for p in out['heads'][hkey]:
        if p['tex'].startswith('HUM_HEAD_'): swap[p['tex']]=variant(p['tex'],rec['htex'],rec['skin'])
        elif p['tex'].startswith('HUM_TEETH_'): swap[p['tex']]=variant(p['tex'],rec['teeth'])
    swap={a:b for a,b in swap.items() if a!=b and (savetex(b) or print('  missing texture',b))}
    # equipped weapons: the melee one (in hand / at the hip or on the back) and a bow or crossbow carried on the back
    weapon=ranged=None
    for ii in rec.get('equip',[]):
        wkey=vm.get_symbol_by_index(ii).name; it=item(wkey)
        if it.main_flag==ITEM_KAT_NF and not weapon:
            if wkey not in out['weaponsLocal']:
                out['weaponsLocal'][wkey]=local_part(zenkit.MultiResolutionMesh.load(vfs.find(stem(it.visual)+'.MRM').open()))
            weapon={'id':wkey,'name':it.name,'twoHanded':bool(it.flags&(ITEM_2HD_SWD|ITEM_2HD_AXE)),
                    'dmg':it.damage_total,'dtype':dtype(it),'range':it.range}
        elif it.main_flag==ITEM_KAT_FF and not ranged:
            if wkey not in out['weaponsLocal']:   # bows and crossbows are morph meshes (they animate when drawn)
                out['weaponsLocal'][wkey]=local_part(zenkit.MorphMesh.load(vfs.find(stem(it.visual)+'.MMB').open()).mesh)
            cbow=bool(it.flags&ITEM_CROSSBOW); ammo_id=vm.get_symbol_by_index(it.munition).name if it.munition>0 else None
            ranged={'id':wkey,'name':it.name,'kind':'cbow' if cbow else 'bow','slot':'ZS_CROSSBOW' if cbow else 'ZS_BOW',
                    'dmg':it.damage_total,'dtype':dtype(it),'ammoId':ammo_id,'ammo':rec.get('inv',{}).get(ammo_id,0)}
            ammo_mesh(ammo_id)
    # fighting talent for the weapon in hand: 0 untrained, 1 trained (xHST1), 2 master (xHST2)
    two=bool(weapon and weapon['twoHanded']); lvl=rec.get('talent',{}).get(NPC_TALENT_2H if two else NPC_TALENT_1H,0)
    style=(('2H' if two else '1H')+'ST'+str(lvl)) if lvl else ''
    out['looks'][cid]={'instance':inst,'outfit':okey,'head':hkey,'tex':swap,'weapon':weapon,'ranged':ranged,'scale':rec.get('scale',[1,1,1]),
                       'fat':rec.get('fat',0),'overlay':rec.get('overlay'),'style':style,
                       'hp':npc.get_attribute(ATR.HITPOINTS_MAX),'str':npc.get_attribute(ATR.STRENGTH),'dex':npc.get_attribute(ATR.DEXTERITY),'prot':prot}
    print('look',cid,out['looks'][cid])
# sanity: model height
allp=np.array([out['outfits']['GRDM'][i]['p'] for i in range(len(out['outfits']['GRDM']))],dtype=object)
ys=[y for part in out['outfits']['GRDM'] for y in part['p'][1::3]]
print('GRDM y range',min(ys),max(ys))
json.dump(out,open('export/chars.json','w'),separators=(',',':'))
print('MB',os.path.getsize('export/chars.json')/1e6, {k:len(v) for k,v in out.items()})
