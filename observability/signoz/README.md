# SigNoz — GoRoute (alertas, views e dashboard)

Configuração versionada para completar o onboarding do SigNoz (passos 5–7):

- **Alertas** — SLOs do `projeto/metricas_e_observabilidade.md`
- **Saved views** — traces e logs filtrados para os serviços GoRoute
- **Dashboard** — RED (rate, errors, duration) por serviço

## Pré-requisitos

1. SigNoz em execução:

```bash
cd signoz/deploy/docker
docker compose up -d
```

2. Serviços GoRoute enviando traces (`goroute-api`, `goroute-service-auth`, `goroute-frontend`, `goroute-platform-admin`).

3. API Key do SigNoz:
   - Abra http://localhost:8080
   - **Settings → API Keys → New Key**
   - Copie a chave

## Provisionar automaticamente

PowerShell:

```powershell
$env:SIGNOZ_API_KEY = "sua-chave-aqui"
node observability/signoz/provision.mjs
```

Bash:

```bash
export SIGNOZ_API_KEY="sua-chave-aqui"
node observability/signoz/provision.mjs
```

Variáveis opcionais:

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `SIGNOZ_URL` | `http://localhost:8080` | URL da UI/API |
| `SIGNOZ_CHANNEL` | `goroute-local` | Canal de notificação dos alertas |
| `SIGNOZ_API_KEY` | — | **Obrigatória** |

O script é idempotente: não duplica alertas, views ou dashboard se já existirem.

## O que é criado

### Alertas (`alerts/`)

| Arquivo | Condição |
|---------|----------|
| `goroute-api-error-rate.json` | Taxa de erro > 0,5% (5 min) |
| `goroute-api-p99-latency.json` | p99 > 500 ms (10 min) |
| `goroute-auth-error-rate.json` | Taxa de erro auth > 0,5% |

### Saved views (`saved-views/`)

| View | Uso |
|------|-----|
| GoRoute — Traces com erro | Lista spans com `hasError` em todos os serviços |
| GoRoute — Logs de erro (API) | Logs ERROR/FATAL do `goroute-api` (Pino) |
| GoRoute — Traces BFF → Auth | Traces da cadeia API + auth |

### Dashboard (`dashboards/goroute-overview.json`)

- RPS por serviço (`signoz_calls_total`)
- Taxa de erro da API (%)
- Latência p99 dos backends
- RPS do frontend

## Importação manual (alternativa)

Se preferir pela UI:

1. **Alertas** — Alerts → New Alert → importar JSON de `alerts/`
2. **Saved views** — Traces/Logs Explorer → filtrar → **Save View**
3. **Dashboard** — Dashboards → Import JSON → `dashboards/goroute-overview.json`

## Canal de notificação

O script cria `goroute-local` com webhook para `https://httpbin.org/post` (apenas dev).

Para produção, crie um canal real (Slack, e-mail, PagerDuty) em **Settings → Alert Channels** e defina:

```powershell
$env:SIGNOZ_CHANNEL = "seu-canal"
```

Depois reexecute o script ou edite os alertas na UI.

## Checklist SigNoz (passos 5–8)

Após o provisionamento e com traces ativos:

| Passo | Como completar |
|-------|----------------|
| Setup Alerts | ≥ 1 regra em Alerts (script cria 3) |
| Setup Saved Views | ≥ 1 saved view em Traces ou Logs |
| Setup Dashboards | ≥ 1 dashboard na lista |

Atualize a Home (F5) para o wizard avançar.

## Ajustes finos

- Edite thresholds em `alerts/*.json` conforme seus SLOs
- Adicione painéis ao dashboard e reimporte
- Correlacione logs: filtre por `trace_id` nos logs da API (Pino + OTel)
