Set-Location "C:\Users\rayan\OneDrive\Documents\Playground\trade-journal-site\apps\api"

# Load credentials from .env (never commit .env to git)
$envFile = Join-Path (Get-Location) ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match "^\s*([^#][^=]+)=(.+)$") {
            [System.Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), "Process")
        }
    }
    Write-Host "Loaded .env"
} else {
    Write-Host "WARNING: .env not found — set DATABASE_URL and ANTHROPIC_API_KEY manually"
}

Write-Host "Working dir: $(Get-Location)"
Write-Host ""

Write-Host "=== Step 1: Setting up prediction_log table ==="
npx tsx src/scripts/setupPredictionLog.ts

Write-Host ""
Write-Host "=== Step 2: Expanding case library (80+ new cases) ==="
npx tsx src/scripts/expandCaseLibrary.ts
