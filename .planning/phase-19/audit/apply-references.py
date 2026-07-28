#!/usr/bin/env python3
"""Apply rename-map.csv to file references in code/tests/docs.

Replaces every occurrence of `supabase/migrations/NNN[a-z]?_<canonical>.sql`
with `supabase/migrations/<new_ts>_<canonical>.sql` across the repo (excluding
node_modules, .planning, .git, supabase/migrations themselves).
"""
import csv
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]

mapping = {}
with open(Path(__file__).parent / 'pr-y1-rename-map.csv') as f:
    reader = csv.DictReader(f)
    for row in reader:
        old = row['old_filename']  # e.g. 047b_used_ack_tokens.sql
        new = row['new_filename']  # e.g. 20260416125428_used_ack_tokens.sql
        # Old NNN prefix (e.g. 047b) → new TS prefix (e.g. 20260416125428).
        m = re.match(r'^(\d{3}[a-z]?)_', old)
        if not m:
            continue
        old_prefix = m.group(1)
        new_prefix = new.split('_')[0]
        canonical = row['canonical_name']
        # Key: (old_prefix, canonical). Value: new_prefix.
        mapping[(old_prefix, canonical)] = new_prefix

# Build the replace regex: a path-bound match.
# Match: supabase/migrations/<NNN>_<canonical>(.sql)?  (allow with or without .sql)
# We must replace each according to mapping[(NNN, canonical)].
# Use a function-based re.sub.

# Pattern: supabase/migrations/<digits>(letter?)_<word_chars>
# Capture (1) full NNN[letter], (2) trailing identifier (snake_case), (3) optional .sql
PATTERN = re.compile(r'(supabase/migrations/)(\d{3}[a-z]?)_([a-z][a-z0-9_]*?)(\.sql)?\b')

def repl(m):
    prefix_dir = m.group(1)
    nnn = m.group(2)
    canon = m.group(3)
    dotsql = m.group(4) or ''
    key = (nnn, canon)
    if key in mapping:
        return f'{prefix_dir}{mapping[key]}_{canon}{dotsql}'
    return m.group(0)

# Walk all files, skipping excluded dirs.
EXCLUDED_DIRS = {'.git', 'node_modules', '.next', '.planning', '.venv', 'venv', 'dist', 'build', 'coverage', '__pycache__'}
INCLUDE_SUFFIXES = {'.py', '.ts', '.tsx', '.sh', '.yml', '.yaml', '.md', '.sql'}

changed_files = []
for path in ROOT.rglob('*'):
    if not path.is_file():
        continue
    if any(part in EXCLUDED_DIRS for part in path.parts):
        continue
    # Skip the migrations directory itself
    if 'supabase/migrations' in str(path) and path.suffix == '.sql':
        # But still process them — the files might cross-reference each other.
        pass
    if path.suffix not in INCLUDE_SUFFIXES:
        continue
    try:
        text = path.read_text(encoding='utf-8')
    except (UnicodeDecodeError, PermissionError):
        continue
    new_text, count = PATTERN.subn(repl, text)
    if count > 0 and new_text != text:
        path.write_text(new_text, encoding='utf-8')
        changed_files.append((str(path.relative_to(ROOT)), count))

print(f'Updated {len(changed_files)} files')
for f, c in changed_files[:40]:
    print(f'  {c:3d}  {f}')
if len(changed_files) > 40:
    print(f'  ... and {len(changed_files)-40} more')
