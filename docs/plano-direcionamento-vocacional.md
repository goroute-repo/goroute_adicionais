---
name: GoRoute — plano de direcionamento vocacional
description: Plano para a funcionalidade de sugestão de profissão com base em interesses e metas da pessoa (não em skills que ela já tem).
---

# Direcionamento vocacional — plano

**Problema que resolve:** hoje o GoRoute pressupõe que a pessoa já sabe qual profissão/cargo quer seguir (ela escolhe o `targetRoleSlug` e o roadmap calcula o caminho). Mas uma parte do público **não sabe qual profissão seguir** — tem gostos, aptidões e metas de vida, mas não sabe traduzir isso em um cargo do catálogo. Esta funcionalidade é um passo **anterior** ao roadmap: em vez de "você quer chegar em X, aqui está o caminho", ela responde "com base no que você gosta e busca, esses cargos podem fazer sentido para você — escolha um para virar o alvo do seu roadmap".

Mesmo princípio de produto que já rege o mentor (ver `description-product.md`): o **match é determinístico** (pontuação calculada, não "a IA decide"); a IA, quando ligada, só **explica** o resultado em linguagem natural — não substitui o cálculo.

---

## Modelo: dois eixos, não um

"Gostos e metas" são duas coisas diferentes e a pessoa pode ter gostos que não combinam com as metas atuais de vida (ex.: gosta de arte, mas agora precisa de estabilidade financeira). Juntar os dois em uma única pergunta ("o que você gosta?") perde essa tensão. O plano usa dois modelos padrão da psicologia vocacional — não inventados aqui — para poder cruzar os dois eixos de forma explicável:

| Eixo | O que mede | Modelo usado | Por quê |
|---|---|---|---|
| **Interesses** ("do que você gosta de fazer") | Afinidade com tipos de atividade | **RIASEC / Código de Holland** — 6 tipos: Realista, Investigativo, Artístico, Social, Empreendedor, Convencional | Padrão usado pelo O*NET Interest Profiler (gov. dos EUA) e pela maioria das ferramentas de orientação vocacional do mundo. Testado, documentado, de domínio público. |
| **Metas / motivações** ("o que você busca na carreira") | Prioridades de vida/trabalho | **O*NET Work Values** — 6 valores: Realização, Independência, Reconhecimento, Relacionamentos, Suporte, Condições de trabalho | Mesma fonte (O*NET), complementar ao RIASEC — cobre estabilidade, flexibilidade, impacto social, autonomia etc., que o RIASEC não cobre. |

Cada pessoa recebe dois vetores de 6 números (0–100): `riasecScores` e `workValueScores`. Cada **cargo** do catálogo (`career_role`) recebe os mesmos dois vetores, uma vez só, na curadoria (não por usuário).

**Match = similaridade entre o vetor da pessoa e o vetor do cargo** (cosseno ou distância euclidiana normalizada — decisão de implementação, não muda o plano). Determinístico, auditável, sem "caixa preta".

---

## Fluxo do produto

1. **Gatilho**: tela/opção "Não sei qual profissão seguir" — no onboarding (alternativa a escolher direto um cargo) e depois também acessível em Configurações/Carreira, para quem quiser refazer o teste.
2. **Questionário curto**: ~30–40 perguntas de escolha (Likert 1–5, "o quanto você se vê fazendo isso"), metade mapeada para RIASEC e metade para Work Values. 5–8 min, mobile-friendly (não é um teste longo de 100+ itens).
3. **Cálculo do match** (determinístico, no BFF): calcula os dois vetores da pessoa, cruza contra todo `career_role` ativo (todas as 30 categorias, não só TI), retorna os top 10–15 cargos ordenados por similaridade combinada.
4. **Apresentação dos resultados**: lista de cargos sugeridos com, por cargo, uma explicação curta de por que bateu (ex.: "forte em Investigativo e Realização — comum em carreiras de engenharia e ciência"). Pode usar o **mentor-agent existente** aqui (reaproveitar a infraestrutura `off`/`managed`/`byok` já construída) para transformar o resultado determinístico em texto mais pessoal — mesmo padrão do "explique o match" que já existe para vagas.
5. **Ação**: a pessoa escolhe um cargo sugerido (ou mais de um, para comparar) → isso se torna `targetRoleSlug` → roadmap calcula o caminho normalmente, como se ela tivesse escolhido direto.
6. **Refazer depois**: interesses/metas mudam; permitir refazer o teste e comparar com o resultado anterior.

---

## Dados / modelo (Postgres, mesmo padrão das migrations já existentes)

### Nova tabela: `vocational_quiz_response`
Guarda cada vez que alguém faz o teste (histórico, não só o último resultado).

| Coluna | Tipo | Nota |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK → users | |
| `riasec_scores` | jsonb | `{ "R": 72, "I": 85, "A": 40, "S": 30, "E": 55, "C": 20 }` |
| `work_value_scores` | jsonb | `{ "achievement": 80, "independence": 60, ... }` |
| `top_matches` | jsonb | snapshot dos cargos sugeridos no momento (slug + score), para histórico/auditoria |
| `created_at` | timestamptz | |

### Extensão de `career_role` (ALTER, não quebra nada)
| Coluna nova | Tipo | Nota |
|---|---|---|
| `riasec_code` | varchar(6), nullable | ex. `"IRC"` — top 2–3 letras dominantes do cargo |
| `work_value_tags` | jsonb, nullable, default `'[]'` | ex. `["achievement", "independence"]` — 1–3 valores dominantes |

Ambas nullable e com rollout gradual: **não é preciso taguear os 248 cargos de uma vez** antes de lançar. Dá pra começar com os cargos mais buscados (ex. os ~50 de maior `demand_score` no roadmap) e taguear o resto depois pela própria tela admin (mesmo padrão já usado para description/skillSlugs: "cadastra quando aparecer"). Cargos sem tag simplesmente não entram no ranking até serem tagueados — comportamento seguro por omissão.

### Novo endpoint (goroute-api)
`POST /api/career-guidance/quiz` → recebe as respostas, calcula e persiste os scores, devolve os top cargos.
`GET /api/career-guidance/history` → histórico de testes do usuário.

Módulo novo (`career-guidance`), reaproveitando `AuthBffModule`/guards de sessão já existentes — mesmo padrão dos módulos atuais (`career-catalog`, `roadmap`).

---

## Onde a IA (mentor) entra — e onde não entra

| Capacidade | Dono |
|---|---|
| Cálculo dos vetores RIASEC/Work Values a partir das respostas | Determinístico, fórmula fixa — nenhuma IA |
| Ranking dos cargos por similaridade | Determinístico (cosseno/distância) — nenhuma IA |
| Explicação em linguagem natural do porquê de cada sugestão | **Mentor** (`off` = heurística por template; `managed`/`byok` = LLM), reaproveitando a infra já existente |
| Decisão final de qual cargo seguir | Da pessoa, sempre — o produto sugere, não decide |

Isso segue exatamente o princípio já documentado para o mentor: a IA explica, não redefine o resultado.

---

## Fases sugeridas

1. **MVP determinístico**: questionário + cálculo de vetores + tags nos ~50 cargos de maior demanda + ranking simples + explicação por template (sem LLM ainda). Já é utilizável e testável sozinho.
2. **Explicação com IA**: plugar o mentor-agent para gerar o texto de "por que esse cargo combina com você", reaproveitando os modos `off`/`managed`/`byok` já existentes.
3. **Cobertura completa**: taguear os 248 cargos restantes (e os que forem cadastrados depois) via tela admin.
4. **Refinamento por uso** (opcional, mais pra frente): usar engajamento real (a pessoa escolheu o cargo sugerido? seguiu o roadmap até onde?) como sinal para revisar tags de cargo que erram muito o match — não é ML personalizado por usuário, é curadoria assistida por dado agregado.

## Pontos abertos (decisão do time, não bloqueiam o plano)

- Quiz obrigatório no onboarding para todo mundo, ou só para quem clicar em "não sei qual profissão seguir"? (Recomendo opcional — quem já sabe o que quer não deveria ser forçado a fazer um teste de 30 perguntas.)
- Quantidade de perguntas do quiz (30–40 é uma estimativa; o número exato depende de quantos itens por dimensão o time achar necessário para um score confiável).
- Consentimento LGPD específico para este teste (dado de preferência pessoal, mesmo escopo de cuidado já aplicado ao consentimento de IA do mentor).
