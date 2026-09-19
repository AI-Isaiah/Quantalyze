# [164.8.4-01] The ONE shared psql/CLI-stderr redaction definition for both CI workflows.
#
# Why this file exists: eight hand-copied inline `sed -E` blocks (three in
# .github/workflows/ci.yml, five in .github/workflows/test-restore-from-baseline.yml) each
# redacted a different subset of the shapes psql and the Supabase CLI print on a connect,
# auth, or DNS failure against shared TEST. No single block carried every shape — some
# blocks masked the DSN-embedded credential and the two human-readable connect/auth
# phrases but missed the key=value connection-string form and the DNS-resolution-failure
# phrase; others masked the key=value form but missed DNS resolution. There was no
# "correct block" to copy forward. This file is the UNION of every shape measured across
# all eight, so every call site closes every gap at once instead of drifting again.
#
# Invocation: always `-E -f` (extended regex, script-from-file), never a chained `-e`
# list. Every reference to this file MUST be workspace-rooted
# ("${GITHUB_WORKSPACE}/scripts/redact-psql-stderr.sed") rather than a bare relative
# path — at least one converted job runs its steps with a non-repo-root
# `working-directory`, where a relative reference would not resolve and (because the
# call site's own failure handling swallows a missing-script error) the redaction would
# silently do nothing.
#
# This header intentionally does not restate any expression's regex source text — the
# shapes are described in prose above and below, and a repo-owned gate scans the two
# workflow files for the actual regex source strings to prove no inline copy survives
# outside this file; quoting one here would give that gate a false positive to ignore.
#
# Last derived: 2026-09-19, from the eight inline blocks it replaces.

s#(postgres(ql)?://)[^@]*@#\1***@#g
s#(host=)[^ "]*#\1***#g
s#(user=)[^ "]*#\1***#g
s#(server at )"[^"]*"( \([^)]*\))?#\1"***"#g
s#(could not translate host name )"[^"]*"#\1"***"#g
s#(for user )"[^"]*"#\1"***"#g
