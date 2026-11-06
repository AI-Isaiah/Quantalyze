---
phase: 188-tinybase-a-day-measured-against-a-near-empty-account-does-no
plan: 12
subsystem: analytics
tags: [gap-closure, prod-reading, baseline]
completed: 2026-11-05
---

# Phase 188 Plan 12: PROD baseline before the gap-closure fix ships Summary

Read-only. Marker query first and alone in each session. Scratch, SQL and the ordinal map stay under `$HOME/.cache/quantalyze/tinybase-gc`; only counts and hashes are recorded here. Ordinals are the 188-11 map (key C, k1..k8).

marker-gc: PRODUCTION
gc-b-tracer: key=C rows=1163 last=2026-11-03 named=64 stored_on_named=8 rows_sha=88f4f3599493

## Full baseline (Task 2)

marker-gc: PRODUCTION
gc-baseline: capture=b0 taken=2026-11-05T08:32:31Z branch_head=3e7547bd2988097560d761c0b4362daf68d1ca29 main_head=98d293238a9a4da2eb73e65ea01f85e12abfc432 key_scopes=39 key_rows=11772 strategy_scopes=16 strategy_rows=3295 books=7 key_inputs=30 last_nightly_done=2026-11-05T01:38:22Z last_compose=2026-11-05T01:39:00Z ordinals=188-11
gc-b-key: key=C rows=1163 first=2023-06-28 last=2026-11-03 named=64 stored_on_named=8 rows_sha=88f4f3599493
gc-b-key: key=k1 rows=1163 first=2023-06-28 last=2026-11-03 named=64 stored_on_named=8 rows_sha=e4fc4d2d81d3
gc-b-key: key=k2 rows=1163 first=2023-06-28 last=2026-11-03 named=64 stored_on_named=8 rows_sha=117c60461638
gc-b-key: key=k3 rows=355 first=2025-10-17 last=2026-11-04 named=29 stored_on_named=0 rows_sha=d14ef4379679
gc-b-key: key=k4 rows=647 first=2024-12-07 last=2026-11-04 named=31 stored_on_named=0 rows_sha=46a555ab99b7
gc-b-key: key=k5 rows=647 first=2024-12-07 last=2026-11-04 named=31 stored_on_named=0 rows_sha=3d8bac30a708
gc-b-key: key=k6 rows=307 first=2025-11-15 last=2026-10-09 named=21 stored_on_named=0 rows_sha=bbd1d1d76e44
gc-b-key: key=k7 rows=307 first=2025-11-15 last=2026-10-09 named=21 stored_on_named=0 rows_sha=bbd1d1d76e44
gc-b-key: key=k8 rows=355 first=2025-10-17 last=2026-11-04 named=29 stored_on_named=0 rows_sha=869361cc31f3
gc-b-key: key=k9 rows=284 first=2025-09-27 last=2026-07-08 named=0 stored_on_named=0 rows_sha=bec16fdeb94c
gc-b-key: key=k10 rows=387 first=2025-09-27 last=2026-11-04 named=0 stored_on_named=0 rows_sha=e0f300ca1f51
gc-b-key: key=k11 rows=100 first=2026-02-28 last=2026-06-07 named=0 stored_on_named=0 rows_sha=592fb128842a
gc-b-key: key=k12 rows=155 first=2026-01-22 last=2026-06-25 named=0 stored_on_named=0 rows_sha=2bd1003cdc68
gc-b-key: key=k13 rows=217 first=2026-04-02 last=2026-11-04 named=0 stored_on_named=0 rows_sha=77b1e87af1f1
gc-b-key: key=k14 rows=99 first=2026-07-29 last=2026-11-04 named=0 stored_on_named=0 rows_sha=94fb382f3631
gc-b-key: key=k15 rows=286 first=2026-01-23 last=2026-11-04 named=0 stored_on_named=0 rows_sha=6a4234cd3105
gc-b-key: key=k16 rows=100 first=2026-02-28 last=2026-06-07 named=0 stored_on_named=0 rows_sha=384ce09cb8e6
gc-b-key: key=k17 rows=0 first=none last=none named=0 stored_on_named=0 rows_sha=e3b0c44298fc
gc-b-key: key=k18 rows=195 first=2026-02-28 last=2026-11-04 named=0 stored_on_named=0 rows_sha=868167929c2b
gc-b-key: key=k19 rows=95 first=2026-08-02 last=2026-11-04 named=0 stored_on_named=0 rows_sha=ae0bbb713e87
gc-b-key: key=k20 rows=180 first=2026-01-22 last=2026-07-20 named=0 stored_on_named=0 rows_sha=352c4def350a
gc-b-key: key=k21 rows=229 first=2026-03-21 last=2026-11-04 named=0 stored_on_named=0 rows_sha=71cd1a1a6842
gc-b-key: key=k22 rows=100 first=2026-02-28 last=2026-06-07 named=0 stored_on_named=0 rows_sha=67e7a7cbc131
gc-b-key: key=k23 rows=155 first=2026-01-22 last=2026-06-25 named=0 stored_on_named=0 rows_sha=73641e7ae3d4
gc-b-key: key=k24 rows=95 first=2026-08-02 last=2026-11-04 named=0 stored_on_named=0 rows_sha=737883206a48
gc-b-key: key=k25 rows=155 first=2026-01-22 last=2026-06-25 named=0 stored_on_named=0 rows_sha=2bd1003cdc68
gc-b-key: key=k26 rows=387 first=2025-09-27 last=2026-11-04 named=0 stored_on_named=0 rows_sha=b7d60ca5ffc9
gc-b-key: key=k27 rows=195 first=2026-02-28 last=2026-11-04 named=0 stored_on_named=0 rows_sha=bea184dd8ea7
gc-b-key: key=k28 rows=100 first=2026-02-28 last=2026-06-07 named=0 stored_on_named=0 rows_sha=5db044047b7d
gc-b-key: key=k29 rows=284 first=2025-09-27 last=2026-07-08 named=0 stored_on_named=0 rows_sha=bec16fdeb94c
gc-b-key: key=k30 rows=229 first=2026-03-21 last=2026-11-04 named=0 stored_on_named=0 rows_sha=1f68efbfa0cc
gc-b-key: key=k31 rows=284 first=2025-09-27 last=2026-07-08 named=0 stored_on_named=0 rows_sha=bec16fdeb94c
gc-b-key: key=k32 rows=195 first=2026-02-28 last=2026-11-04 named=0 stored_on_named=0 rows_sha=4b926a31dc0d
gc-b-key: key=k33 rows=229 first=2026-03-21 last=2026-11-04 named=0 stored_on_named=0 rows_sha=ce46f58f2030
gc-b-key: key=k34 rows=180 first=2026-01-22 last=2026-07-20 named=0 stored_on_named=0 rows_sha=000eb7abe0c1
gc-b-key: key=k35 rows=100 first=2026-07-28 last=2026-11-04 named=0 stored_on_named=0 rows_sha=ed1f7faed674
gc-b-key: key=k36 rows=387 first=2025-09-27 last=2026-11-04 named=0 stored_on_named=0 rows_sha=cb06aa33777e
gc-b-key: key=k37 rows=100 first=2026-02-28 last=2026-06-07 named=0 stored_on_named=0 rows_sha=d17a07d6f737
gc-b-key: key=k38 rows=163 first=2026-05-26 last=2026-11-04 named=0 stored_on_named=0 rows_sha=118a7948f648
gc-b-strategy: strategy=s1 rows=255 first=2026-02-23 last=2026-11-04 named=0 stored_on_named=0 rows_sha=fecd554a2b6d
gc-b-strategy: strategy=s2 rows=382 first=2025-10-17 last=2026-11-02 named=0 stored_on_named=0 rows_sha=f005e8a6fe73
gc-b-strategy: strategy=s3 rows=99 first=2026-07-29 last=2026-11-04 named=0 stored_on_named=0 rows_sha=94fb382f3631
gc-b-strategy: strategy=s4 rows=162 first=2026-05-26 last=2026-11-03 named=0 stored_on_named=0 rows_sha=8f1dcd2ba3f6
gc-b-strategy: strategy=s5 rows=227 first=2026-03-21 last=2026-11-02 named=0 stored_on_named=0 rows_sha=935528278a14
gc-b-strategy: strategy=s6 rows=97 first=2026-07-28 last=2026-11-01 named=0 stored_on_named=0 rows_sha=675dd9f8c507
gc-b-strategy: strategy=s7 rows=307 first=2025-11-15 last=2026-10-09 named=21 stored_on_named=0 rows_sha=bbd1d1d76e44
gc-b-strategy: strategy=s8 rows=227 first=2026-03-21 last=2026-11-02 named=0 stored_on_named=0 rows_sha=752e8a15f06a
gc-b-strategy: strategy=s9 rows=381 first=2025-10-17 last=2026-11-01 named=0 stored_on_named=0 rows_sha=1babf01979ec
gc-b-strategy: strategy=s10 rows=214 first=2026-04-02 last=2026-11-01 named=0 stored_on_named=0 rows_sha=84d42121a279
gc-b-strategy: strategy=s11 rows=25 first=2026-02-23 last=2026-05-15 named=0 stored_on_named=0 rows_sha=70f4d92d0d9e
gc-b-strategy: strategy=s12 rows=26 first=2026-07-29 last=2026-08-25 named=0 stored_on_named=0 rows_sha=c3a77bdcc850
gc-b-strategy: strategy=s13 rows=227 first=2026-03-21 last=2026-11-02 named=0 stored_on_named=0 rows_sha=b0ccf892e76f
gc-b-strategy: strategy=s14 rows=286 first=2026-01-23 last=2026-11-04 named=0 stored_on_named=0 rows_sha=6a4234cd3105
gc-b-strategy: strategy=s15 rows=191 first=2026-02-23 last=2026-11-04 named=0 stored_on_named=0 rows_sha=a100dff50077
gc-b-strategy: strategy=s16 rows=189 first=2026-04-30 last=2026-11-04 named=0 stored_on_named=0 rows_sha=6da68b9e7d07
gc-b-book: book=b1 trustworthy=true reasons=none keys=k32 returns=194 curve=195 composed_at=2026-11-05T01:38:22.710885+00:00
gc-b-book: book=b2 trustworthy=false reasons=classified_rotation,key_inputs_mismatch,window_truncated keys=k2,k5,k7,k17,k21,k24,k30,k36,k38 returns=900 curve=1227 composed_at=2026-11-05T01:36:59.535759+00:00
gc-b-book: book=b3 trustworthy=false reasons=key_inputs_mismatch,out_of_window_flow,window_truncated keys=C,k4,k8,k10,k14,k15,k35 returns=900 curve=1227 composed_at=2026-11-05T01:37:02.714330+00:00
gc-b-book: book=b4 trustworthy=true reasons=none keys=k27 returns=194 curve=195 composed_at=2026-11-05T01:36:52.773548+00:00
gc-b-book: book=b5 trustworthy=true reasons=classified_rotation,window_truncated keys=k19,k34,k37 returns=193 curve=195 composed_at=2026-11-05T01:38:25.689941+00:00
gc-b-book: book=b6 trustworthy=true reasons=none keys=k18,k20 returns=194 curve=195 composed_at=2026-11-05T01:38:24.417549+00:00
gc-b-book: book=b7 trustworthy=false reasons=classified_rotation,key_inputs_mismatch,window_truncated keys=k1,k3,k6,k13,k26,k29,k33 returns=611 curve=1227 composed_at=2026-11-05T01:38:59.981355+00:00
gc-b-defect: stored_on_named_total=24 scopes=C,k1,k2 books_mismatch=3
gc-b-cron: schedule=40 0 * * *
gc-b-elig: key=C eligible=yes
gc-b-elig: key=k1 eligible=yes
gc-b-elig: key=k2 eligible=yes
gc-b-file: books.json sha256=9d4e4e58d5df4fcd7efcfa748b24abfcd1cc738a848821bd1faa8101cdb1c156
gc-b-file: books.json.err sha256=62835707570a9ebbe15a35d1358ce0bb347435832a004af19e2dc510fecc617a
gc-b-file: books.json.raw sha256=f6e1be3b42a02b6f764a941193b842f6d336dc9e058f8a62f4996a467446b022
gc-b-file: counts.json sha256=ff16c35f737454ca92589fc75a697c34153dc64af4151248734b8442e6728d66
gc-b-file: counts.json.err sha256=62835707570a9ebbe15a35d1358ce0bb347435832a004af19e2dc510fecc617a
gc-b-file: counts.json.raw sha256=1cd04d9312bde27585bff7aead05bef610cf8d974b2e6967a9df9c129ae8e4c7
gc-b-file: cron.json sha256=11a8a34c758ca36adee70d732969a3e79a440c881e41e4371268b48175d49c83
gc-b-file: cron.json.err sha256=62835707570a9ebbe15a35d1358ce0bb347435832a004af19e2dc510fecc617a
gc-b-file: cron.json.raw sha256=fc872d966cc3454be49b384b9b4b211f9e570ba7975fff842dac9c2c4b2cb86e
gc-b-file: elig.json sha256=46a85c7bfaeb82327edefe89ec9e3637d359fd75ac9c114f6db85f05b64c68cf
gc-b-file: elig.json.err sha256=62835707570a9ebbe15a35d1358ce0bb347435832a004af19e2dc510fecc617a
gc-b-file: elig.json.raw sha256=25f455f19f96d071474bf0733350115a56d029ff26156d2318ce580367553a7d
gc-b-file: jobs.json sha256=60bebbb2617cbef069deb80704d244d156dbbfc3850c687c2981fca93aae9afd
gc-b-file: jobs.json.err sha256=62835707570a9ebbe15a35d1358ce0bb347435832a004af19e2dc510fecc617a
gc-b-file: jobs.json.raw sha256=05b0194e3a961d5f66d9d24040849dac2737952d6aba38ea68f12c6ed5de69d1
gc-b-file: keys.json sha256=4dc375c20fd191224430df591243a37643e758909a8900976b9933824a1b1a82
gc-b-file: keys.json.err sha256=62835707570a9ebbe15a35d1358ce0bb347435832a004af19e2dc510fecc617a
gc-b-file: keys.json.raw sha256=bd6682a603408ab8f5e7f9774c5c77149f7a7815707d2fa470c3f7441bdafec6
gc-b-file: ki.json sha256=88e95d0031d75c96ec27f57f245f4af7b968d317cc97c75cfe192ac3b6ce86ce
gc-b-file: ki.json.err sha256=62835707570a9ebbe15a35d1358ce0bb347435832a004af19e2dc510fecc617a
gc-b-file: ki.json.raw sha256=267940d4c6ac6b2af93b9fddabd6f546619d427bd1b7796a2b8c9b28e29c7ee2
gc-b-file: marker1.json sha256=e36dfec1734eccfc4b69e29b2399d22086ea9f8af404fdefa1e6b045f4c0d6d9
gc-b-file: marker1.json.err sha256=62835707570a9ebbe15a35d1358ce0bb347435832a004af19e2dc510fecc617a
gc-b-file: marker1.json.raw sha256=229eb89c942e3d4b3c80d9de247c5031a66341ac203c709009801418d6520f73
gc-b-file: marker1.out sha256=1664c1c19f9815abcb2b4519810e680a2ba0cf20f174005096acfcebd58984ac
gc-b-file: marker2.json sha256=e36dfec1734eccfc4b69e29b2399d22086ea9f8af404fdefa1e6b045f4c0d6d9
gc-b-file: marker2.json.err sha256=62835707570a9ebbe15a35d1358ce0bb347435832a004af19e2dc510fecc617a
gc-b-file: marker2.json.raw sha256=e597df0c8954a30210d93a1bb6ec809b7e42e7e46acc4cdb3e236c6e74fde39f
gc-b-file: marker2.out sha256=1664c1c19f9815abcb2b4519810e680a2ba0cf20f174005096acfcebd58984ac
gc-b-file: meta.json sha256=0ea832b62300533a2dbdee75795039413861b3ae9ae80ffd759dbbcbf11432fb
gc-b-file: sa.json sha256=f2f0e7ee2bb52fbf7d7ec771be190de81a35fe9a0df0750aa4f04fc1192679e7
gc-b-file: sa.json.err sha256=62835707570a9ebbe15a35d1358ce0bb347435832a004af19e2dc510fecc617a
gc-b-file: sa.json.raw sha256=4d7d432972ad4fb25c2b722c2727b5f3540a28349e8cbb159daa4ce6333ded96
gc-b-file: strats.json sha256=effd9614577e259f4fb17aca3ebdf797408105a898e14ffea8ee3d8e5f84ae42
gc-b-file: strats.json.err sha256=62835707570a9ebbe15a35d1358ce0bb347435832a004af19e2dc510fecc617a
gc-b-file: strats.json.raw sha256=4616c707892911e895be4c871387d9b29fb91ede98fbae510a11296794404361
gc-b-file: taken.txt sha256=c7c3e8631f280c3ada1af6d33f0fbcffcd6b140e8ae68a05d709d32538b894ed
gc-b-file: tracer.json sha256=0486e621e01c7b1a2340afea9d7547fe9d4e58f474fe419855362071a7330fe9
gc-b-file: tracer.json.err sha256=62835707570a9ebbe15a35d1358ce0bb347435832a004af19e2dc510fecc617a
gc-b-file: tracer.json.raw sha256=0f33387f29a483b791b16aaac258c7395aa788214f47f3ebef620a36fed72751

## Notes

- Ordinals: C and k1..k8 are the 188-11 map; keys the 188-11 map did not hold (k9..k38) were appended in ascending id order. Strategies s1..s16 and books b1..b7 are in ascending id order.
- The nightly fan-out on PROD runs at 00:40 UTC (`gc-b-cron`), so the first derive after a deploy is the next 00:40 run.
- No job was pending, running or waiting to retry when the capture was taken.
- The defect stands as 188-VERIFICATION measured it: 24 stored rows on stated days, 8 each on keys C, k1 and k2, and three books read `key_inputs_mismatch`. No strategy scope holds a stored row on a stated day, so plan 15 needs no strategy re-derive.
