#!/usr/bin/env python3
"""Validate planning artifacts and traceability; does not test the product."""
import argparse
import hashlib
import json
import re
from pathlib import Path

def digest(d):
    s={k:v for k,v in d.items() if k not in ("approval","artifacts","checks")}
    s["artifacts"]=[{k:v for k,v in a.items() if k!="sha256"} for a in d["artifacts"]]
    s["checks"]=[{k:v for k,v in c.items() if k not in ("status","evidence","reason","artifact_hashes")} for c in d["checks"]]
    return hashlib.sha256(json.dumps(s,ensure_ascii=False,sort_keys=True,separators=(",",":")).encode()).hexdigest()

def validate(root):
    errors=[]
    def require(ok,msg):
        if not ok: errors.append(msg)
    spec=json.loads((root/"docs/spec-v5.json").read_text())
    tables={k:{x["id"]:x for x in spec[k]} for k in ("requirements","tasks","artifacts","checks")}
    for k,t in tables.items(): require(len(t)==len(spec[k]),"duplicate ID in "+k)
    require(set(tables["requirements"])=={f"R{i:02d}" for i in range(1,33)},"requirement set differs")
    require(spec["version"]=="v5","wrong version")
    require(spec["domain"]["framework"]=="Electron","wrong framework")
    require(spec["domain"]["online_error_search"]=="excluded","search not excluded")
    require(spec["domain"]["ai_summary"]=="excluded","AI summary not excluded")
    for rid,row in tables["requirements"].items():
        require(bool(row["acceptance"]),rid+" empty acceptance")
        require(bool(row["checks"]),rid+" no checks")
        require(any(rid in t["requirements"] for t in tables["tasks"].values()),rid+" no task")
        for cid in row["checks"]: require(cid in tables["checks"] and rid in tables["checks"][cid]["requirements"],rid+" invalid check "+cid)
    for tid,t in tables["tasks"].items():
        for rid in t["requirements"]: require(rid in tables["requirements"],tid+" invalid requirement "+rid)
        for aid in t["artifacts"]: require(aid in tables["artifacts"],tid+" invalid artifact "+aid)
    for cid,c in tables["checks"].items():
        require(c["method"] in ("automatic","visual","manual","target"),cid+" bad method")
        require(c["required"] is True,cid+" optional check")
        if not spec["domain"]["implementation_started"]:require(c["status"]=="untested",cid+" product test claimed before implementation")
        for rid in c["requirements"]:require(rid in tables["requirements"],cid+" invalid requirement "+rid)
        for aid in c["artifacts"]:require(aid in tables["artifacts"],cid+" invalid artifact "+aid)
    actual_rows={}
    for line in (root/"docs/06-quality-security-checklist.md").read_text().splitlines():
        if re.match(r"\| [FQS][0-9]+ \|",line):
            cols=[x.strip() for x in line.strip().strip("|").split("|")]
            require(len(cols)==7,"malformed checklist row: "+line[:30])
            if len(cols)==7:actual_rows[cols[0]]=cols
    require(set(actual_rows)==set(tables["checks"]),"checklist and spec IDs differ")
    for cid,cols in actual_rows.items():
        c=tables["checks"].get(cid)
        if c:
            require(re.findall(r"R[0-9]{2}",cols[1])==c["requirements"],cid+" requirements differ")
            require(cols[2]==c["method"],cid+" method differs")
            require(cols[3]==c["procedure"] and cols[4]==c["expected"],cid+" procedure/expected differs")
            require(cols[5]=="yes" and cols[6]==c["status"],cid+" required/status differs")
    checked_files=[]
    for aid,a in tables["artifacts"].items():
        p=(root/a["path"]).resolve()
        require(p.is_relative_to(root),aid+" path escapes root")
        if a.get("kind")=="planning":
            require(p.is_file(),aid+" missing planning artifact")
            if p.is_file():
                require(hashlib.sha256(p.read_bytes()).hexdigest()==a["sha256"],aid+" stale hash")
                checked_files.append(a["path"])
                if p.suffix==".md":
                    text=p.read_text()
                    require(not re.search(r"TBD|TODO|FIXME|pending_user_decision|awaiting_user_framework",text),aid+" unresolved marker")
                    for link in re.findall(r"\[[^\]]*\]\(([^)]+)\)",text):
                        if re.match(r"[a-zA-Z]+:",link) or link.startswith("#"): continue
                        dest=(p.parent/link.split("#",1)[0]).resolve()
                        require(dest.is_relative_to(root) and dest.exists(),aid+" broken local link "+link)
    archive=root/"docs/history/v4-draft-20261114"
    manifest=json.loads((archive/"archive-manifest.json").read_text())
    for a in manifest["files"]:
        p=(archive/a["path"]).resolve()
        require(p.is_relative_to(archive) and p.is_file(),"archive missing "+a["path"])
        if p.is_file():require(hashlib.sha256(p.read_bytes()).hexdigest()==a["sha256"],"archive changed "+a["path"])
    baseline=json.loads((root/"docs/dependency-baseline-v5.json").read_text())
    for item in baseline["packages"]:require(bool(re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+",item["version"])),"nonexact dependency "+item["name"])
    if not spec["domain"]["implementation_started"]:
        require(not (root/"src").exists(),"implementation source exists")
        require(not (root/"node_modules").exists(),"dependencies were installed")
    return {"planning_valid":not errors,"version":spec["version"],"requirements":len(tables["requirements"]),"tasks":len(tables["tasks"]),"checks":len(tables["checks"]),"product_checks":"untested" if not spec["domain"]["implementation_started"] else "see spec","planning_artifacts":len(checked_files),"scope_digest":digest(spec),"errors":errors,"limitation":"Structural and documentation checks only; no product or security certification."}

if __name__=="__main__":
    ap=argparse.ArgumentParser();ap.add_argument("--root",type=Path,default=Path(__file__).resolve().parent.parent);args=ap.parse_args()
    result=validate(args.root.resolve());print(json.dumps(result,ensure_ascii=False,indent=2));raise SystemExit(0 if result["planning_valid"] else 1)
