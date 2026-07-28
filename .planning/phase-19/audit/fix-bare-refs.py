#!/usr/bin/env python3
"""Fix bare-filename references the original apply-references.py missed.

The original script only matched paths with `supabase/migrations/` prefix.
Bare filenames in backticks (e.g. `011_perfect_match.sql`) in docs/runbooks/
audit/CHANGELOG/tests were left untouched. Same for `NNN_*.sql` wildcards
and `NNN-rollback.sql` rollback references.
"""
import csv
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]

mapping = {}
with open(Path(__file__).parent / 'pr-y1-rename-map.csv') as f:
    reader = csv.DictReader(f)
    for row in reader:
        old = row['old_filename']
        new = row['new_filename']
        m = re.match(r'^(\d{3}[a-z]?)_', old)
        if not m:
            continue
        old_prefix = m.group(1)
        new_prefix = new.split('_')[0]
        canonical = row['canonical_name']
        mapping[(old_prefix, canonical)] = new_prefix

# Apply chronological-inversion fix: 120/125/126 were re-renamed AFTER apply-references ran
chrono_fix = {
    ('120', 'sanitize_user_hardening'): '20260513073518',
    ('125', 'guard_wizard_draft_updates_auth_uid'): '20260513082230',
    ('126', 'wizard_rpc_bypass_flag'): '20260513084844',
}
mapping.update(chrono_fix)

# Build NNN→new_prefix map (without canonical) for rollback files and wildcards
nnn_to_ts = {}
for (nnn, canon), ts in mapping.items():
    nnn_to_ts[nnn] = ts

# Pattern 1: bare full-name references (no path prefix), e.g. `011_perfect_match.sql`
# Pattern 2: rollback files, e.g. `132-rollback.sql`
# Pattern 3: wildcards, e.g. `129_*.sql`

BARE_FULL = re.compile(r'(?<![/\w])(\d{3}[a-z]?)_([a-z][a-z0-9_]*)\.sql\b')
BARE_ROLLBACK = re.compile(r'(?<![/\w])(\d{3}[a-z]?)-rollback\.sql\b')
BARE_WILDCARD = re.compile(r'(?<![/\w])(\d{3}[a-z]?)_\*\.sql\b')

def repl_bare_full(m):
    nnn = m.group(1)
    canon = m.group(2)
    if (nnn, canon) in mapping:
        return f'{mapping[(nnn, canon)]}_{canon}.sql'
    return m.group(0)

def repl_rollback(m):
    nnn = m.group(1)
    if nnn in nnn_to_ts:
        return f'{nnn_to_ts[nnn]}-rollback.sql'
    return m.group(0)

def repl_wildcard(m):
    nnn = m.group(1)
    if nnn in nnn_to_ts:
        return f'{nnn_to_ts[nnn]}_*.sql'
    return m.group(0)

EXCLUDED_DIRS = {'.git', 'node_modules', '.next', '.planning', '.venv', 'venv', 'dist', 'build', 'coverage', '__pycache__', '.claude'}
INCLUDE_SUFFIXES = {'.py', '.ts', '.tsx', '.sh', '.yml', '.yaml', '.md', '.sql'}

changed_files = []
for path in ROOT.rglob('*'):
    if not path.is_file():
        continue
    if any(part in EXCLUDED_DIRS for part in path.parts):
        continue
    if path.suffix not in INCLUDE_SUFFIXES:
        continue
    # Skip migration files themselves — they reference one another by NNN intentionally as historical record
    if 'supabase/migrations' in str(path) and path.suffix == '.sql':
        continue
    try:
        text = path.read_text(encoding='utf-8')
    except (UnicodeDecodeError, PermissionError):
        continue
    new_text = text
    new_text = BARE_FULL.sub(repl_bare_full, new_text)
    new_text = BARE_ROLLBACK.sub(repl_rollback, new_text)
    new_text = BARE_WILDCARD.sub(repl_wildcard, new_text)
    if new_text != text:
        path.write_text(new_text, encoding='utf-8')
        # Count changes per pattern for reporting
        bare_diff = len(BARE_FULL.findall(text)) - len(BARE_FULL.findall(new_text))
        roll_diff = len(BARE_ROLLBACK.findall(text)) - len(BARE_ROLLBACK.findall(new_text))
        wild_diff = len(BARE_WILDCARD.findall(text)) - len(BARE_WILDCARD.findall(new_text))
        changed_files.append((str(path.relative_to(ROOT)), bare_diff + roll_diff + wild_diff))

print(f'Updated {len(changed_files)} files')
for f, c in changed_files[:40]:
    print(f'  {c:3d}  {f}')
if len(changed_files) > 40:
    print(f'  ... and {len(changed_files)-40} more')
