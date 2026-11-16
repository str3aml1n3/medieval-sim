from common import *
import json
vfs=mount()
w=load_world(vfs)
CX,CZ,R=REGION_CX,REGION_CZ,REGION_R
wp=[{'n':p.name,'x':p.position.x*.01,'y':p.position.y*.01,'z':-p.position.z*.01} for p in w.way_net.points if abs(p.position.x-CX)<R and abs(p.position.z-CZ)<R]
json.dump(wp,open('export/waypoints.json','w'))
print(len(wp))
