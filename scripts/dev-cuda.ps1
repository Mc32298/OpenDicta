# Build voicenote-worker against CUDA-enabled sherpa-onnx DLLs,
# copy required DLLs next to the worker binary, then launch Tauri dev.

$sherpaRoot = "C:\sherpa-onnx-cuda\sherpa-onnx-v1.13.1-cuda-12.x-cudnn-9.x-win-x64-cuda"
$sherpaLib  = "$sherpaRoot\lib"
$shepraBin  = "$sherpaRoot\bin"
$cudnnBin   = "C:\Program Files\NVIDIA\CUDNN\v9.22\bin\12.9\x64"
$cudaBin    = "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.6\bin"
$workerOut  = "target\debug"

$env:SHERPA_ONNX_LIB_DIR = $sherpaLib

Write-Host "Building worker with CUDA support..."
cargo build -p voicenote-worker --no-default-features --features cuda
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# Copy sherpa-onnx + ONNX Runtime CUDA DLLs next to the worker exe
Write-Host "Copying CUDA DLLs to $workerOut..."
$dlls = @(
    "$sherpaLib\sherpa-onnx-c-api.dll",
    "$sherpaLib\onnxruntime.dll",
    "$sherpaLib\onnxruntime_providers_cuda.dll",
    "$sherpaLib\onnxruntime_providers_shared.dll",
    "$cudnnBin\cudnn64_9.dll",
    "$cudnnBin\cudnn_ops64_9.dll",
    "$cudnnBin\cudnn_cnn64_9.dll",
    "$cudnnBin\cudnn_adv64_9.dll",
    "$cudnnBin\cudnn_engines_precompiled64_9.dll",
    "$cudnnBin\cudnn_engines_runtime_compiled64_9.dll",
    "$cudnnBin\cudnn_graph64_9.dll",
    "$cudnnBin\cudnn_heuristic64_9.dll"
)
foreach ($dll in $dlls) {
    if (Test-Path $dll) {
        Copy-Item $dll $workerOut -Force
    } else {
        Write-Warning "DLL not found: $dll"
    }
}

# Add CUDA bin to PATH for nvcc runtime libs (cublas, etc.)
$env:PATH = "$cudaBin;$env:PATH"

Write-Host "Launching Tauri dev (CUDA mode)..."
npm run tauri -- dev
