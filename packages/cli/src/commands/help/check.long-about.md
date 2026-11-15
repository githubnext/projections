```text
Verifies projections end to end, running each one the way viewers will, and reports every check as pass, fail, warn or skip:
  definition   the working tree's definition is valid
  extraction   the working tree extracts into a valid extraction
  comparison   HEAD compares with the working tree (the working tree's definition applied to both)
  comparator tests  custom comparators pass the cases in the *.comparator.test.yaml beside them
                    (--update writes their snapshots)
  renderer     a custom renderer's bundle is built and newer than its sources
  renderer checks  in a headless browser, the renderer passes the checks every renderer is held to
                   (neutral endpoints, still step holds, status in words, selection, phone width, ...)
```

Exits nonzero when any check fails. Use it after every change to a projection:
it is what an agent should run before saying a projection works.
