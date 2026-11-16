#!/usr/bin/env python3
"""Validate public documentation without requiring private planning material."""
import argparse,json,re,subprocess
from pathlib import Path
from urllib.parse import unquote,urlsplit

def validate(root):
    errors=[];links=0
    tracked=subprocess.check_output(['git','ls-files','-z'],cwd=root).decode().split('\0')
    private=re.compile(r'(^docs/(?:governance|development|history)/|^docs/\d{2}-|^docs/.*(?:plan|sprint|spec-v\d|contract-index|quality-security-checklist|requirement-traceability|acceptance|session-decision)|^docs/developer/architecture/history/)',re.I)
    for name in tracked:
        if private.search(name):errors.append('Private planning path tracked: '+name)
        elif name and (name.startswith(('docs/','.local/','.github/','design/mockups/')) or name=='design/preview-prompt.txt') and subprocess.run(['git','check-ignore','--no-index','--quiet',name],cwd=root).returncode==0:errors.append('Local-only path staged/tracked: '+name)
    files=[root/name for name in tracked if name.endswith('.md') and (name.startswith('docs/') or name in ['README.md','AGENTS.md','CONTRIBUTING.md','SECURITY.md','design/README.md'])]
    for path in files:
        if not path.is_file():errors.append('Missing public document: '+str(path.relative_to(root)));continue
        for target in re.findall(r'\[[^\]]*\]\(([^)]+)\)',path.read_text()):
            parsed=urlsplit(target)
            if parsed.scheme or parsed.netloc:continue
            dest=(path.parent/unquote(parsed.path)).resolve() if parsed.path else path
            links+=1
            if not dest.is_relative_to(root):errors.append('Escaped link: '+target)
            elif not dest.exists():errors.append('Broken link: '+str(path.relative_to(root))+' -> '+target)
            elif private.search(str(dest.relative_to(root))):errors.append('Public link to private planning: '+target)
    return {'documentation_valid':not errors,'public_documents':len(files),'links_checked':links,'errors':errors,'limitation':'Public documentation only; private implementation plans and native/product acceptance are separate.'}
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,default=Path(__file__).resolve().parent.parent);args=p.parse_args();result=validate(args.root.resolve());print(json.dumps(result,indent=2));raise SystemExit(0 if result['documentation_valid'] else 1)
