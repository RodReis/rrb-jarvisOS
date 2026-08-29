# REVIEW.md — Contrato dos revisores

Este arquivo contém as instruções de maior prioridade **fornecidas pelo projeto** aos agentes de revisão. Ele não substitui a SPEC aprovada, `CONVENTION.md`, `DECISIONS.md` nem instruções da plataforma.

## Objetivo

Encontrar defeitos reais no delta atual, evitar repetição de relatórios antigos e produzir descobertas corrigíveis com evidência. Revisão não é oportunidade para inventar escopo, política jurídica, classificação de domínio ou preferência pessoal.

## Entrada obrigatória

- SPEC e hashes aprovados;
- diff contra a base correta;
- arquivos e regras de domínio aplicáveis;
- resultados de testes;
- relatório anterior e falhas ainda abertas;
- contexto de tentativas e decisões estruturais.

## Ordem de revisão

1. Escopo e requisitos aprovados.
2. Corretude e invariantes de domínio.
3. Integridade de dados, idempotência e recuperação.
4. Fronteiras Electron/IPC, segredos e efeitos externos.
5. Testes e evidência.
6. Arquitetura e manutenção.
7. UI/UX, acessibilidade e estados, quando aplicável.
8. Desempenho e custo quando materialmente afetados.

## Severidade baseline

| Nível | Definição | Gate |
|---|---|---|
| P0 | Perda/corrupção, execução indevida ou quebra total | bloqueia |
| P1 | Requisito ou fluxo crítico incorreto | bloqueia |
| P2 | Defeito relevante com contorno | registra; não bloqueia automaticamente |
| P3 | Melhoria comprovável | registra; não bloqueia |

Elevar ou reduzir severidade exige evidência e impacto. Preferência estética sem relação com Design System não é descoberta.

## Formato da descoberta

Cada item informa: severidade, título, evidência, impacto, arquivo/região, cenário reproduzível, correção proposta e relação com descoberta anterior. Sem localização ou cenário, registrar como pergunta, não como defeito confirmado.

## Deduplicação

- Calcular fingerprint por verificador, código, arquivo, região e mensagem normalizada.
- Descoberta resolvida não reaparece como nova.
- Descoberta persistente informa o que mudou desde o relatório anterior.
- Revisar o delta e suas dependências diretas; ampliar contexto somente com motivo.

## Proibições

- Não inventar LGPD, consentimento, aceite duplo ou regra de produto.
- Não exigir ADR ou documento auxiliar como condição depois da fatia aprovada; corrigir no PR.
- Não pedir leitura integral do repositório sem justificar.
- Não ocultar falha para obter CI/merge.
- Não aceitar sucesso por código de saída zero sem verificar efeito e estado externo.
- Não expor segredos em relatório.

## Resultado

O relatório termina com: blockers P0/P1, itens P2/P3, testes executados, riscos residuais, conclusão `PASS`, `FIX_REQUIRED` ou `BLOCKED`, e evidências. `PASS` só é válido para o `head SHA` revisado.
