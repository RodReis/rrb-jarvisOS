/**
 * O catálogo de perguntas do wizard de contexto (SPEC-Planejamento-03).
 *
 * A pergunta que este arquivo responde: **quais decisões o PI precisa tomar para o projeto sair
 * do prompt inicial e chegar ao marco `contexto-aprovado`?**
 *
 * **Dado, não lógica** — mesma postura do `MENSAGEM_DO_MARCO`: acrescentar pergunta é editar
 * este array, nunca o serviço nem a tela. O grafo que consome isto (`wizard.ts`) não sabe o que
 * as perguntas significam; ele só sabe ordenar, filtrar por relevância e detectar contradição.
 *
 * **O limite deste catálogo é a invariante 9 do `CONVENTION.md` §4** — *requisito ausente não é
 * inferido; a pipeline não cria LGPD, consentimento, aceite duplo ou classificação por domínio*.
 * Toda pergunta aqui decide algo que o **MVP-008 já define** como necessário ao pacote
 * estrutural: escopo, público, superfície, profundidade da pesquisa e origem do design. Nenhuma
 * pergunta oferece requisito jurídico, de compliance ou de domínio que o PI não tenha informado
 * — e `wizard-catalogo.spec.ts` prova isso varrendo o texto de todas as opções.
 *
 * **Por que estas cinco e não outras.** Cada uma existe porque uma fatia seguinte do MVP-008
 * precisa da resposta para não inventar: a F04 escreve o PRD (precisa de escopo, público e
 * superfície), a F05 recebe os anexos de design (precisa saber se há design a anexar), a F06
 * monta o roadmap (precisa da profundidade). Pergunta que nenhuma fatia consome seria pergunta
 * inventada — exatamente o que a invariante 9 proíbe.
 */

import type { Pergunta } from './wizard'

/** A etapa do `PlanningSession` que este catálogo preenche. */
export const ETAPA_DO_CONTEXTO = 'contexto'

/**
 * As perguntas do contexto, na ordem em que são feitas.
 *
 * A ordem não é estética: `escopo` vem primeiro porque `superficie` e `pesquisa` dependem dela
 * — decidir a superfície antes de saber se o projeto é uma ferramenta interna ou um produto
 * público seria decidir no escuro, e é isso que `dependentes` registra.
 */
export const CATALOGO_DO_CONTEXTO: readonly Pergunta[] = [
  {
    id: 'escopo',
    etapa: ETAPA_DO_CONTEXTO,
    titulo: 'Escopo do projeto',
    enunciado: 'Qual é o alcance pretendido para esta primeira versão?',
    opcoes: [
      {
        id: 'fatia-vertical',
        rotulo: 'Uma fatia vertical funcionando ponta a ponta',
        impacto:
          'Entrega utilizável mais cedo e valida as integrações; deixa áreas inteiras sem cobertura até as fatias seguintes.'
      },
      {
        id: 'fundacao-ampla',
        rotulo: 'Fundação ampla antes de qualquer fluxo completo',
        impacto:
          'Reduz retrabalho estrutural depois; nada é utilizável até a fundação inteira fechar.'
      }
    ],
    recomendada: 'fatia-vertical',
    justificativa:
      'Uma fatia ponta a ponta expõe cedo os erros de integração, que são os mais caros de descobrir tarde. A fundação ampla só se paga quando a estrutura já é conhecida.',
    aceitaTextoLivre: true,
    delegavel: true,
    dependentes: ['superficie', 'pesquisa']
  },
  {
    id: 'publico',
    etapa: ETAPA_DO_CONTEXTO,
    titulo: 'Quem usa',
    enunciado: 'Para quem esta versão é construída?',
    opcoes: [
      {
        id: 'uso-proprio',
        rotulo: 'Uso próprio ou de um time pequeno conhecido',
        impacto:
          'Dispensa onboarding, telas de erro genéricas e superfícies de configuração; presume contexto que um usuário externo não tem.'
      },
      {
        id: 'usuarios-externos',
        rotulo: 'Usuários externos que não acompanham a construção',
        impacto:
          'Exige estados vazios, erros explicáveis e configuração sem suporte humano; aumenta o escopo de UI antes da primeira entrega.'
      }
    ],
    recomendada: 'uso-proprio',
    justificativa:
      'Enquanto o produto ainda muda de forma, construir para usuário externo antecipa custo de UI sobre decisões que vão mudar. Trocar depois é barato; o inverso não.',
    aceitaTextoLivre: true,
    delegavel: true,
    dependentes: ['superficie']
  },
  {
    id: 'superficie',
    etapa: ETAPA_DO_CONTEXTO,
    titulo: 'Superfície principal',
    enunciado: 'Por onde o projeto é operado nesta versão?',
    opcoes: [
      {
        id: 'interface-grafica',
        rotulo: 'Interface gráfica',
        impacto:
          'Torna o uso acessível sem instrução; custa design, estados e acessibilidade desde a primeira fatia.'
      },
      {
        id: 'linha-de-comando',
        rotulo: 'Linha de comando',
        impacto:
          'Entrega comportamento antes de qualquer tela e é automatizável; exclui quem não usa terminal.'
      },
      {
        id: 'servico-sem-interface',
        rotulo: 'Serviço sem interface própria',
        impacto:
          'Concentra o esforço na lógica e integra com o que já existe; depende de outra superfície para ser operado.'
      }
    ],
    recomendada: 'interface-grafica',
    justificativa:
      'Escolha condicionada pelas respostas anteriores; a interface gráfica é o padrão quando há usuários que não acompanham a construção. Para uso próprio, a linha de comando costuma entregar antes.',
    aceitaTextoLivre: true,
    delegavel: true
  },
  {
    id: 'pesquisa',
    etapa: ETAPA_DO_CONTEXTO,
    titulo: 'Profundidade da pesquisa',
    enunciado: 'Quanta pesquisa de mercado precede o PRD?',
    opcoes: [
      {
        id: 'pesquisa-dirigida',
        rotulo: 'Pesquisa dirigida às lacunas do PRD',
        impacto:
          'Mantém o custo baixo e o PRD no prazo; pode não descobrir uma alternativa fora do recorte pesquisado.'
      },
      {
        id: 'levantamento-amplo',
        rotulo: 'Levantamento amplo do espaço de soluções',
        impacto:
          'Cobre alternativas que uma busca dirigida não veria; consome orçamento de pesquisa e adia o PRD.'
      }
    ],
    recomendada: 'pesquisa-dirigida',
    justificativa:
      'A pesquisa dirigida resolve as lacunas que o PRD realmente tem. O levantamento amplo se justifica quando o espaço de soluções é desconhecido, não como padrão.',
    aceitaTextoLivre: true,
    delegavel: true
  },
  {
    id: 'design-de-origem',
    etapa: ETAPA_DO_CONTEXTO,
    titulo: 'Origem do design',
    enunciado: 'De onde vem a direção visual deste projeto?',
    opcoes: [
      {
        id: 'anexo-do-pi',
        rotulo: 'O PI anexa design system, HTML ou assets',
        impacto:
          'A direção visual fica cravada e auditável por hash; exige que os anexos existam antes da arquitetura.'
      },
      {
        id: 'proposta-para-aprovar',
        rotulo: 'Proposta gerada para o PI aprovar',
        impacto:
          'Destrava a construção sem esperar material pronto; a direção só se firma depois da aprovação.'
      }
    ],
    recomendada: 'anexo-do-pi',
    justificativa:
      'Anexo do PI é a origem que a M8-F05 trata como material aprovado, com hash no ato. A proposta é o caminho quando ainda não há design a anexar.',
    aceitaTextoLivre: false,
    delegavel: false
  }
]
