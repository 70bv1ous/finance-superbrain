# Dev utility — load from .env, never commit secrets
Set-Location "C:\Users\rayan\OneDrive\Documents\Playground\trade-journal-site\apps\api"
Get-Content .env | ForEach-Object { if ($_ -match "^\s*([^#][^=]+)=(.+)$") { [System.Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), "Process") } }
Write-Host "Schema check — use Supabase dashboard for full schema info"
