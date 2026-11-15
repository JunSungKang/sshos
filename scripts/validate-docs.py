#!/usr/bin/env python3
"""Read-only documentation/provenance checks, not product or translation certification."""
import argparse
import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

sys.dont_write_bytecode = True
APPROVED_SCOPE = '22b572637f890232b8971d14d46ee72414bbbf2276360063f54c71365ce535cb'
ARCHIVE = 'docs/developer/architecture/history/pre-english-20261115'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def active_documents(root):
    paths = [root / p for p in ('README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'SECURITY.md', 'design/README.md', '.github/pull_request_template.md')]
    paths += [p for p in (root / 'docs').rglob('*.md') if not p.is_relative_to(root / 'docs/developer/architecture/history')]
    paths.append(root / 'docs/developer/architecture/history/README.md')
    return sorted(set(paths))


def table(path, pattern):
    rows = {}
    for line in path.read_text().splitlines():
        if re.match(pattern, line):
            cells = [p.strip() for p in line.strip().strip('|').split('|')]
            if cells[0] in rows:
                raise ValueError('Duplicate table ID: ' + cells[0])
            rows[cells[0]] = cells
    return rows


def anchors(path):
    result, counts = set(), {}
    fenced = False
    for line in path.read_text().splitlines():
        if line.startswith('```'):
            fenced = not fenced
        if fenced or not re.match(r'^#{1,6} ', line):
            continue
        heading = re.sub(r'[*`]', '', line.split(' ', 1)[1].strip()).lower()
        slug = re.sub(r'[^\w\- ]', '', heading).replace(' ', '-')
        n = counts.get(slug, 0)
        counts[slug] = n + 1
        result.add(slug + ('-' + str(n) if n else ''))
    return result


def validate(root):
    errors = []
    def need(ok, message):
        if not ok:
            errors.append(message)
    def inside(relative):
        path = (root / relative).resolve()
        if not path.is_relative_to(root):
            raise ValueError('Path outside checkout: ' + relative)
        return path
    archive = inside(ARCHIVE)
    manifest = json.loads(inside('docs/developer/architecture/history/archive-manifest.json').read_text())
    need(manifest['snapshotRoot'] == ARCHIVE, 'Archive root changed')
    need(manifest['sourceRevision'] == '9018ee7ab81d014184f759f464128536147992af', 'Archive source revision changed')
    seen = set()
    for item in manifest['files']:
        need(item['originalPath'] not in seen, 'Duplicate archived original: ' + item['originalPath'])
        seen.add(item['originalPath'])
        path = inside(item['archivePath'])
        need(path == (archive / item['originalPath']).resolve() and path.is_relative_to(archive), 'Archive mapping escaped: ' + item['originalPath'])
        need(path.is_file() and sha(path) == item['sha256'], 'Archived bytes changed: ' + item['originalPath'])
    need(len(seen) == 127, 'Expected127 original files')
    spec_path = archive / 'docs/spec-v6.json'
    original = json.loads(spec_path.read_text())
    module_spec = importlib.util.spec_from_file_location('sshos_original_validator', archive / 'docs/validate-plan.py')
    legacy = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(legacy)
    legacy_result = legacy.validate(archive)
    need(legacy_result['planning_valid'], 'Original v6 validation failed: ' + '; '.join(legacy_result['errors']))
    need(legacy.digest(original) == APPROVED_SCOPE, 'Original approved scope changed')
    edition = json.loads(inside('docs/developer/architecture/contract-index.json').read_text())
    need(edition['edition'] == 'v6-english' and edition['productSpecVersion'] == 'v6', 'Wrong English edition')
    need(edition['originalSnapshotRoot'] == ARCHIVE and edition['originalSpec'] == str(spec_path.relative_to(root)), 'Original source mapping changed')
    need(edition['originalSpecSHA256'] == sha(spec_path) and edition['approvedOriginalScopeDigest'] == APPROVED_SCOPE, 'Original spec hash/digest mismatch')
    for field in ('domain', 'excluded', 'assumptions'):
        need(edition[field] == original[field], 'Original technical domain changed: ' + field)
    need(edition['originalArtifactDefinitions'] == original['artifacts'], 'Original artifact definitions changed')
    for group in ('requirements', 'tasks', 'checks'):
        need([x['id'] for x in edition[group]] == [x['id'] for x in original[group]], group + ' IDs/order changed')
    for translated, source in zip(edition['requirements'], original['requirements']):
        for key in ('id', 'priority', 'checks'):
            need(translated[key] == source[key], source['id'] + ' requirement mapping changed: ' + key)
        need(translated['originalContractReference'] == source['contract_reference'], source['id'] + ' source reference changed')
        need(all(translated.get(k) and not re.search('[가-힣]', translated[k]) for k in ('title', 'statement', 'acceptance')), source['id'] + ' incomplete English requirement')
    for translated, source in zip(edition['tasks'], original['tasks']):
        for key in ('id', 'depends_on', 'requirements', 'artifacts'):
            need(translated[key] == source[key], source['id'] + ' task mapping changed: ' + key)
        need(translated['completion_contract'] == 'docs/developer/guides/development-plan.md §15 ' + source['id'], source['id'] + ' completion reference changed')
    checklist = table(inside('docs/developer/guides/quality-security-checklist.md'), r'\| [FQS][0-9]+ \|')
    need(set(checklist) == {c['id'] for c in original['checks']}, 'Checklist IDs changed')
    for translated, source in zip(edition['checks'], original['checks']):
        for key, value in source.items():
            if key not in ('procedure', 'expected'):
                need(translated[key] == value, source['id'] + ' invariant changed: ' + key)
        content = json.dumps({k: source[k] for k in ('procedure', 'expected')}, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()
        need(translated['originalTextSHA256'] == hashlib.sha256(content).hexdigest(), source['id'] + ' original text provenance changed')
        need(all(translated.get(k) and not re.search('[가-힣]', translated[k]) for k in ('procedure', 'expected')), source['id'] + ' incomplete English procedure/result')
        expected = [translated['id'], ', '.join(translated['requirements']), translated['method'], translated['procedure'], translated['expected'], 'yes' if translated['required'] else 'no', translated['status']]
        need(checklist.get(source['id']) == expected, source['id'] + ' checklist/edition mismatch')
    trace = table(inside('docs/developer/architecture/requirement-traceability.md'), r'\| R[0-9]+ \|')
    need(set(trace) == {q['id'] for q in original['requirements']}, 'Traceability IDs changed')
    for q in edition['requirements']:
        row = trace.get(q['id'], [])
        need(len(row) == 6, q['id'] + ' traceability columns')
        if len(row) == 6:
            need(re.findall(r'D[0-9]{2}', row[4]) == [t['id'] for t in edition['tasks'] if q['id'] in t['requirements']], q['id'] + ' trace stages changed')
            need(re.findall(r'[FQS][0-9]{3}', row[5]) == q['checks'], q['id'] + ' trace checks changed')
    layout = {p.name for p in (root / 'docs').iterdir() if not p.name.startswith('.')}
    need(layout == {'README.md', 'ai-agent', 'developer'}, 'docs root must contain only index and audience directories')
    need({p.name for p in (root / 'docs/developer').iterdir() if not p.name.startswith('.')} == {'README.md', 'onboarding', 'architecture', 'guides'}, 'Developer audience architecture mismatch')
    documents = active_documents(root)
    fixed_messages = re.findall(r"[A-Z_]+:'([^']*)'", inside('src/shared/errors.ts').read_text())
    allowed_literals = fixed_messages + ['시오스']
    links = 0
    for path in documents:
        need(path.is_file(), 'Missing active document: ' + str(path.relative_to(root)))
        if not path.is_file():
            continue
        text = path.read_text()
        language_text = text
        for literal in allowed_literals:
            language_text = language_text.replace(literal, '')
        need(not re.search('[가-힣]', language_text), 'Untranslated maintained prose: ' + str(path.relative_to(root)))
        need(not re.search(r'\b(TODO|TBD|FIXME)\b', text), 'Unresolved placeholder: ' + str(path.relative_to(root)))
        for target in re.findall(r'\[[^\]]*\]\(([^)]+)\)', text):
            parsed = urlsplit(target)
            if parsed.scheme or parsed.netloc:
                continue
            resolved = (path.parent / unquote(parsed.path)).resolve() if parsed.path else path
            links += 1
            need(resolved.is_relative_to(root) and resolved.exists(), 'Broken/escaped link: ' + str(path.relative_to(root)) + ' -> ' + target)
            if parsed.fragment and resolved.is_file() and resolved.suffix == '.md':
                need(unquote(parsed.fragment) in anchors(resolved), 'Broken heading anchor: ' + target)
    active = json.loads(inside('docs/developer/architecture/documentation-manifest.json').read_text())
    need(set(active['documents']) == {str(p.relative_to(root)) for p in documents}, 'Active document manifest set changed')
    for rel, expected_hash in {**active['documents'], **active['inputs']}.items():
        path = inside(rel)
        need(path.is_file() and sha(path) == expected_hash, 'Active document/input hash stale: ' + rel)
    for rel in ('scripts/install.mjs', 'scripts/windows-toolset.mjs', 'scripts/package-after-pack.cjs', 'tests/unit/diagnostic-log.test.ts', '.github/workflows/planning-docs.yml', 'NOTICE', '.gitattributes'):
        text = inside(rel).read_text()
        need(not re.search(r'docs/(?:0[1-9]-|development/|governance/|history/|spec-v6|dependency-baseline|third-party)', text), 'Stale live documentation consumer: ' + rel)
    vendor = json.loads(inside('docs/developer/architecture/third-party/windows-launcher-manifest.json').read_text())
    for rel, expected_hash in vendor['files'].items():
        need(sha(inside('docs/developer/architecture/third-party/' + rel)) == expected_hash, 'Upstream bytes changed: ' + rel)
    return {'documentation_valid': not errors, 'edition': edition['edition'], 'requirements': len(edition['requirements']), 'stages': len(edition['tasks']), 'checks': len(edition['checks']), 'required_technical_checks': sum(c['required'] for c in edition['checks']), 'product_acceptance': 'all152 remain untested', 'preserved_files': len(seen), 'original_scope_digest': legacy_result['scope_digest'], 'original_validation': legacy_result['planning_valid'], 'active_english_documents': len(documents), 'local_links_checked': links, 'errors': errors, 'limitation': 'Documentation structure/provenance/mappings only; not semantic translation, product, native, license or release certification.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parent.parent)
    args = parser.parse_args()
    try:
        result = validate(args.root.resolve())
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
        result = {'documentation_valid': False, 'errors': [str(exc)]}
    print(json.dumps(result, indent=2, ensure_ascii=False))
    raise SystemExit(0 if result['documentation_valid'] else 1)
