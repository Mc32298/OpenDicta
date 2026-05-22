# STT Optimization Design: Low Idle RAM + Fast Wake

Date: 2026-05-08
Status: Approved (Design)

## Goal
Deliver both:
- Low RAM usage while idle
- Fast wake-to-transcribe (~300ms–1s typical)

## Scope
Applies to local STT runtime lifecycle and settings behavior for desktop app.

## Chosen Approach
Use `faster-whisper` with a warm sidecar process and model lifecycle control:
- Keep sidecar process alive
- Load/unload model object based on activity profile
- Keep audio capture and UI flow unchanged

Reasoning:
- Reduces idle RAM significantly vs always-hot model
- Avoids full process cold start
- Preserves fast wake from cached local model files

## Runtime Architecture
Pipeline remains:
- Shortcut release -> finalize recording -> WAV path -> sidecar -> transcript event -> paste

Lifecycle control adds:
- Warm process manager
- Model load/unload manager
- Idle timer + profile policy

## State Machine
States:
1. `Cold` (process alive, model unloaded)
2. `Loading` (model currently loading)
3. `Hot` (model loaded, immediate inference)
4. `Cooling` (idle timer active toward unload)

Transitions:
- Transcribe request in `Cold`: `Cold -> Loading -> Hot -> transcribe`
- Transcribe request in `Hot`: `Hot -> transcribe`
- After transcription: `Hot -> Cooling`
- Idle timeout reached: `Cooling -> Cold` (unload model object only)

Rules:
- Never unload while transcription is in-flight
- Do not drop transcript requests during `Loading`
- Keep process alive unless app exits or explicit hard reset

## Settings Design
Add/standardize:
- Engine backend: `nemo` | `faster-whisper`
- Model selector (backend-specific)
- Performance profile:
  - `Low RAM`: short unload timeout (5–10s)
  - `Balanced`: medium timeout (20–40s)
  - `Fast Wake`: long timeout (60s+)

Defaults:
- Backend: `faster-whisper`
- Profile: `Balanced`

Persistence:
- Save backend, model, profile in app settings
- Restore on startup

## Error Handling
- If model load fails, emit structured error and keep state `Cold`
- If transcription requested during `Loading`, queue/serialize request (single-flight)
- If sidecar backend dependency missing, show actionable install message

## Telemetry / Instrumentation
Structured events/logs:
- `engine_state_changed`
- `model_load_ms`
- `transcribe_ms`
- `idle_unload_triggered`
- `request_while_loading`

Optional UI diagnostics row in Settings:
- current state
- last load time
- last transcribe time

## Verification Plan
Functional:
1. Transcription works in `Cold`, `Loading`, `Hot`, `Cooling`
2. No transcript loss when request arrives during `Loading`
3. No unload while busy

Performance:
1. Idle RAM drops significantly in `Low RAM`
2. Wake latency from `Cold` (cached) typically 300ms–1s on target machine
3. Wake latency from `Hot` near-instant

Stability:
1. 50+ repeated cycles without crash
2. Profile switches at runtime behave correctly
3. Settings persist across restart

## Non-Goals (This Iteration)
- Multi-request batching pipeline redesign
- Full ONNX/TensorRT migration
- Cloud fallback routing

## Open Risks
- Wake latency depends on storage and model size/cache state
- Different GPUs/CPUs will vary; thresholds may need per-device tuning
- `faster-whisper` model choice impacts both RAM and latency strongly

## Rollout Plan
1. Implement state machine + profile setting
2. Enable instrumentation and diagnostics
3. Validate on representative hardware
4. Tune timeout defaults based on measured data
