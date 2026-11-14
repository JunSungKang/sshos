#!/usr/bin/env python3
"""Read-only v6 documentation checks. Does not execute or certify the product."""
import argparse
import hashlib
import json
import re
from pathlib import Path

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def digest(spec):
    data={k:v for k,v in spec.items() if k not in ('approval','artifacts','checks')}
    data['artifacts']=[{k:v for k,v in a.items() if k!='sha256'} for a in spec['artifacts']]
    data['checks']=[{k:v for k,v in c.items() if k not in ('status','evidence','reason','artifact_hashes')} for c in spec['checks']]
    return hashlib.sha256(json.dumps(data,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()

def rows(path,pattern):
    found={}
    for line in path.read_text().splitlines():
        if re.match(pattern,line):
            cols=[x.strip() for x in line.strip().strip('|').split('|')]
            if cols[0] in found: raise ValueError('Duplicate table ID '+cols[0])
            found[cols[0]]=cols
    return found

def validate(root):
    errors=[]
    def need(ok,msg):
        if not ok: errors.append(msg)
    spec=json.loads((root/'docs/spec-v6.json').read_text())
    tables={name:{x['id']:x for x in spec[name]} for name in ('requirements','tasks','artifacts','checks')}
    for name,table in tables.items(): need(len(table)==len(spec[name]),'duplicate '+name)
    need(spec['version']=='v6','wrong version')
    need(set(tables['requirements'])=={f'R{i:02d}' for i in range(1,39)},'requirements must be R01-R38')
    need(set(tables['tasks'])=={f'D{i:02d}' for i in range(1,14)},'tasks must be D01-D13')
    for key in ('online_error_search','ai_summary','remote_gui','server_agent','application_database','external_change_auto_sync'):
        need(spec['domain'][key]=='excluded','exclusion missing '+key)
    need(spec['domain']['framework']=='Electron','framework mismatch')
    for key in ('internal_desktop','text_image_viewers','user_remote_exec','ssh_pty'):
        need(spec['domain'][key]=='included','feature missing '+key)
    need(spec['domain']['probe_command']=='/bin/true' and spec['domain']['probe_only_allowlist'] is True,'probe contract mismatch')
    req=tables['requirements']; tasks=tables['tasks']; checks=tables['checks']; artifacts=tables['artifacts']
    for rid,q in req.items():
        need(bool(q['acceptance']) and bool(q['checks']),rid+' acceptance/checks empty')
        need(any(rid in t['requirements'] for t in tasks.values()),rid+' no task')
        need(set(q['checks'])=={cid for cid,c in checks.items() if rid in c['requirements']},rid+' inverse check mismatch')
    for tid,t in tasks.items():
        need(bool(t['requirements']) and bool(t['artifacts']),tid+' empty mapping')
        for rid in t['requirements']: need(rid in req,tid+' unknown '+rid)
        for aid in t['artifacts']: need(aid in artifacts,tid+' unknown '+aid)
        for dep in t['depends_on']: need(dep in tasks and dep!=tid,tid+' invalid dependency '+dep)
    def visit(tid,stack,done):
        if tid in stack: errors.append('task dependency cycle '+tid); return
        if tid in done:return
        for dep in tasks[tid]['depends_on']:
            if dep in tasks:visit(dep,stack|{tid},done)
        done.add(tid)
    done=set()
    for tid in tasks:visit(tid,set(),done)
    checklist=rows(root/'docs/06-quality-security-checklist.md',r'\| [FQS][0-9]+ \|')
    need(set(checklist)==set(checks),'checklist IDs mismatch')
    for cid,c in checks.items():
        need(c['method'] in ('automatic','visual','manual','target'),cid+' bad method')
        need(c['status']=='untested',cid+' product test claimed before implementation')
        need(c['required']==(cid not in ('Q019','Q020','Q021')),cid+' wrong release criticality')
        for rid in c['requirements']:need(rid in req,cid+' unknown '+rid)
        for aid in c['artifacts']:need(aid in artifacts,cid+' unknown '+aid)
        cols=checklist.get(cid,[])
        need(len(cols)==7,cid+' table column count')
        if len(cols)==7:
            need(re.findall(r'R[0-9]{2}',cols[1])==c['requirements'],cid+' requirement mismatch')
            need(cols[2:5]==[c['method'],c['procedure'],c['expected']],cid+' contract mismatch')
            need(cols[5]==('yes' if c['required'] else 'no') and cols[6]==c['status'],cid+' status mismatch')
    trace=rows(root/'docs/08-requirement-traceability.md',r'\| R[0-9]+ \|')
    need(set(trace)==set(req),'trace requirements mismatch')
    for rid,cols in trace.items():
        need(len(cols)==5,rid+' trace columns')
        if len(cols)==5:
            need(set(re.findall(r'[FQS][0-9]{3}',cols[4]))==set(req[rid]['checks']),rid+' trace checks')
            need(set(re.findall(r'D[0-9]{2}',cols[3]))=={tid for tid,t in tasks.items() if rid in t['requirements']},rid+' trace tasks')
    for name,h in spec['domain']['normative_contract_hashes'].items():
        path=(root/name).resolve();need(path.is_relative_to(root) and path.is_file(),'normative contract missing '+name)
        if path.is_file():need(sha(path)==h,'normative contract hash stale '+name)
    checked=[];links=0
    for aid,a in artifacts.items():
        path=(root/a['path']).resolve();need(path.is_relative_to(root),aid+' outside root')
        if a['kind']!='planning':continue
        need(path.is_file(),aid+' missing '+a['path'])
        if not path.is_file():continue
        need(sha(path)==a['sha256'],aid+' stale hash '+a['path']);checked.append(a['path'])
        if path.suffix=='.md':
            text=path.read_text();need(not re.search(r'\b(TODO|TBD|FIXME)\b',text),aid+' unresolved placeholder')
            for link in re.findall(r'\[[^\]]*\]\(([^)]+)\)',text):
                if re.match(r'[a-zA-Z]+:',link) or link.startswith('#'):continue
                target=(path.parent/link.split('#',1)[0]).resolve();links+=1
                need(target.is_relative_to(root) and target.exists(),aid+' broken link '+link)
    archives=0
    for manifest in (root/'docs/history').rglob('archive-manifest.json'):
        data=json.loads(manifest.read_text())
        for item in data['files']:
            path=(root/item['archive']).resolve() if 'archive' in item else (manifest.parent/item['path']).resolve()
            need(path.is_relative_to(root/'docs/history') and path.is_file(),'archive path missing')
            if path.is_file():need(sha(path)==item['sha256'],'archive changed '+str(path.relative_to(root)))
            archives+=1
    baseline=json.loads((root/'docs/dependency-baseline-v6.json').read_text())
    need(baseline['version']=='v6','dependency version')
    packages={p['name'] for p in baseline['packages']}
    need({'electron','ssh2','@xterm/xterm','@xterm/addon-fit'}<=packages,'missing dependencies')
    need(not {'node-pty','react-rnd'}&packages,'unselected dependency')
    for p in baseline['packages']:need(bool(re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+',p['version'])),'nonexact dependency '+p['name'])
    need(not (root/'src').exists() and not (root/'node_modules').exists(),'unexpected implementation/installation')
    status=json.loads((root/'docs/planning-status.json').read_text())
    need(status['version']=='v6' and status['scope_digest']==digest(spec),'status version/digest mismatch')
    need(status['implementation_started'] is False and spec['approval']['status']=='pending','implementation approval misrepresented')
    for name,h in status['document_hashes'].items():
        path=(root/name).resolve();need(path.is_relative_to(root) and path.is_file(),'status missing '+name)
        if path.is_file():need(sha(path)==h,'status stale hash '+name)
    return {'planning_valid':not errors,'version':'v6','requirements':len(req),'tasks':len(tasks),'checks':len(checks),'required_technical_checks':sum(c['required'] for c in checks.values()),'nonblocking_research_checks':sum(not c['required'] for c in checks.values()),'product_checks':'all untested','planning_artifacts':len(checked),'local_links_checked':links,'archived_file_hashes_verified':archives,'scope_digest':digest(spec),'errors':errors,'limitation':'Documentation consistency only; no product/runtime/security certification.'}

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--root',type=Path,default=Path(__file__).resolve().parent.parent);args=ap.parse_args()
    try: result=validate(args.root.resolve())
    except (OSError,ValueError,KeyError,TypeError) as exc:result={'planning_valid':False,'errors':[str(exc)]}
    print(json.dumps(result,ensure_ascii=False,indent=2));raise SystemExit(0 if result['planning_valid'] else 1)
