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
# sanity: model height
allp=np.array([out['outfits']['GRDM'][i]['p'] for i in range(len(out['outfits']['GRDM']))],dtype=object)
ys=[y for part in out['outfits']['GRDM'] for y in part['p'][1::3]]
print('GRDM y range',min(ys),max(ys))
json.dump(out,open('export/chars.json','w'),separators=(',',':'))
print('MB',os.path.getsize('export/chars.json')/1e6, {k:len(v) for k,v in out.items()})
