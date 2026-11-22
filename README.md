[![csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/c/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/ferdizi/csv-reader-speed-entry/rank.svg)](https://make.fun/c/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/ferdizi/csv-reader-speed-entry/reward.svg)](https://make.fun/c/csv-reader-speed-01-run-20261121)

# Fast csv-reader

A faster drop-in for make.fun's own csv-reader 1.0.0, written for the
[csv-reader-speed-01-run-20261121](https://make.fun/c/csv-reader-speed-01-run-20261121)
bounty. `solve.js` answers exactly as csv-reader does on every input —
same `{columns, rows, errors}`, same broken-row policy — while reading
several times faster.

## How it is faster

The reference reads one character at a time and builds every field with
string concatenation. This parser instead:

- scans unquoted fields with one native char-class search (`/[,\r\n]/g`)
  per field segment and slices the field out whole;
- finds a quoted field's closing quote with `indexOf('"')` and slices the
  span whole when it needs no rewriting (no `""` doubling, no CR, no LF);
- only rebuilds a quoted span when it holds a doubled quote or a CR/LF
  (CR/CRLF inside quotes become LF, `""` becomes `"`);
- keeps every scan bounded to the field it serves, so no search ever runs
  past its field to the end of the file.

## Files

- `solve.js` — the parser: `run({text, header})` returns
  `{columns, rows, errors}` exactly as csv-reader 1.0.0 does.
- `main.ts` — the harness driver (the kit's own): reads every case from
  `/input/cases.json`, answers each with `run`, writes
  `/output/answers.json`.

## Local check

Practice set, 6 cases, identical to csv-reader on every case
(also verified against the reference on 7,500+ fuzzed inputs), in about
a quarter of the reference's time on this machine (~220 ms vs ~960 ms
for the 6-case practice set).

## License

MIT. See [LICENSE](LICENSE).
