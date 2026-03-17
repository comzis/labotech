# TSDuck Phase 0a Spike Findings

## Date and Host

- **Spike date:** 2026-03-17
- **Host:** `gva-boro-probe`
- **Service user:** `boro`
- **Access path:** operator-run SSH session on production host; command transcript captured and relayed into this repository (`private/tsduck-phase0a.txt`).

## TSDuck Version

Command:

```bash
tsp --version
```

Exact output:

```text
tsp: TSDuck - The MPEG Transport Stream Toolkit - version 3.44-4581
```

`tsanalyze --version` was not run during this spike; no version delta was observed or recorded.

## Plugin Inventory

Initial roadmap command attempted:

```bash
tsp --list-processors
```

Exact result on this host:

```text
tsp: unknown option --list-processors
```

Version-correct inventory command on this host:

```bash
tsp --list-plugins | grep -Ei 'tables|monitor|etr290|pcr|section'
```

Exact filtered output:

```text
  bitrate_monitor  Monitor bitrate for TS or a given set of PID's
  eit ............ Analyze EIT sections
  inject ......... Inject tables and sections in a TS
  pcradjust ...... Adjust PCR's according to a constant bitrate
  pcrbitrate ..... Permanently recompute bitrate based on PCR analysis
  pcrcopy ........ Copy and synchronize PCR's from one PID to another
  pcrduplicate ... Duplicate PCR values from a PID into a new PCR-only PID
  pcredit ........ Edit PCR, PTS and DTS values in various ways
  pcrextract ..... Extracts PCR, OPCR, PTS, DTS from TS packet for analysis
  pcrverify ...... Verify PCR's from TS packets
  regulate ....... Regulate the TS packets flow based on PCR or bitrate
  sections ....... Remove, keep or merge sections from various PID's
  splicemonitor .. Monitor SCTE 35 splice information
  stuffanalyze ... Analyze the level of stuffing in tables
  tables ......... Collect PSI/SI Tables
```

Explicit presence/absence:

- **Present:** `tables`, `sections`, `pcr*` family (`pcradjust`, `pcrbitrate`, `pcrcopy`, `pcrduplicate`, `pcredit`, `pcrextract`, `pcrverify`), `bitrate_monitor`, `splicemonitor`, `inject`, `eit`, `regulate`, `stuffanalyze`.
- **Absent:** `monitor` processor plugin, `etr290` processor plugin.

## Test Commands Run

### 1) Version and capability discovery

Command:

```bash
tsp --version
```

Output:

```text
tsp: TSDuck - The MPEG Transport Stream Toolkit - version 3.44-4581
```

Command:

```bash
tsp --help | grep -Ei 'list|plugin'
```

Relevant finding:

```text
--list-plugins[=value]
    List all available plugins.
```

### 2) Plugin inventory for relevant scope

Command:

```bash
tsp --list-plugins | grep -Ei 'tables|monitor|etr290|pcr|section'
```

Output: see Plugin Inventory section above.

### 3) Candidate plugin help checks

Command:

```bash
tsp -P tables --help | head -120
```

Result:

- Succeeds, confirms `tables` plugin is installed and functional.

Command:

```bash
tsp -P monitor --help | head -120
```

Exact output:

```text
* Error: monitor.so: cannot open shared object file: No such file or directory
* Error: processor plugin monitor not found
```

Command:

```bash
tsp -P etr290 --help | head -120
```

Exact output:

```text
* Error: etr290.so: cannot open shared object file: No such file or directory
* Error: processor plugin etr290 not found
```

### 4) Trial JSON command from roadmap prompt

Command attempted:

```bash
tsp -I srt --srt-... -O drop --processor tables --json 2>&1 | head -100
```

Exact output:

```text
* Error: srt: unknown option --srt-...
```

Notes:

- `--srt-...` was a placeholder token in the planning prompt, not a valid flag.
- The command still confirms parser behavior for invalid SRT options on this host.

## Go / No-Go Decision

- **Persistent `tsp` real-time ETR/PCR path:** **BLOCKED** (required `monitor` / `etr290` plugins are missing on host package build).
- **Phase 1 reduced-interval `tsanalyze`:** **VALID fallback** and remains executable path.
- **Phase 3 persistent `tsp` design:** **DEFERRED** pending host TSDuck package/version upgrade that includes required plugins.
- **Phase 1 and Phase 2:** **UNBLOCKED** under revised roadmap scope.

## Upgrade Path

This finding changes only if host package provenance/version changes to a TSDuck build that ships `monitor` and/or `etr290` processor plugins.

Verification commands:

```bash
tsp --version
apt-cache show tsduck
tsp --list-plugins | grep -Ei 'monitor|etr290|tables|sections|pcr'
```

No prescriptive upgrade action is included here; this section documents only the condition that would change the current no-go result.

## What IS Available

Confirmed available and potentially useful for revised future scope:

- PSI/SI collection: `tables`, `sections`
- PCR-focused tooling: `pcradjust`, `pcrbitrate`, `pcrcopy`, `pcrduplicate`, `pcredit`, `pcrextract`, `pcrverify`
- Related processors: `bitrate_monitor`, `regulate`, `inject`, `stuffanalyze`, `eit`, `splicemonitor`
- `tsp` framework supports plugin chains and includes `--list-plugins` in this build.

These capabilities support a revised Phase 3 direction based on enhanced sampled analysis rather than persistent monitor/etr290 alarm processors.
