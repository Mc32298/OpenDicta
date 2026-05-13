# Attack Path Analysis Report

## CAND-001: Broad Tauri desktop permissions plus disabled CSP
In scope: yes, this is a primary product runtime boundary. Vector: renderer JavaScript execution after a future renderer compromise. Counterevidence: current source does not show a direct XSS sink or remote content load. That lowers likelihood and severity but does not defeat the configuration issue because permissions are broader than needed.

Attack path facts: local desktop app; auth scope same local user; exposure requires renderer compromise; impact is process control/clipboard read under the user's desktop account if shell permissions are callable from the compromised webview; severity medium/P2.

## CAND-002: Unverified remote model artifacts
In scope: yes, model download and native model parsing are core product workflow. Vector: compromised model host, CDN, account, or trusted TLS endpoint. Counterevidence: HTTPS is used and URL base is hardcoded, reducing opportunistic network tampering. It does not defeat repository/CDN compromise or the absence of pinned artifact verification.

Attack path facts: user clicks download model; app stores remote bytes; worker loads ONNX/token artifacts into native sherpa-onnx/ONNX Runtime; impact includes malicious model behavior and possible parser/runtime exploit if the native stack has an artifact parsing vulnerability; severity medium/P2.

## CAND-003: Plaintext HuggingFace token storage and getter
In scope: yes, local app settings and optional auth token are product settings. Vector: local file access or renderer compromise. Counterevidence: token is optional, not a server-side crown jewel, and compromise is same-user/local. Severity low/P3.
