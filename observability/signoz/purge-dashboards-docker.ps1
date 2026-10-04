# Remove todos os dashboards do SigNoz local (SQLite).
# Use quando a API v2 quebra por dashboard corrompido e DELETE via API não limpa o banco.
#
# Uso (PowerShell, na raiz do repo):
#   .\observability\signoz\purge-dashboards-docker.ps1

$ErrorActionPreference = 'Stop'

Write-Host 'Parando container signoz...'
docker stop signoz | Out-Null

Write-Host 'Limpando tabela dashboard no SQLite...'
docker run --rm -u root -v signoz-sqlite:/data alpine sh -c "apk add --no-cache sqlite >/dev/null && sqlite3 /data/signoz.db 'DELETE FROM dashboard; DELETE FROM user_dashboard_preference; VACUUM;'"

Write-Host 'Subindo container signoz...'
docker start signoz | Out-Null

Write-Host 'Pronto. Dashboards removidos. Rode: node observability/signoz/provision.mjs'
