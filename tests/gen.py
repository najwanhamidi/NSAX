import math, random, datetime, os, struct
from xml.sax.saxutils import escape
random.seed(7)
OUT='data'; os.makedirs(OUT,exist_ok=True)
LTHR=178
START=datetime.datetime(2026,10,20,23,0,0,tzinfo=datetime.timezone.utc)

def build(steps, hr_for, noise=True):
    """steps: list of (label, dur_s, pace_s_per_km). returns per-second samples."""
    pts=[]; t=0; dist=0.0; hr=100.0
    lat0,lon0=3.15,101.65
    for label,dur,pace in steps:
        v=1000.0/pace
        target=hr_for(label)
        for i in range(int(dur)):
            vv=v*(1+ (random.gauss(0,0.015) if noise else 0))
            dist+=vv
            # first-order HR lag toward target (tau ~ 25s)
            hr+= (target-hr)/25.0
            h=hr+(random.gauss(0,0.8) if noise else 0)
            # path: straight line north
            lat=lat0+dist/111320.0; lon=lon0
            pts.append(dict(t=t,dist=dist,hr=round(h),lat=lat,lon=lon,alt=20+3*math.sin(t/300),speed=vv,cad=170+random.randint(-2,2),label=label))
            t+=1
    return pts

def sub_hr(label, rep_i=[0], n_total=[10]):
    return None

def session(reps, rep_dur, rest, pace_rep, wu=900, cd=600, rest_pace=None, wu_pace=330, cd_pace=340, hr_progress=True, reps_list=None, fade=0.0):
    steps=[]; targets={}
    steps.append(('wu',wu,wu_pace))
    n=len(reps_list) if reps_list else reps
    for i in range(n):
        d = reps_list[i] if reps_list else rep_dur
        p = pace_rep*(1+fade*i/max(1,n-1)) if not callable(pace_rep) else pace_rep(d,i)
        steps.append((f'rep{i}',d,p))
        steps.append((f'rest{i}',rest,rest_pace or 480))   # jog 8:00/km
    steps.append(('cd',cd,cd_pace))
    N=n
    def hr_for(label):
        if label=='wu' or label=='cd': return 128
        if label.startswith('rest'): return 140
        i=int(label[3:]); u=i/max(1,N-1)
        return LTHR-8+9*u + 3   # target a bit above end-of-rep because of lag
    return build(steps,hr_for)

def write_gpx(path, pts, hr=True):
    s=['<?xml version="1.0" encoding="UTF-8"?>','<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"><trk><name>Test run</name><type>running</type><trkseg>']
    for p in pts:
        ts=(START+datetime.timedelta(seconds=p['t'])).strftime('%Y-%m-%dT%H:%M:%SZ')
        ext=f'<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>{p["hr"]}</gpxtpx:hr><gpxtpx:cad>{p["cad"]}</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions>' if hr else ''
        s.append(f'<trkpt lat="{p["lat"]:.7f}" lon="{p["lon"]:.7f}"><ele>{p["alt"]:.1f}</ele><time>{ts}</time>{ext}</trkpt>')
    s.append('</trkseg></trk></gpx>')
    open(path,'w').write('\n'.join(s))

def write_tcx(path, pts):
    s=['<?xml version="1.0" encoding="UTF-8"?>','<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Activities><Activity Sport="Running"><Id>x</Id>']
    ts0=START.strftime('%Y-%m-%dT%H:%M:%SZ')
    s.append(f'<Lap StartTime="{ts0}"><TotalTimeSeconds>{len(pts)}</TotalTimeSeconds><DistanceMeters>{pts[-1]["dist"]:.1f}</DistanceMeters><Intensity>Active</Intensity><TriggerMethod>Manual</TriggerMethod><Track>')
    for p in pts:
        ts=(START+datetime.timedelta(seconds=p['t'])).strftime('%Y-%m-%dT%H:%M:%SZ')
        s.append(f'<Trackpoint><Time>{ts}</Time><Position><LatitudeDegrees>{p["lat"]:.7f}</LatitudeDegrees><LongitudeDegrees>{p["lon"]:.7f}</LongitudeDegrees></Position><AltitudeMeters>{p["alt"]:.1f}</AltitudeMeters><DistanceMeters>{p["dist"]:.2f}</DistanceMeters><HeartRateBpm><Value>{p["hr"]}</Value></HeartRateBpm><Cadence>{p["cad"]//2}</Cadence></Trackpoint>')
    s.append('</Track></Lap></Activity></Activities></TrainingCenterDatabase>')
    open(path,'w').write('\n'.join(s))

def write_fit(path, pts, structured=False):
    from fit_tool.fit_file_builder import FitFileBuilder
    from fit_tool.profile.messages.file_id_message import FileIdMessage
    from fit_tool.profile.messages.record_message import RecordMessage
    from fit_tool.profile.messages.lap_message import LapMessage
    from fit_tool.profile.messages.session_message import SessionMessage
    from fit_tool.profile.profile_type import FileType, Manufacturer, Sport, SubSport, Intensity, LapTrigger
    b=FitFileBuilder(auto_define=True, min_string_size=50)
    m=FileIdMessage(); m.type=FileType.ACTIVITY; m.manufacturer=Manufacturer.DEVELOPMENT.value; m.product=0; m.time_created=int(START.timestamp()*1000); m.serial_number=1234; b.add(m)
    base=int(START.timestamp()*1000)
    for p in pts:
        r=RecordMessage(); r.timestamp=base+p['t']*1000; r.distance=p['dist']; r.heart_rate=p['hr']; r.cadence=p['cad']//2
        r.position_lat=p['lat']; r.position_long=p['lon']; r.altitude=p['alt']; r.speed=p['speed']
        b.add(r)
    if structured:
        # group by label class into laps
        groups=[]; 
        for p in pts:
            lab=p['label']; cls = 'warmup' if lab=='wu' else 'cooldown' if lab=='cd' else 'recovery' if lab.startswith('rest') else 'active'
            key=(lab)
            if groups and groups[-1][0]==key: groups[-1][2].append(p)
            else: groups.append((key,cls,[p]))
        imap={'warmup':Intensity.WARMUP,'cooldown':Intensity.COOLDOWN,'recovery':Intensity.RECOVERY,'active':Intensity.ACTIVE}
        for gi,(k,cls,ps) in enumerate(groups):
            l=LapMessage(); l.timestamp=base+ps[-1]['t']*1000+1000; l.start_time=base+ps[0]['t']*1000
            l.total_elapsed_time=len(ps); l.total_timer_time=len(ps); l.total_distance=ps[-1]['dist']-ps[0]['dist']
            l.intensity=imap[cls]; l.lap_trigger=LapTrigger.MANUAL; l.avg_heart_rate=int(sum(x['hr'] for x in ps)/len(ps)); l.wkt_step_index=gi
            b.add(l)
    s=SessionMessage(); s.timestamp=base+pts[-1]['t']*1000; s.start_time=base; s.sport=Sport.RUNNING; s.sub_sport=SubSport.GENERIC
    s.total_elapsed_time=len(pts); s.total_timer_time=len(pts); s.total_distance=pts[-1]['dist']; b.add(s)
    b.build().to_file(path)

# --- model target for a 5K of 20:00 (VDOT~49.8) : 3min ~4:14, 6min ~4:20, 10 min ~4:28
good3 = session(10,180,60,254)                       # 10x3, on target
write_gpx(f'{OUT}/10x3_good.gpx', good3); write_fit(f'{OUT}/10x3_good.fit', good3); write_tcx(f'{OUT}/10x3_good.tcx', good3)
write_fit(f'{OUT}/10x3_structured.fit', good3, structured=True)
hot6 = session(5,360,75,250*0.0+235, fade=0.04)         # 5x6 too fast (3:55) and fading
write_gpx(f'{OUT}/5x6_toofast.gpx', hot6)
long10 = session(3,600,105,268)                       # 3x10 on target, long rests
write_fit(f'{OUT}/3x10_good.fit', long10)
# custom ladder: 2,4,6,4,2 min at model pace per duration, 90 s rest
def lad_pace(d,i): return {120:245,240:252,360:260}[d]
ladder = session(0,0,75,lad_pace,reps_list=[120,240,360,240,120])
write_gpx(f'{OUT}/ladder_custom.gpx', ladder); write_fit(f'{OUT}/ladder_custom.fit', ladder)
# custom 1000 m style: 8 x ~4:10 reps (250s) with 60 s rest
k8 = session(8,250,60,255)
write_gpx(f'{OUT}/8x4min_custom.gpx', k8)
# easy run 60 min @ 5:50 HR 135
easy = build([('easy',3600,350)], lambda l:136)
write_gpx(f'{OUT}/easy60.gpx', easy); write_fit(f'{OUT}/easy60.fit', easy)
print('ok', {f:os.path.getsize(f'{OUT}/{f}') for f in os.listdir(OUT)})

# --- edge: strides in warm-up, walking rests, no HR, hilly-ish
steps=[('wu',600,340)]
for i in range(4): steps+= [(f'str{i}',20,200),(f'sr{i}',40,420)]
steps+=[('wu2',240,340)]
for i in range(6): steps+=[(f'rep{i}',300,258),(f'rest{i}',90,800)]
steps+=[('cd',420,360)]
pts=build(steps, lambda l:140)
write_gpx(f'{OUT}/edge_strides_walkrest_nohr.gpx', pts, hr=False)
import gzip, shutil
with open(f'{OUT}/10x3_good.fit','rb') as f, gzip.open(f'{OUT}/10x3_good.fit.gz','wb') as g: shutil.copyfileobj(f,g)
print('edge ok')
