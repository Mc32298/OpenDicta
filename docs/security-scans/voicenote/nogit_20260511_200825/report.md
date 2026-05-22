# VoiceNote Security Scan Report

Scope: repository-wide scan of the checked-out filesystem at `C:\Users\MathiasNielsen-SPINO\Downloads\Projects\VoiceNote_V5\voicenote`. This directory is not a Git repository, so no commit diff was available. Generated dependency/build trees were excluded from manual source review except through manifests and audit commands.

## Finding: Broad Tauri permissions make any renderer compromise more damaging

- Priority: P2
- Severity: medium
- Confidence: medium
- CWE: CWE-250 Execution with Unnecessary Privileges, CWE-693 Protection Mechanism Failure
- Affected lines: `src-tauri/capabilities/default.json:15-21`, `src-tauri/tauri.conf.json:33`

### Summary
Both app windows receive clipboard read/write, global shortcut, autostart, and shell spawn/kill permissions, while the Tauri CSP is disabled. The current frontend does not need shell process APIs, and no current XSS sink was found, but if JavaScript executes in a renderer through a future dependency issue or injection bug it inherits unnecessary desktop-level capability.

### Validation
Method: static capability and renderer review. I found `shell:allow-spawn`, `shell:allow-kill`, and `clipboard-manager:allow-read-text` in the default capability, and `csp: null` in the Tauri config. I did not find `dangerouslySetInnerHTML` or current remote content loading, so this is a privilege-amplifier rather than a standalone RCE.

### Reachability Analysis
The reachable boundary is renderer JavaScript to Tauri host commands. The app is local-only, so a remote attacker first needs a renderer execution foothold. Once that foothold exists, these permissions unnecessarily expand the impact from UI manipulation to process/clipboard abuse.

### Attack Path
1. Attacker gets JavaScript execution in a VoiceNote webview through a future XSS/dependency/content-injection bug.
2. The compromised renderer runs with the default capability assigned to `voicebar` and `settings`.
3. The renderer can attempt shell process operations and clipboard reads that are not needed by the reviewed frontend.

### Severity Analysis
Medium because the issue needs a renderer compromise first, but the exposed desktop capabilities are materially security-relevant. It should be fixed before adding any remote content, markdown/HTML rendering, plugin surfaces, or update/news panes.

### Remediation
Remove `shell:allow-spawn` and `shell:allow-kill` unless the JS shell plugin is genuinely used. Remove `clipboard-manager:allow-read-text` if the app only writes/pastes text through Rust. Add a restrictive CSP instead of `null`, and split capabilities so the small `voicebar` window has fewer permissions than `settings`.

## Finding: Downloaded model artifacts are trusted without hash or signature verification

- Priority: P2
- Severity: medium
- Confidence: medium-high
- CWE: CWE-494 Download of Code Without Integrity Check, CWE-353 Missing Support for Integrity Check
- Affected lines: `src-tauri/src/lib.rs:538`, `src-tauri/src/lib.rs:605`, `src-tauri/src/lib.rs:637`, `worker/src/model.rs:38-48`

### Summary
`download_model` fetches ONNX and token files from HuggingFace, writes them to the app data model directory, and the worker later loads those files into sherpa-onnx/ONNX Runtime. The code checks URL success and approximate file size, but it never verifies a pinned hash, signed manifest, or trusted release metadata.

### Validation
Method: static source trace. The download base is hardcoded to HuggingFace and HTTPS is used, which helps against casual MITM. However, the bytes written at file creation/rename are accepted as the model of record, and `worker/src/model.rs` loads those exact local paths. Size checks are not integrity checks.

### Reachability Analysis
The normal onboarding/settings flow lets the user trigger model download. A compromised upstream model repository, CDN, token-protected artifact, or trusted TLS endpoint can replace artifacts consumed by native parsing code. The app has no server-side multi-user exposure, but this is still a real supply-chain boundary.

### Attack Path
1. Attacker controls or compromises the model artifact source served from the configured HuggingFace path.
2. User installs or refreshes model files through VoiceNote.
3. VoiceNote saves the supplied ONNX/token files and the worker loads them for transcription.
4. Impact ranges from malicious transcription output pasted into external apps to native parser/runtime exposure if the ML stack contains an exploitable model parsing bug.

### Severity Analysis
Medium. The exploit requires upstream artifact compromise or equivalent trusted-channel compromise, but the artifacts are privileged inputs to native code and directly influence pasted output.

### Remediation
Pin expected SHA-256 hashes for each model file or download a signed manifest verified against an embedded public key. Verify the final file before rename/use, reject mismatches, and display the expected model version/source. Consider storing the verified version metadata with the model directory.

## Finding: Optional HuggingFace token is stored and exposed as plaintext settings

- Priority: P3
- Severity: low
- Confidence: high
- CWE: CWE-312 Cleartext Storage of Sensitive Information, CWE-522 Insufficiently Protected Credentials
- Affected lines: `src-tauri/src/lib.rs:380-394`, `src-tauri/src/lib.rs:884-898`, `src-tauri/src/lib.rs:905-921`

### Summary
The optional HuggingFace token is stored in normal app settings JSON and returned by `get_hf_token` to renderer code. If the local settings file or renderer is compromised, the token is disclosed.

### Validation
Method: static source trace. `set_hf_token` stores the token in memory, `save_app_settings` serializes it into `settings.json`, and `load_app_settings` reads it back. There is no OS keychain or encrypted secret store.

### Reachability Analysis
This is same-user/local in normal deployment and only applies when a user configured a token. It becomes more meaningful when paired with renderer compromise or malware already able to read app config.

### Severity Analysis
Low because the token is optional and not enough by itself to compromise the local machine, but it is still avoidable secret exposure.

### Remediation
Store the token in the OS credential store/keychain where available and keep only a presence flag in settings. Avoid returning the full token to the renderer; expose masked display state and write-only update/delete commands.

## Coverage Closure
- Suppressed: URL query parameter routing in `src/App.tsx`, `src/windows/Settings.tsx`, and `src/windows/EmptyStates.tsx`; values are normalized and rendered through React without dangerous HTML sinks.
- Suppressed: worker arbitrary path read; worker stdin is controlled by the Rust host, and no renderer command accepts arbitrary WAV paths.
- Suppressed: NPM production advisories; `npm audit --omit=dev --json` reported zero vulnerabilities.
- Deferred: Rust advisory audit; `cargo audit` is not installed in this environment.

## Verification
- Reviewed all in-scope runtime source files listed in `artifacts/exhaustive-file-checklist.md`.
- Ran `npm audit --omit=dev --json`: zero production vulnerabilities.
- Attempted `cargo audit --version`: command is not installed.
