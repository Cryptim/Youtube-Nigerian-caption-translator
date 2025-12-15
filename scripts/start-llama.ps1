# start-llama.ps1 — quick helper to run a local llama-server (Windows PowerShell)
# Usage: Right-click -> Run with PowerShell, or open PowerShell in this folder and run: .\start-llama.ps1

param(
    [string]$ModelPath = "$env:USERPROFILE\Desktop\llama\N-ATLaS-GGUF-Q8_0.gguf",
    [int]$Port = 8080
)

if (-not (Test-Path $ModelPath)) {
    Write-Host "Model file not found at: $ModelPath" -ForegroundColor Yellow
    Write-Host "Edit the script or pass -ModelPath with the correct GGUF file path." -ForegroundColor Yellow
    exit 1
}

Write-Host "Starting llama-server with model: $ModelPath on port $Port" -ForegroundColor Green
# Example command — adjust to your llama-server executable path if needed
Start-Process -NoNewWindow -FilePath "llama-server" -ArgumentList "-m \"$ModelPath\" --port $Port" -WorkingDirectory (Split-Path $ModelPath)
Write-Host "llama-server started (check process list). Use curl to verify: http://127.0.0.1:$Port/v1/chat/completions" -ForegroundColor Green
