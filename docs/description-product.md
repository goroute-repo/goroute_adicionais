---
name: GoRoute — descrição do produto
description: Visão de produto, papel do mentor de carreira e dados que ele usa no runtime.
---

# GoRoute — descrição do produto

**GoRoute** é uma plataforma **skills-first** de carreira: conecta o que a pessoa já sabe, o que o mercado pede e o que falta para a próxima vaga ou promoção. O núcleo não é “mais um job board” nem um LMS completo — é um **mapa vivo de competências** (grafo), com progresso mensurável, plano semanal executável e match de vagas **explicável** por skills.

Público:

| Persona | Resultado esperado |
|---------|-------------------|
| **Profissional** | Ver origem → progresso → alvo; executar a semana; candidatar com critério |
| **Empresa** | Publicar vaga por skills; filtrar candidatos por % de match; enviar ofertas |

---

## O que o produto entrega (loop principal)

1. **Onboarding e perfil** — skills, áreas e objetivo de carreira.
2. **Roadmap personalizado** — grafo com estados dos nós, próximo foco (`recommendedNext`), demand scores e Time Machine / progresso no caminho até o alvo.
3. **Plano semanal** — tarefas derivadas do foco do roadmap (aprender → projeto → praticar). **Não depende de LLM.**
4. **Marketplace de vagas** — ordenação e candidatura por % de match real nas skills exigidas.
5. **Espelho empresa** — vagas estruturadas por competências, descoberta de candidatos, ofertas/convites.
6. **Mentor (opcional)** — camada consultiva em linguagem natural sobre gaps e próximos passos, **ancorada no roadmap**, sem substituir o caminho crítico calculado pelo grafo.

Princípio de produto: o caminho crítico (estados, elegibilidade, % de match, weekly) é **determinístico**. A IA, quando ligada, **explica e orienta** — não redefine o grafo.

---

## Como o mentor se encaixa no GoRoute

O mentor é um **conselheiro de trilha**, não o motor do roadmap.

| Capacidade | Dono | Papel do mentor |
|------------|------|-----------------|
| Caminho, estados, % match, elegibilidade | Roadmap / Jobs (BFF + Neo4j) | Nenhum — não altera o grafo |
| Tarefas da semana | Weekly plan a partir de `recommendedNext` | Nenhum — sem payload de weekly |
| Orientação narrativa, gaps, próximo desafio | Mentor | Soft advisory: por quê / como / soft skills |
| Modo de inteligência | Settings + Billing | `off` (heurística) · `managed` (SLM GoRoute) · `byok` (chave do usuário) |

### Onde aparece

| Superfície | Entrada |
|------------|---------|
| **Web — Roadmap** | Painel de chat no `/dashboard/roadmap` |
| **Web — Configurações** | Aba Mentor/IA (`off` / `managed` / `byok`, consentimento LGPD, quota) |
| **Web — Vagas** | Narrativa de match (“explique o match”) via mentor sob o capô |
| **Mobile — Mentor** | Tela dedicada `/app/mentor` |
| **Mobile — contexto** | Prefills a partir da home, nó do roadmap ou detalhe da vaga (só texto da pergunta) |

### Jornadas típicas

1. **No roadmap** — pergunta livre (“como avanço em Docker?”); resposta estruturada com gaps e próximo desafio clicáveis no grafo.
2. **Na vaga** — web: narrativa curta do % de match; mobile: pergunta pré-preenchida sobre fechar o gap de skills.
3. **Na home (mobile)** — foco no próximo nó recomendado.
4. **Nas settings** — escolher modo; em `byok`, provider + API key cifrada no BFF (nunca enviada ao agente Python).

### O que o mentor devolve

Resposta **estruturada** (não chat livre sem schema), tipicamente:

- `intro`, `diagnosis[]`, `steps[{title,body}]`, `immediateAction`, `roadmapLink`
- `summary`
- `gaps[]` — `{ slug, label, reason }` (slugs validados contra o roadmap)
- `nextChallenge` — `{ slug, label, project }` ou `null`
- `source` — `heuristic` | `managed` | `byok` | `scope_gate`
- `provider` — SLM GoRoute ou provider BYOK; `null` na heurística
- `scope` — `in_track` | `soft_skills` | `out_of_scope`
- `warning` opcional (ex.: provider indisponível com fallback)

---

## Dados que o mentor consegue obter

O cliente envia **apenas** a pergunta (opcional, até ~1000 caracteres). O BFF monta o contexto a partir do roadmap do usuário autenticado — o app **não** envia o grafo completo no body.

### Contexto disponível para o trabalho do mentor

| Dado | Origem | Uso |
|------|--------|-----|
| Pergunta sanitizada | Cliente (ou pergunta sintética no match narrativo de vagas) | Intenção e tópicos |
| Snapshot compacto do roadmap | `RoadmapService.getRoadmap(userId)` | Âncora da resposta |
| → `goalSlug` | Objetivo de carreira | Alvo da trilha |
| → `recommendedNext` | Próximo nó recomendado (slug) | Foco sugerido |
| → `timeMachine` | Progresso temporal do roadmap | % / leitura de avanço |
| → até **24 nós** | `slug`, `label`, `state`, `demand`, `hours` | Gaps e próximos passos |
| Labels de papel / categoria | Roadmap enriquecido | `currentRoleLabel`, `targetRoleLabel`, `categoryLabel` |
| Progresso no caminho | `pathProgress.percentNodesDone` | `pathProgressPercent` |
| Label do próximo foco | `recommendedNext.label` | Linguagem amigável |
| Tópicos extraídos | NLP (`goroute-nlp`) ou keywords locais | Matching de nós / catálogo |
| Nós mencionados | Match pergunta/tópicos × labels/slugs | Escopo da resposta |
| Skills relacionadas do catálogo | Até 5: `slug`, `label`, `hint` (incl. dica de projeto) | Conteúdo de trilha |
| Intent da pergunta | Detecção local (ex.: progressão de carreira) | Ajuste de tom / escopo |
| Hint de playbook | Só `topicPlaybookId` + tópico detectado (não o texto completo do playbook no LLM) | Roteiro temático |

No modo **managed**, o BFF encaminha ao **`goroute-mentor-agent`** (porta 5010): pergunta + snapshot compacto + contexto enriquecido + prompts de sistema/usuário. O SLM roda via Ollama (local) ou API hosted configurada. No modo **byok**, o mesmo contexto vai a OpenAI / Anthropic / Gemini / DeepSeek / Grok com a chave do usuário, só no BFF. No modo **off**, a resposta é **heurística** local (demand score + estados), sem LLM.

### Dados que o mentor **não** recebe

| Excluído | Motivo / evidência |
|----------|-------------------|
| E-mail, nome, telefone, documentos | Fora do snapshot e dos prompts |
| Bio completa, LinkedIn, experiências detalhadas | Não entram no builder de contexto |
| Inventário completo além dos nós compactados | Só até 24 nós + hints do catálogo |
| Detalhe de nó (lista completa de recursos, notas, hoursLogged) | Snapshot traz estado/demanda/horas estimadas |
| Topologia completa do grafo (todas as arestas) | Não vai no compact snapshot |
| Plano semanal (tarefas da semana) | Sem acoplamento com o módulo weekly |
| Corpo da vaga, salário, dados internos da empresa | Em vagas: no máximo título + gaps na pergunta / narrativa |
| Histórico de conversa multi-turno | Cada `analyze` é stateless; chat local é só UX (web memória de componente; mobile SharedPreferences) |
| Chaves API (BYOK ou plataforma) no agente Python | Credenciais ficam no BFF; agente ignora apiKey |
| Dados de outros usuários | Sempre o roadmap do `userId` da sessão |
| IDs Stripe / plano na prompt | Quota checada no BFF, não enviada ao modelo |

### Controles de produto e segurança

- Autenticação e autorização no BFF (sessão + onboarding + perfil profissional).
- Rate limit do mentor (ex.: 20 req/hora/usuário via Redis).
- Quota mensal no modo `managed` (planos / billing); BYOK não consome essa quota.
- Consentimento LGPD para uso de IA nas settings.
- Escopo: perguntas fora da trilha podem ser recusadas (`scope_gate`) com redirecionamento ao roadmap.
- Falha de LLM → fallback heurístico (aviso ao usuário quando aplicável).
- Gaps / `nextChallenge` com slugs inventados pelo modelo são descartados na validação.

---

## Arquitetura resumida (mentor)

```text
Cliente (web Angular / mobile Flutter)
  → POST /api/roadmap/mentor/analyze { question? }
     ou GET /api/jobs/:id/match-narrative (só narrativa de vaga)

BFF goroute-api
  → carrega roadmap do usuário
  → MentorContextBuilder + gate de escopo
  → off | byok | managed (+ entitlement/quota)

managed → goroute-mentor-agent (:5010) → SLM (Ollama / hosted)
byok    → providers no BFF com chave do usuário
off     → heurística no BFF
```

O agente Python é serviço **interno**: não autentica o usuário final; não deve receber secrets do cliente.

---

## O que o mentor **não** promete (escopo honesto)

Em relação a um “mentor humano de carreira” genérico, o produto **não** implementa hoje:

- Cronograma salarial / títulos em 1–3–5 anos como contrato de produto
- Simulação completa de entrevistas
- Networking ou indicação de pessoas
- Accountability periódico automático (revisão a cada 15/30 dias)
- Substituição do plano semanal ou do % de match por decisão de IA

O valor entregue é: **orientação estruturada, ancorada no roadmap pessoal e no catálogo**, com modos de IA opcionais e fallback seguro — para reduzir a dúvida “no que foco agora?” sem tornar a trilha dependente de modelo generativo.

---

## Pacotes do ecossistema (referência)

| Pacote | Papel |
|--------|--------|
| `goroute-frontend` | App web do profissional (roadmap, mentor chat, settings, vagas) |
| `goroute-mobile` | App Flutter (mentor dedicado + prefills) |
| `goroute-api` | BFF: roadmap, mentor, jobs, billing, settings |
| `goroute-service-auth` | Identidade, sessão, MFA |
| `goroute-mentor-agent` | SLM managed — analyze / analyze-scope |
| `goroute-nlp` | Extração de skills/tópicos (apoio ao contexto) |
| `goroute-platform-admin` | Operações de plataforma / conteúdo |

Documentação técnica detalhada: `PROJETO.md` e `.specs/` (em especial SPEC-03 roadmap/mentor, SPEC-10 settings/BYOK, SPEC-11 billing/quota, SPEC-19 segurança).
)
