# Finding Discovery Report

## Candidates

### CAND-001: Renderer compromise can become desktop process control through broad Tauri permissions
- Instance key: `privilege-boundary:src-tauri/capabilities/default.json:20`
- Ledger row: RW-001
- Affected locations:
  - root_control: `src-tauri/capabilities/default.json:15-21`
  - root_control: `src-tauri/tauri.conf.json:33`
- Attacker-controlled source: any JavaScript executing in either app window after a renderer compromise, future XSS, dependency issue, or unintended content injection.
- Broken control: both `voicebar` and `settings` windows receive clipboard read plus shell spawn/kill permissions, and CSP is disabled.
- Impact: a renderer bug would have a shorter path to local process execution/control and clipboard exfiltration than the app requires for its current UI.
- Closest control: Tauri capability file; permission set is broader than observed frontend usage.
- Taxonomy: CWE-250, CWE-693.
- Validation recommended: yes.

### CAND-002: Downloaded ONNX model files are trusted without integrity verification
- Instance key: `supply-chain:src-tauri/src/lib.rs:538`
- Ledger row: RW-002
- Affected locations:
  - entrypoint/wrapper: `src-tauri/src/lib.rs:538`
  - sink: `src-tauri/src/lib.rs:605`
  - sink: `src-tauri/src/lib.rs:637`
  - sink: `worker/src/model.rs:38-48`
- Attacker-controlled source: remote HuggingFace repository/CDN response or local manual model placement.
- Broken control: downloaded bytes are accepted based on URL/status and approximate size, then parsed by native ML runtime without pinned hashes/signatures.
- Impact: supply-chain compromise can replace model/token artifacts consumed by native parser and can alter transcription output pasted into other applications.
- Closest control: HTTPS and expected-size check; neither authenticates exact bytes.
- Taxonomy: CWE-494, CWE-353.
- Validation recommended: yes.

### CAND-003: Optional HuggingFace token is stored and exposed as plaintext app settings
- Instance key: `secret-handling:src-tauri/src/lib.rs:380`
- Ledger row: RW-003
- Affected locations:
  - entrypoint/wrapper: `src-tauri/src/lib.rs:380-394`
  - sink: `src-tauri/src/lib.rs:884-898`
  - sink: `src-tauri/src/lib.rs:905-921`
- Attacker-controlled source: local UI setting. Attacker path requires local file access or renderer compromise.
- Broken control: token is stored in normal settings JSON and returned to any renderer with invoke access.
- Impact: disclosure of a user-provided HuggingFace token if the local config or renderer is compromised.
- Closest control: none; this is intentionally persisted as ordinary config.
- Taxonomy: CWE-312, CWE-522.
- Validation recommended: yes.
