/**
 * Traduções do shell (SPEC-Fundacao-05).
 *
 * Recursos inline, não arquivos carregados por HTTP: o app é local-first e empacotado —
 * buscar tradução pela rede num app desktop offline seria uma dependência gratuita.
 *
 * Escopo: shell e telas existentes. Documentação interna **não** é traduzida (a spec é
 * explícita) — `docs/` segue só em pt-BR.
 */

export const RECURSOS = {
  'pt-BR': {
    translation: {
      espaco: {
        titulo: 'Espaço',
        noa: 'NOA',
        noaDescricao: 'Espaço pessoal',
        jarvis: 'JARVIS OS',
        jarvisDescricao: 'Espaço profissional',
        seletor: 'Espaço de trabalho'
      },
      // Tela CHOICE (SPEC-CHOICE-01) — a porta de entrada de cada sessão.
      choice: {
        titulo: 'Escolha o espaço',
        entrar: 'Entrar',
        // Rótulo visível curto ("Entrar"), como o protótipo; o nome acessível diz em qual espaço.
        entrarEm: 'Entrar em {{espaco}}',
        noa: {
          // Marca curta do card, distinta do nome completo do espaço ("NOA" vs. o mesmo aqui).
          nome: 'NOA',
          tagline: 'Pessoal',
          descricao: 'Agenda, rotina, saúde e finanças — privado por padrão.'
        },
        jarvis: {
          nome: 'JARVIS',
          tagline: 'Profissional · OS',
          descricao: 'Agentes, squads, workflows e operações de negócio.'
        },
        tema: {
          abrir: 'Ajustar tema e acento',
          titulo: 'Tema',
          acentoDe: 'Acento de {{espaco}}'
        }
      },
      navegacao: {
        principal: 'Navegação principal',
        de: 'Navegação de {{espaco}}',
        notas: 'Notas',
        agenda: 'Agenda',
        /*
         * Rótulos dos itens do menu (SPEC-Shell-01, regra 10). O protótipo usa **nomes próprios
         * em inglês** para as telas, de propósito — `Projects Hub`, `Operator Central` —, e é o
         * protótipo que vence na forma do menu.
         *
         * Estão aqui **todos** os itens do mapa da spec, inclusive os ocultos (critério 8): a
         * fatia que entregar a tela só precisa registrar o módulo, sem voltar ao i18n. Chave sem
         * módulo não vira item — quem decide isso é o registro, não esta tabela.
         */
        command: 'Command Center',
        voz: 'Voz',
        hud: 'HUD',
        mission: 'Mission Control',
        specialties: 'Specialties',
        skills: 'Skills Catalog',
        kanban: 'Kanban',
        workflows: 'Workflows',
        automations: 'Automations',
        osdesktop: 'OS Desktop',
        analytics: 'Analytics',
        insights: 'Insights',
        projects: 'Projects Hub',
        goals: 'Metas',
        studio: 'Studio',
        seo: 'SEO Content',
        video: 'Video Director',
        services: 'Services',
        terminal: 'Terminal',
        settings: 'Settings',
        operator: 'Operator Central',
        teams: 'Specialist Teams',
        memory: 'Agent Memory',
        notebook: 'Notebook'
      },
      /** Cabeçalhos de grupo da sidebar — mono uppercase no protótipo. */
      grupoDoMenu: {
        COMANDO: 'Comando',
        AGENTS_OS: 'Agents OS',
        OPERACOES: 'Operações',
        INTEL: 'Intel',
        NEGOCIOS: 'Negócios',
        SISTEMA: 'Sistema',
        CORE: 'Core',
        HARNESSES: 'Harnesses',
        TEAMS: 'Teams',
        GOVERNANCE: 'Governance',
        KNOWLEDGE: 'Knowledge'
      },
      voz: {
        titulo: 'Voz',
        verificando: 'Verificando o runtime de voz...',
        problema: 'Problema na voz',
        segureParaFalar: 'Segure para falar',
        gravando: 'Ouvindo...',
        transcrevendo: 'Transcrevendo...',
        runtimeAusente:
          'O runtime de transcricao ainda nao esta instalado nesta maquina. Ele roda local: nenhum audio sai daqui.',
        baixar: 'Baixar o runtime de voz',
        baixando: 'Baixando...',
        falhou: 'Nao foi possivel transcrever. Tentar de novo.',
        microfoneIndisponivel:
          'O microfone nao esta disponivel. Verifique a permissao do sistema e o dispositivo padrao.',
        compute: {
          gpu: 'GPU (CUDA)',
          cpu: 'CPU (int8)'
        },
        download: {
          'hash-divergente':
            'O arquivo baixado nao passou na verificacao de integridade e foi descartado. Tentar de novo.',
          bloqueado: 'A origem do download nao esta na lista permitida.',
          falhou: 'O download nao concluiu. Verifique a conexao e tente de novo.'
        }
      },
      janela: {
        minimizar: 'Minimizar para a bandeja'
      },
      // Shell do design system (SPEC-DesignSystem-04a).
      shell: {
        alternarTema: 'Alternar entre tema claro e escuro',
        // Sub-módulos do JARVIS — protótipo JARVISOS §2 (rail dual).
        commandCenter: 'Command Center',
        agentsOs: 'Agents OS',
        irPara: 'Ir para {{espaco}}',
        // Cabeçalhos da sidebar, que mudam com o sub-módulo ativo.
        jarvisOps: 'Professional Ops',
        jarvisAgents: 'Harnesses · Teams · Skills',
        noaPessoal: 'Pessoal',
        rodape: '© RRB Trading'
      },
      conteudo: {
        de: 'Conteúdo de {{rota}}',
        placeholder: 'Conteúdo placeholder — os módulos entram em fatias futuras.'
      },
      // Projetos locais (SPEC-Planejamento-01). Sem nenhum rótulo de Git: a tela não expõe
      // comando, e um texto de "inicializar repositório" anunciaria um controle que não existe.
      projetos: {
        // O card completo (SPEC-Fases-01). `gates` e `progresso` são contagens, e o formato
        // "n / total" cabe em mono sem virar frase — a linha do card é estreita.
        faseEtapa: '{{fase}} · {{etapa}}',
        progressoNaFase: '{{posicao}} / {{total}}',
        gatesAceitos: 'Gates {{aceitos}} / {{total}}',
        gatesRotulo: 'Gates aceitos',
        ultimoEvento: 'Último evento em {{data}}',
        semEvento: 'Sem movimento ainda',
        bloqueioTitulo: 'Bloqueado',
        titulo: 'Projetos locais',
        descricao:
          'Crie ou importe um projeto. O Git local é inicializado automaticamente; nada é publicado.',
        nome: 'Nome do projeto',
        nomePlaceholder: 'Ex.: Análise de Mercado',
        nomeAjuda: 'Vira o nome da pasta do projeto, sem acentos nem espaços.',
        criar: 'Criar projeto',
        importar: 'Importar pasta',
        carregando: 'Carregando projetos…',
        vazio: 'Nenhum projeto ainda',
        vazioDescricao: 'Crie um projeto novo ou importe uma pasta existente para começar.',
        criado: 'Criado',
        importado: 'Importado',
        renomear: 'Renomear',
        renomearDe: 'Renomear {{nome}}',
        salvar: 'Salvar',
        cancelar: 'Cancelar',
        remover: 'Remover',
        removerDe: 'Remover {{nome}} da lista',
        confirmar: 'Remover da lista',
        // Diz o que **de fato** acontece. Um "tem certeza?" genérico faria o usuário supor a
        // perda dos arquivos e desistir de uma ação que é reversível por reimportação.
        removerAviso: 'Sai da lista; a pasta e o histórico Git continuam no disco.',
        permitirGit: 'Permitir `git` e criar',
        // Diz o que o clique faz: é permissão de alto risco, auditada. O usuário merece saber
        // disso antes, não depois.
        permitirGitAviso: 'Ação de alto risco: registra o comando na lista permitida deste espaço.',
        // A jornada substituiu "Planejar" e "Contexto do projeto" (SPEC-Jornada-01): abrir o
        // projeto **é** planejar, e o pacote de contexto virou pré-condição de geração, não
        // tarefa do PI. Duas portas para o mesmo lugar era a confusão que a fatia corrige.
        abrir: 'Abrir {{nome}}',
        voltar: 'Voltar aos projetos'
      },
      rota: {
        // Qual rota a geração vai usar. Dito **antes** do clique: gerar gasta uma chamada, e na
        // rota paga gasta dinheiro — descobrir isso depois é tarde.
        viaAssinatura: 'Via assinatura Claude',
        viaPaga: 'Via rota paga',
        pagaTitulo: 'Esta geração usa a rota paga',
        pagaDescricao: 'A chamada é cobrada no provedor configurado para este workspace.'
      },
      prompt: {
        titulo: 'O prompt do projeto',
        // Diz o que fazer e o que acontece depois. O PI escreve melhor sabendo que o texto vira
        // perguntas, não um documento final.
        descricao:
          'Descreva {{nome}} como você contaria a alguém. A IA vai perguntar o que faltar.',
        rotulo: 'O que você quer construir',
        ajuda: 'Escreva livremente. Não precisa de estrutura nem de termos técnicos.',
        // Exemplos para **ler**, não para clicar: mostram o que faz um prompt render sem
        // empurrar o PI a copiar um texto que não é o problema dele.
        exemplosTitulo: 'Um prompt rende mais quando diz o problema e para quem',
        exemploA: 'Organiza minhas leituras e me lembra onde parei em cada uma.',
        exemploAPorque: 'problema e resultado',
        exemploB: 'Painel de custos por projeto, para eu ver quanto cada cliente consome.',
        exemploBPorque: 'quem usa e para quê',
        placeholder: 'Ex.: um app que organiza minhas leituras e me lembra do que parei no meio…',
        carregando: 'Carregando o prompt…',
        // Salvar não gera nada (#281): o prompt vira revisão no Git e a jornada vai para o
        // refinamento, que é onde o modelo entra. O rótulo diz o destino, não o mecanismo —
        // "Salvar" sozinho não conta ao PI que a tela muda depois do clique.
        salvar: 'Salvar e ir ao refinamento',
        salvando: 'Salvando…',
        escrevaAlgo: 'Escreva o prompt para continuar.',
        // O prompt vazio já desabilita o botão; esta é a segunda barreira, a do main.
        vazioRecusa: 'O prompt está vazio. Escreva o que você quer construir.',
        naoGerou: 'O prompt não foi salvo',
        // Título alternativo para quando o modelo respondeu em prosa: ali não houve defeito —
        // ele leu o pedido e levantou um ponto. Chamar isso de "não foi gerado" descreve a
        // consequência e esconde a causa, que é o que o PI precisa ler.
        modeloRespondeu: 'O modelo levantou um ponto antes de gerar',
        detalheTecnico: 'O que o validador recusou',
        falha: 'Não foi possível salvar o prompt. Tente de novo.'
      },
      brief: {
        titulo: 'Brief do projeto',
        descricao:
          'O que o app entendeu sobre {{nome}}. Cada afirmação diz de onde veio; corte o que não serve antes de aceitar.',
        carregando: 'Carregando o brief…',
        vazio: 'Nenhum brief ainda',
        vazioDescricao: 'Escreva o prompt e gere o brief para ver o que o app entendeu.',
        cortar: 'Cortar',
        cortarEsta: 'Cortar a afirmação: {{texto}}',
        pendenciaMaterial: 'Falta decidir antes de aceitar',
        // Diz onde a lista está, em vez de repeti-la: ela vive ao lado do botão que ela trava.
        pendenciaOndeVer_one: '{{count}} pendência, listada no aceite ao lado.',
        pendenciaOndeVer_other: '{{count}} pendências, listadas no aceite ao lado.',
        // O aceite do brief (SPEC-Jornada-02, critério 5). O rótulo diz o que o clique
        // faz — congela o documento e libera a próxima etapa —, não um "OK" genérico.
        aceitar: 'Aceitar o brief',
        aceiteTitulo: 'Aceite do brief',
        aceiteDescricao:
          'Aceitar congela este brief como base do PRD. Corte o que não serve antes: depois do aceite, mudar exige refazer a etapa.',
        aceiteBloqueado: 'Resolva as pendências para aceitar.',
        // Nomeia o que a coluna resume: de onde veio cada afirmação do brief.
        origensTitulo: 'Origem das {{total}} afirmações',
        /*
         * Rótulos da contagem, distintos dos que cada linha usa.
         *
         * A linha diz "do seu prompt" porque ela fala de uma afirmação; a legenda conta um
         * conjunto, e repetir a mesma frase faria a tela ter dois textos idênticos com papéis
         * diferentes — ambíguo para quem lê e para quem navega por leitor de tela.
         */
        contagem: {
          prompt: 'Do prompt',
          decisao: 'De decisão sua',
          proposto: 'Propostas pela IA'
        },
        aceiteFalhou: 'Não foi possível registrar o aceite. Tente de novo.',
        propostosTitulo: '{{count}} afirmações propostas pela IA',
        // Diz o que distingue estas das outras: ninguém as disse, foram inferidas.
        propostosDescricao:
          'Ninguém disse isto — a IA inferiu a partir do prompt. Corte o que não faz sentido.',
        origem: {
          prompt: 'do seu prompt',
          decisao: 'da sua decisão',
          proposto: 'proposto pela IA'
        },
        blocos: {
          identidade: 'Identidade',
          'problema-usuarios-resultado': 'Problema, usuários e resultado',
          'escopo-e-metricas': 'Escopo e métricas',
          jornadas: 'Jornadas',
          'dominio-e-dados': 'Domínio e dados',
          integracoes: 'Integrações',
          'stack-e-restricoes': 'Stack e restrições',
          'nao-funcionais-e-testes': 'Não funcionais e testes',
          'politica-git-provider-orcamento': 'Política, provider e orçamento',
          'riscos-e-decisoes-abertas': 'Riscos e decisões abertas'
        }
      },
      prd: {
        titulo: 'PRD, Landscape e Convention',
        // As abas (#333). Mesma forma da arquitetura, com uma diferença: aqui a contradição
        // trava o aceite, então a aba precisa dizer que o bloqueio é real.
        abasRotulo: 'Documentos do pacote estrutural',
        abaRevisar: 'A revisar',
        abaRevisarVazia: 'Nada a revisar',
        revisarTitulo: 'O que pede a sua decisão antes do aceite',
        revisarDescricao:
          'Reunido aqui para você não precisar procurar documento por documento. As contradições travam o aceite; as afirmações propostas, não — mas nenhuma delas veio de você.',
        revisarVazio: 'Nada a revisar',
        revisarVazioDescricao:
          'A IA não inferiu nada por conta própria e nada no pacote se contradiz. Leia os documentos e aceite quando estiver de acordo.',
        revisarPropostosTitulo: 'Afirmações propostas pela IA',
        descricao:
          'O que o app derivou do brief aceito de {{nome}}. Cada afirmação diz o que a sustenta; corte o que não serve antes de aceitar.',
        carregando: 'Carregando os documentos…',
        vazio: 'Nenhum documento ainda',
        vazioDescricao:
          'Confirme o termo de pesquisa (ou deixe vazio) e gere o PRD, o Landscape e a Convention.',
        // O termo é proposto pela IA e editado pelo PI — a busca não roda sem confirmação
        // (critério 3). O texto de ajuda diz a consequência de deixá-lo vazio.
        termo: 'Termo de pesquisa de mercado',
        termoAjuda:
          'A IA propôs este termo a partir do brief. Ajuste-o antes de gerar; a busca só acontece quando você gerar.',
        termoPlaceholder: 'ex.: ferramentas de planejamento para times pequenos',
        semTermo: 'Sem termo, o Landscape sai pendente e o PRD segue.',
        gerar: 'Gerar os documentos',
        regerar: 'Gerar de novo',
        documentoVazio: 'Nenhuma afirmação nesta revisão.',
        cortar: 'Cortar',
        cortarEsta: 'Cortar a afirmação: {{texto}}',
        landscapeBloqueado: 'Landscape pendente: a pesquisa não saiu',
        propostosTitulo: '{{count}} afirmações propostas pela IA',
        propostosDescricao:
          'Ninguém disse isto — a IA inferiu. Corte o que não faz sentido antes de aceitar.',
        contradicoesTitulo: '{{count}} contradições a resolver',
        contradicoesDescricao:
          'Duas afirmações não podem valer ao mesmo tempo. Responda uma por vez; quando a última for respondida, os três documentos são gerados de novo com as suas decisões. Nada é corrigido sozinho.',
        contradicoesRespondidas:
          'Todas respondidas. Se a geração automática não saiu, gere de novo para aplicar as decisões.',
        responderContradicoes: 'Responder às contradições',
        contradicoesPopupTitulo: 'Contradições de {{nome}}',
        contradicoesPopupDescricao:
          'Uma decisão por vez. A recomendação vem primeiro, mas a escolha é sua — e ao responder a última, os documentos são gerados de novo.',
        recomendacao: 'Recomendação: {{texto}}',
        aceitar: 'Aceitar o PRD',
        aceiteTitulo: 'Aceite do PRD',
        aceiteDescricao:
          'Aceitar congela esta revisão dos três documentos como base da arquitetura. Gerar de novo depois cria outra revisão e reabre este aceite.',
        aceiteBloqueado: 'Resolva as contradições acima para aceitar.',
        aceiteFalhou: 'Não foi possível registrar o aceite. Tente de novo.',
        origem: {
          brief: 'do brief aceito',
          decisao: 'da sua decisão',
          evidencia: 'de fonte pesquisada',
          proposto: 'proposto pela IA'
        },
        documentos: {
          PRD: 'PRD',
          LANDSCAPE: 'Landscape',
          CONVENTION: 'Convention'
        },
        descricoes: {
          PRD: 'Problema, usuários, escopo e critérios de sucesso — derivados do brief que você aceitou.',
          LANDSCAPE:
            'O cenário e as alternativas. Toda afirmação sobre terceiros cita a fonte de onde saiu.',
          CONVENTION:
            'As entidades, os estados e o vocabulário deste projeto — nada importado de outro.'
        },
        resultados: {
          gerado: 'Documentos gerados',
          'bloqueado-sem-rota': 'Nenhuma rota de geração disponível',
          'saida-invalida': 'A saída do modelo foi recusada',
          'projeto-inexistente': 'Projeto não encontrado',
          'brief-nao-aceito': 'Aceite o brief primeiro',
          'sem-contexto': 'O contexto do projeto não pôde ser montado',
          'falha-de-escrita': 'Não foi possível escrever os documentos'
        }
      },
      arquitetura: {
        titulo: 'Arquitetura, decisões, testes e revisão',
        // As abas (#333). "A revisar" primeiro porque é o que pede decisão; ler vem depois.
        abasRotulo: 'Documentos do pacote de arquitetura',
        abaRevisar: 'A revisar',
        abaRevisarVazia: 'Nada a revisar',
        revisarTitulo: 'O que pede a sua decisão antes do aceite',
        revisarDescricao:
          'Reunido aqui para você não precisar procurar documento por documento. Os ajustes falam dos seus protótipos; as afirmações propostas são inferências da IA dentro dos documentos.',
        revisarVazio: 'Nada a revisar',
        revisarVazioDescricao:
          'A IA não inferiu nada por conta própria e não achou divergência entre os protótipos e o PRD. Leia os documentos e aceite quando estiver de acordo.',
        revisarPropostosTitulo: 'Afirmações propostas pela IA',
        descricao:
          'O que o app derivou do PRD aceito e dos protótipos de {{nome}}. Cada afirmação diz o que a sustenta; fluxo só é prometido com a tela que o desenhou.',
        carregando: 'Carregando os documentos…',
        vazio: 'Nenhum documento ainda',
        vazioDescricao:
          'Com os anexos completos e o PRD aceito, gere a arquitetura, as decisões, os testes e a revisão.',
        gerar: 'Gerar os documentos',
        regerar: 'Gerar de novo',
        documentoVazio: 'Nenhuma afirmação nesta revisão.',
        cortar: 'Cortar',
        cortarEsta: 'Cortar a afirmação: {{texto}}',
        descartar: 'Descartar',
        descartarEste: 'Descartar o ajuste: {{texto}}',
        propostosTitulo: '{{count}} afirmações propostas pela IA',
        propostosDescricao:
          'Ninguém disse isto — a IA inferiu. Corte o que não faz sentido antes de aceitar.',
        // Os ajustes são propostas sobre o **seu** desenho. O texto diz o que o app não faz:
        // ele não mexe no protótipo, e descartar é a única ação daqui.
        ajustesTitulo: '{{count}} ajustes propostos pela IA',
        ajustesDescricao:
          'A IA leu seus protótipos contra o PRD. Nada foi alterado nos anexos: mudar o desenho é ato seu, e descartar só tira o ajuste desta revisão.',
        recomendacao: 'Recomendação: {{texto}}',
        // O aviso de chegada (#332, defeito 5). A geração termina e o PI continua olhando o topo
        // da tela; a lista dos ajustes fica abaixo da dobra, e ele só descobre rolando.
        chegadaTitulo_one: 'A IA propôs 1 ajuste',
        chegadaTitulo_other: 'A IA propôs {{count}} ajustes',
        chegadaDescricao:
          'A arquitetura foi gerada. A IA comparou seus protótipos com o PRD e anotou o que não fecha.',
        // Responde a pergunta do PI: "ajuste é DISCARTE?". É: descartar é a única ação daqui.
        chegadaOQueE:
          'Nada foi alterado nos seus anexos. A única ação sobre um ajuste é descartá-lo desta revisão — mudar o desenho é ato seu, fora do app.',
        chegadaVer: 'Ver os ajustes',
        chegadaDepois: 'Depois',
        aceitar: 'Aceitar o pacote',
        aceiteTitulo: 'Aceite do pacote',
        aceiteDescricao:
          'Aceitar congela esta revisão — PRD, anexos, arquitetura, testes e revisão — como base do roadmap. Gerar de novo depois cria outra revisão e reabre este aceite.',
        aceiteFalhou: 'Não foi possível registrar o aceite. Tente de novo.',
        origem: {
          prd: 'do PRD aceito',
          prototipo: 'do protótipo que você desenhou',
          decisao: 'da sua decisão',
          proposto: 'proposto pela IA'
        },
        ajustes: {
          telaSemRequisito: 'tela sem requisito',
          requisitoSemTela: 'requisito sem tela',
          estadoAusente: 'estado ausente'
        },
        documentos: {
          ARCHITECTURE: 'Arquitetura',
          DECISIONS: 'Decisões',
          TESTING: 'Testes',
          REVIEW: 'Revisão'
        },
        descricoes: {
          ARCHITECTURE:
            'Módulos, dados, fronteiras e resiliência. Os fluxos citam a tela do protótipo que os desenhou.',
          DECISIONS:
            'As decisões estruturais como ADRs. As propostas pela IA aparecem como proposta, não como decisão tomada.',
          TESTING:
            'A estratégia de evidência deste projeto, derivada dos requisitos e das jornadas prototipadas.',
          REVIEW: 'Como revisar o código deste projeto — nada importado de outro.'
        },
        resultados: {
          gerada: 'Documentos gerados',
          'projeto-inexistente': 'Projeto não encontrado',
          'anexos-pendentes': 'Faltam anexos do design',
          'prd-ausente': 'Gere o PRD primeiro',
          'prototipos-invalidos': 'Os protótipos têm problemas a resolver',
          'bloqueado-sem-rota': 'Nenhuma rota de geração disponível',
          'saida-invalida': 'A saída do modelo foi recusada',
          'sem-contexto': 'O contexto do projeto não pôde ser montado',
          'falha-de-escrita': 'Não foi possível escrever os documentos'
        }
      },
      refinamento: {
        titulo: 'Refinamento',
        // Diz o que o refinamento faz e o que ele cobra: decisões, não formulário.
        descricao: 'A IA pergunta o que o prompt de {{nome}} não respondeu. Uma decisão por vez.',
        carregando: 'Carregando o refinamento…',
        gerar: 'Gerar as perguntas',
        // O brief fecha o refinamento (#281). O rótulo nomeia o documento, não o ato: é o que o
        // PI vai ler na etapa seguinte, e "Concluir" não diria o que ele ganha.
        gerarBrief: 'Gerar o brief',
        briefFalhou: 'Não foi possível gerar o brief. Tente de novo.',
        gerarMais: 'Procurar o que ainda falta',
        responder: 'Responder a próxima',
        // O número diz ao PI se ele começa agora ou depois. Um botão sem essa conta pediria
        // um compromisso de duração desconhecida.
        restantes: '{{count}} decisões pendentes.',
        // Diz **qual** é a próxima decisão. O número sozinho pede um compromisso às cegas.
        aSeguir: 'A próxima',
        concluido: 'Todas as perguntas foram respondidas.',
        semRota: 'A geração está indisponível',
        naoGerou: 'As perguntas não foram geradas',
        falha: 'Não foi possível gerar as perguntas. Tente de novo.'
      },
      jornada: {
        titulo: 'Jornada de planejamento',
        // Marca as cinco etapas que param para a decisão do PI. Curto porque repete na coluna.
        pedeAceite: 'Pede seu aceite',
        // Diz o que a trilha é e o que ela cobra. "Uma etapa por vez" é a regra visível: o PI
        // não escolhe por onde começar, e saber disso evita procurar um atalho que não existe.
        descricao: 'Uma etapa por vez. Aceites são seus; o resto o app prepara.',
        carregando: 'Carregando a jornada…',
        regrediu: 'A jornada voltou uma etapa',
        etapas: {
          prompt: 'Prompt inicial',
          refinamento: 'Refinamento',
          'brief-aceito': 'Aceite do brief',
          prd: 'PRD',
          'prd-aceito': 'Aceite do PRD',
          design: 'Anexos de design',
          arquitetura: 'Arquitetura',
          'pacote-aceito': 'Aceite do pacote',
          roadmap: 'Roadmap',
          'mvp-aceito': 'Aceite do MVP',
          'spec-aceita': 'Aceite da SPEC',
          construcao: 'Construção'
        }
      },
      roadmap: {
        titulo: 'Roadmap e aprovações',
        // As abas (#333). Aqui os rótulos são etapas do trabalho, não documentos: escolher o
        // MVP, ler a SPEC que nasceu dele, e aprovar os gates.
        abasRotulo: 'Etapas do roadmap',
        abaMvps: 'MVPs',
        abaSpec: 'SPEC da fatia',
        abaGates: 'Aprovações',
        specAusente: 'Nenhuma SPEC ainda',
        specAusenteDescricao:
          'A SPEC da primeira fatia nasce quando você escolhe o MVP que entra na fila. Escolha um na aba MVPs.',
        descricao:
          'Os MVPs de {{nome}}, propostos a partir do PRD aceito e da arquitetura aprovada. Gerar propõe; escolher e aprovar são seus.',
        carregando: 'Carregando o roadmap…',
        gerar: 'Gerar roadmap',
        regerar: 'Gerar de novo',
        vazio: 'Nenhum roadmap gerado ainda',
        vazioDescricao:
          'Os MVPs nascem do PRD aceito e da arquitetura aprovada. Gerar propõe o mapa; qual MVP entra na fila é sua escolha.',
        mvps: '{{count}} MVPs propostos',
        resultado: 'Resultado: {{texto}}',
        naFila: 'Na fila',
        escolher: 'Escolher e gerar a SPEC',
        escolherEste: 'Escolher "{{titulo}}" e gerar a SPEC',
        inelegivel: 'Depende de um MVP que ainda não foi entregue.',
        origem: {
          prd: 'PRD',
          arquitetura: 'Arquitetura',
          proposto: 'Proposto pela IA'
        },
        resultados: {
          gerado: 'Roadmap gerado',
          'projeto-inexistente': 'Projeto não encontrado',
          'pacote-ausente': 'Falta o pacote do projeto',
          'bloqueado-sem-rota': 'Nenhuma rota autorizada',
          'sem-contexto': 'O contexto não pôde ser montado',
          'saida-invalida': 'O roadmap proposto não passou no validador',
          'mvp-nao-escolhido': 'Nenhum MVP na fila ainda',
          'mvp-inelegivel': 'Este MVP ainda não pode entrar na fila',
          'falha-de-escrita': 'Não foi possível escrever os documentos'
        },
        specTitulo: 'SPEC — {{titulo}}',
        specDescricao:
          'A primeira fatia de {{mvp}}. Nasce em rascunho: o aceite é seu, e depende das perguntas abaixo.',
        spec: {
          objetivo: 'Objetivo',
          fluxo: 'Fluxo',
          regras: 'Regras',
          criterios: 'Critérios de aceite',
          testes: 'Testes e evidência'
        },
        perguntasTitulo: '{{count}} decisões em aberto',
        perguntasDescricao:
          'A SPEC não pode ser aceita enquanto houver pergunta sem resposta. São decisões suas, não da IA.',
        perguntasRespondidas: 'Todas as decisões foram tomadas',
        perguntasRespondidasDescricao: 'A SPEC pode ser aceita no gate abaixo.',
        recomendada: 'Recomendada',
        escolhida: 'Escolhida',
        responder: 'Escolher',
        responderCom: 'Escolher "{{rotulo}}"',
        justificativa: 'Por que a recomendada: {{texto}}',
        estado: {
          proposto: 'Proposto',
          'na-fila': 'Na fila',
          concluido: 'Concluído'
        },
        dependeDe: 'Depende de: {{lista}}.',
        detalhada: 'SPEC detalhada',
        gates: 'Centro de aprovações',
        gate: {
          PROJECT_PACKAGE: 'O pacote do projeto: PRD, arquitetura e os anexos de design.',
          MVP_ENTRY: 'A revisão do MVP que entra na fila de execução.',
          SLICE_ENTRY: 'A revisão da SPEC a executar.'
        },
        aprovado: 'Aprovado',
        pendente: 'Aguardando aceite',
        aprovar: 'Aprovar',
        semRevisoes: 'Nada a aprovar ainda neste gate.',
        aprovadoPor: 'Aprovado por {{identidade}}.',
        hashCompleto: 'Hash completo: {{hash}}'
      },
      anexos: {
        titulo: 'Anexos de design',
        descricao:
          'O design system e os protótipos de {{nome}}. A arquitetura só é gerada depois que eles chegam — anexar é um ato seu, e é ele que conta.',
        carregando: 'Carregando anexos…',
        tipo: {
          'design-system': 'DESIGN-SYSTEM.md',
          prototipo: 'Protótipo HTML',
          asset: 'Asset'
        },
        anexado: 'Anexado',
        pendente: 'Pendente',
        anexar: 'Anexar',
        substituir: 'Substituir',
        remover: 'Remover',
        removerAnexo: 'Remover {{caminho}}',
        assets: 'Assets referenciados pelos protótipos',
        adicionarAsset: 'Adicionar asset',
        semAssets: 'Nenhum asset anexado. Anexe os que seus protótipos referenciam.',
        gateAberto: 'Os anexos estão completos. A arquitetura pode ser gerada.',
        gateFechado: 'Falta anexar: {{lista}}.',
        validar: 'Validar protótipos',
        pendencias: 'Faltam: {{lista}}.',
        validacaoLimpa: 'Os protótipos não apresentaram problemas.',
        impede: 'Impede a arquitetura',
        recomendacao: 'Recomendação: {{texto}}',
        revisao: 'Última arquitetura de {{count}}',
        semCommit: 'Sem commit',
        commitCompleto: 'Commit completo: {{hash}}',
        afirmacoes: '{{count}} afirmações',
        hashCompleto: 'Hash completo: {{hash}}'
      },
      pacote: {
        titulo: 'Pacote estrutural',
        descricao:
          'PRD, Landscape e Convention de {{nome}}, compostos das decisões do planejamento e das fontes pesquisadas.',
        consulta: 'Pesquisa de mercado',
        consultaPlaceholder: 'Ex.: alternativas a gestores de tarefas locais',
        consultaAjuda:
          'O termo que busca concorrentes e alternativas. Em branco, o Landscape sai sem cenário e declara isso.',
        gerar: 'Gerar pacote',
        carregando: 'Carregando revisões…',
        vazio: 'Nenhuma revisão gerada ainda.',
        pendencias: 'Faltam: {{lista}}.',
        revisao: 'Última revisão de {{count}}',
        semCommit: 'Sem commit',
        commitCompleto: 'Commit completo: {{hash}}',
        afirmacoes: '{{count}} afirmações',
        hashCompleto: 'Hash completo: {{hash}}',
        bloqueio: {
          causa: 'Causa',
          evidencia: 'Evidência',
          tentativas: 'Tentativas',
          porQueNaoSeguir: 'Por que não seguir',
          retomada: 'Como retomar'
        }
      },
      wizard: {
        titulo: 'Planejamento de {{nome}}',
        descricao:
          'Uma decisão por vez. A recomendação vem primeiro, mas a escolha é sua — e cada opção diz o que custa.',
        carregando: 'Carregando o planejamento…',
        indisponivel: 'Não foi possível abrir o planejamento deste projeto.',
        fechar: 'Fechar',
        restantes: '{{count}} restantes',
        recomendada: 'Recomendada',
        porque: 'Por quê: {{justificativa}}',
        textoLivre: 'Outra resposta',
        textoLivrePlaceholder: 'Descreva a sua escolha, se nenhuma opção servir',
        decidePorMim: 'Decide por mim',
        confirmar: 'Confirmar',
        contradicaoTitulo: 'Esta resposta muda decisões já tomadas',
        contradicaoItem: '{{pergunta}} — decidido antes: {{anterior}}',
        contradicaoManter: 'Manter como está',
        contradicaoSubstituir: 'Substituir',
        resumo: 'Decisões',
        jaDecidido: 'Já decidido',
        resumoItem: '{{pergunta}}: {{escolha}}',
        autorPi: 'Você',
        autorAgente: 'Delegado'
      },
      contexto: {
        titulo: 'Contexto, skills e orçamento',
        descricao:
          'Monte o contexto antes de gerar. O manifesto registra quais revisões foram enviadas, sob qual teto e por qual rota.',
        tarefa: 'Tarefa ou SPEC',
        tarefaPlaceholder: 'Ex.: SPEC-Planejamento-02',
        tarefaAjuda: 'O que esta geração precisa resolver. Vai para o manifesto.',
        arquivos: 'Arquivos do contexto',
        arquivosPlaceholder: 'docs/PRD.md',
        arquivosAjuda:
          'Caminhos relativos ao projeto, um por linha. Curinga (*) conta como leitura ampla e exige motivo.',
        excecao: 'Motivo da leitura ampla',
        excecaoPlaceholder: 'Ex.: regressão sem localização conhecida',
        excecaoAjuda: 'Fica registrado no manifesto. Leitura ampla sem motivo é recusada.',
        motivoPadrao: 'selecionado na tela',
        montar: 'Montar contexto',
        carregando: 'Carregando contexto…',
        vazio: 'Nenhum contexto montado',
        vazioDescricao: 'Selecione os arquivos da tarefa e monte o contexto antes de gerar.',
        manifesto: 'Último manifesto',
        hashDoPack: 'pack {{hash}}',
        hashCompleto: 'Hash completo: {{hash}}',
        colunaArquivo: 'Arquivo',
        colunaOrigem: 'Origem',
        colunaHash: 'Revisão',
        colunaBytes: 'Bytes',
        legendaTabela: 'Arquivos enviados no contexto de {{tarefa}}',
        origem: {
          explicito: 'Explícito',
          'busca-estrutural': 'Busca',
          'leitura-ampla': 'Ampla',
          'decisao-aprovada': 'Decisão',
          'evidencia-externa': 'Evidência'
        },
        tokensDaEtapa: 'Tokens desta etapa',
        tokensDe: '{{usados}} de {{teto}}',
        // A rota de assinatura não tem custo por chamada: dizer "US$ 0,00" aqui afirmaria que
        // a chamada foi de graça, quando o fato é que esta rota não cobra por chamada.
        rotaSemCusto:
          'Rota {{rota}}: registra uso (chamadas, tokens e tempo), sem custo por chamada.',
        rotaComCusto: 'Rota {{rota}}: {{valor}} estimados para esta etapa.',
        expansao: 'Teto expandido: {{motivo}}',
        excecaoRegistrada: 'Exceção de leitura ampla',
        tetoDaExcecao: 'Teto autorizado: {{bytes}} bytes',
        falhasAbertas: 'Falhas em aberto',
        ocorrencias: '{{total}} ocorrência(s)',
        resolver: 'Marcar resolvida',
        resolverDe: 'Marcar resolvida: {{resumo}}',
        capacidades: 'Como o fluxo aplica cada disciplina',
        meioSkill: 'Skill',
        meioDireto: 'Direto',
        erroInesperado: 'Não foi possível montar o contexto. Tente novamente.'
      },
      settings: {
        titulo: 'Configurações',
        // As cinco abas (decisão do PI, 2026-08-30). Nomes curtos: são régua, não frase.
        abaGeral: 'Geral',
        abaPermissoes: 'Permissões',
        abaIa: 'IA',
        abaRoteamento: 'Modelos',
        abaConectores: 'Conectores',
        abaVoz: 'Voz',
        vozDescricao:
          'A transcricao roda nesta maquina. Nenhum audio sai daqui e nada e gravado em disco.',
        vozModelo: 'Modelo de transcricao',
        vozModeloDescricao:
          'Modelos maiores acertam mais e demoram mais. Trocar aqui vale na proxima fala; o modelo novo e baixado no primeiro uso.',
        vozIdioma: 'Idioma da fala',
        vozIdiomaDescricao: 'O idioma esperado do que voce fala, nao o da interface.',
        vozHotkey: 'Atalho global',
        vozHotkeyDescricao:
          'Funciona com a janela minimizada. Um toque abre o microfone, outro encerra e transcreve.',
        vozTimeout: 'Encerrar sozinho apos',
        vozTimeoutDescricao:
          'Protege contra o atalho esquecido: passado esse tempo, a gravacao encerra e transcreve o que houver.',
        vozSegundos: '{{valor}} segundos',
        vozMinutos: '{{valor}} minutos',
        idioma: 'Idioma',
        idiomaDescricao: 'Aplica imediatamente, sem reiniciar.',
        tema: 'Tema',
        temaDescricao: 'O padrão acompanha a preferência do sistema.',
        temaClaro: 'Claro',
        temaEscuro: 'Escuro',
        temaSistema: 'Sistema',
        acento: 'Acento',
        acentoDescricao: 'A cor de destaque de cada espaço. A mesma escolha da tela de entrada.',
        salvo: 'Preferências salvas.',
        // Diretórios permitidos (SPEC-ExecucaoReal-03). O texto diz o que a permissão
        // alcança — filesystem **e** terminal — porque a lista governa os dois, e o usuário
        // que a lesse como "pastas do explorador" subestimaria o que está autorizando.
        diretorios: 'Diretórios permitidos',
        diretoriosDescricao:
          'As pastas que o aplicativo pode ler, escrever e usar como diretório de trabalho no terminal. Nada fora desta lista é alcançável.',
        diretoriosAdicionar: 'Permitir uma pasta…',
        diretoriosRemover: 'Remover',
        diretoriosRemoverDe: 'Remover {{caminho}}',
        diretoriosFixo: 'Fixo',
        diretoriosFixoMotivo:
          'A pasta do aplicativo é permitida por construção e não pode ser removida.',
        diretoriosCarregando: 'Carregando os diretórios permitidos…',
        diretoriosVazio: 'Só a pasta do aplicativo está permitida',
        diretoriosVazioDescricao:
          'Permita uma pasta para o aplicativo poder trabalhar nela — sem isso, o terminal recusa qualquer diretório de trabalho fora da pasta do app.',
        diretoriosErro: 'Não foi possível ler os diretórios permitidos',
        // Diz **o que fazer**, não só que falhou (PRD §14). Sem a lista, permitir ou remover
        // pasta agiria às cegas — daí a instrução ser reabrir, e não "tente de novo".
        diretoriosErroDescricao:
          'Feche e reabra as configurações. Enquanto a lista não carregar, não é possível permitir nem remover pastas com segurança.',
        diretoriosErroAdicionar: 'Não foi possível permitir essa pasta.',
        diretoriosErroRemover: 'Não foi possível remover essa pasta.'
      },
      auth: {
        titulo: 'JARVIS OS',
        subtitulo: 'Entre com sua conta Google para começar.',
        entrar: 'Entrar com o Google',
        // Rótulo do botão enquanto o login corre no navegador, em duas partes: o visível fica
        // curto porque o botão divide a largura com o do GitHub — a frase inteira quebrava em
        // três linhas e isolava o spinner. O complemento vai no nome acessível.
        //
        // São duas frases inteiras, e não um prefixo + complemento: concatenar daria
        // "Aguardando… o navegador", com a pausa no meio. O rótulo curto fica `aria-hidden` e a
        // frase completa vive no `sr-only`, então cada público lê a versão que lhe serve.
        aguardando: 'Aguardando…',
        aguardandoNavegador: 'Aguardando o navegador…',
        entrandoDescricao:
          'Concluímos o login na aba que abrimos no seu navegador. Volte aqui quando terminar.',
        sair: 'Sair',
        sessaoExpirada: 'Sessão expirada',
        // A mensagem de erro vem pronta do main (critério 6) e é exibida como veio;
        // esta chave é só o rótulo da região que a apresenta.
        falha: 'Não foi possível entrar',
        tentarNovamente: 'Tentar novamente',
        conta: 'Conta conectada',
        // Rodapé institucional do protótipo. O ano é literal e não `new Date()`: o aviso de
        // copyright é texto legal, e um ano que muda sozinho na virada tornaria a tela
        // dependente do relógio da máquina para dizer algo que não é sobre a máquina.
        copyright: '© 2026 RRB Trading — Todos os direitos reservados',
        privacidade: 'Política de Privacidade',
        termos: 'Termos de Uso',
        local: 'GOIÂNIA · BRASIL',
        // Campos e provedores da maquete do protótipo. Usuário/senha e GitHub estão
        // desabilitados — só o Google autentica (SPEC-Fundacao-03). O aviso existe para que o
        // cinza do desabilitado não seja a única pista de que ainda não funcionam.
        usuario: 'usuário',
        senha: 'senha',
        acessar: 'Acessar',
        ouCadastre: 'ou cadastre-se com',
        google: 'Google',
        github: 'GitHub',
        // Prefixo `sr-only` dos botões de provedor: o rótulo visível é só a marca ("Google"),
        // como no protótipo, mas o nome acessível precisa dizer a ação inteira.
        entrarCom: 'Entrar com o',
        // Depois de uma falha, o nome acessível do botão do provedor convida a repetir — sem
        // alongar o rótulo visível, que não cabe em metade da grade de dois provedores.
        tentarNovamenteCom: 'Tentar novamente com o',
        senhaEmBreve: 'Login por usuário e senha e entrada com GitHub ainda não estão disponíveis.'
      },
      erro: {
        espaco: 'Não foi possível carregar o espaço de trabalho.',
        trocaEspaco: 'Não foi possível alternar o espaço de trabalho.',
        preferencias: 'Não foi possível salvar as preferências.'
      },
      carregando: 'Carregando…'
    }
  },
  'en-US': {
    translation: {
      espaco: {
        titulo: 'Workspace',
        noa: 'NOA',
        noaDescricao: 'Personal space',
        jarvis: 'JARVIS OS',
        jarvisDescricao: 'Professional space',
        seletor: 'Workspace'
      },
      choice: {
        titulo: 'Choose your space',
        entrar: 'Enter',
        entrarEm: 'Enter {{espaco}}',
        noa: {
          nome: 'NOA',
          tagline: 'Personal',
          descricao: 'Calendar, routine, health, and finances — private by default.'
        },
        jarvis: {
          nome: 'JARVIS',
          tagline: 'Professional · OS',
          descricao: 'Agents, squads, workflows, and business operations.'
        },
        tema: {
          abrir: 'Adjust theme and accent',
          titulo: 'Theme',
          acentoDe: '{{espaco}} accent'
        }
      },
      navegacao: {
        principal: 'Main navigation',
        de: '{{espaco}} navigation',
        notas: 'Notes',
        agenda: 'Calendar',
        // Nomes próprios do protótipo: os mesmos nos dois idiomas, de propósito.
        command: 'Command Center',
        voz: 'Voice',
        hud: 'HUD',
        mission: 'Mission Control',
        specialties: 'Specialties',
        skills: 'Skills Catalog',
        kanban: 'Kanban',
        workflows: 'Workflows',
        automations: 'Automations',
        osdesktop: 'OS Desktop',
        analytics: 'Analytics',
        insights: 'Insights',
        projects: 'Projects Hub',
        goals: 'Goals',
        studio: 'Studio',
        seo: 'SEO Content',
        video: 'Video Director',
        services: 'Services',
        terminal: 'Terminal',
        settings: 'Settings',
        operator: 'Operator Central',
        teams: 'Specialist Teams',
        memory: 'Agent Memory',
        notebook: 'Notebook'
      },
      grupoDoMenu: {
        COMANDO: 'Command',
        AGENTS_OS: 'Agents OS',
        OPERACOES: 'Operations',
        INTEL: 'Intel',
        NEGOCIOS: 'Business',
        SISTEMA: 'System',
        CORE: 'Core',
        HARNESSES: 'Harnesses',
        TEAMS: 'Teams',
        GOVERNANCE: 'Governance',
        KNOWLEDGE: 'Knowledge'
      },
      voz: {
        titulo: 'Voice',
        verificando: 'Checking the voice runtime...',
        problema: 'Voice problem',
        segureParaFalar: 'Hold to talk',
        gravando: 'Listening...',
        transcrevendo: 'Transcribing...',
        runtimeAusente:
          'The transcription runtime is not installed on this machine yet. It runs locally: no audio leaves this device.',
        baixar: 'Download the voice runtime',
        baixando: 'Downloading...',
        falhou: 'Could not transcribe. Try again.',
        microfoneIndisponivel:
          'The microphone is unavailable. Check system permission and the default device.',
        compute: {
          gpu: 'GPU (CUDA)',
          cpu: 'CPU (int8)'
        },
        download: {
          'hash-divergente':
            'The downloaded file failed the integrity check and was discarded. Try again.',
          bloqueado: 'The download origin is not on the allowed list.',
          falhou: 'The download did not finish. Check your connection and try again.'
        }
      },
      janela: {
        minimizar: 'Minimize to tray'
      },
      shell: {
        alternarTema: 'Toggle light and dark theme',
        commandCenter: 'Command Center',
        agentsOs: 'Agents OS',
        irPara: 'Go to {{espaco}}',
        jarvisOps: 'Professional Ops',
        jarvisAgents: 'Harnesses · Teams · Skills',
        noaPessoal: 'Personal',
        rodape: '© RRB Trading'
      },
      conteudo: {
        de: '{{rota}} content',
        placeholder: 'Placeholder content — modules arrive in later slices.'
      },
      projetos: {
        faseEtapa: '{{fase}} · {{etapa}}',
        progressoNaFase: '{{posicao}} / {{total}}',
        gatesAceitos: 'Gates {{aceitos}} / {{total}}',
        gatesRotulo: 'Accepted gates',
        ultimoEvento: 'Last event on {{data}}',
        semEvento: 'No movement yet',
        bloqueioTitulo: 'Blocked',
        titulo: 'Local projects',
        descricao:
          'Create or import a project. Local Git is initialized automatically; nothing is published.',
        nome: 'Project name',
        nomePlaceholder: 'e.g. Market Analysis',
        nomeAjuda: 'Becomes the project folder name, without accents or spaces.',
        criar: 'Create project',
        importar: 'Import folder',
        carregando: 'Loading projects…',
        vazio: 'No projects yet',
        vazioDescricao: 'Create a new project or import an existing folder to get started.',
        criado: 'Created',
        importado: 'Imported',
        renomear: 'Rename',
        renomearDe: 'Rename {{nome}}',
        salvar: 'Save',
        cancelar: 'Cancel',
        remover: 'Remove',
        removerDe: 'Remove {{nome}} from the list',
        confirmar: 'Remove from list',
        removerAviso: 'Removed from the list; folder and Git history stay on disk.',
        permitirGit: 'Allow `git` and create',
        permitirGitAviso: 'High-risk action: records the command in this space allowed list.',
        abrir: 'Open {{nome}}',
        voltar: 'Back to projects'
      },
      rota: {
        viaAssinatura: 'Via Claude subscription',
        viaPaga: 'Via paid route',
        pagaTitulo: 'This generation uses the paid route',
        pagaDescricao: 'The call is billed to the provider configured for this workspace.'
      },
      prompt: {
        titulo: 'The project prompt',
        descricao: 'Describe {{nome}} as you would to a person. The AI will ask what is missing.',
        rotulo: 'What you want to build',
        ajuda: 'Write freely. No structure or technical terms needed.',
        exemplosTitulo: 'A prompt goes further when it says the problem and who it is for',
        exemploA: 'Organizes my reading and reminds me where I left off in each one.',
        exemploAPorque: 'problem and outcome',
        exemploB: 'Cost panel per project, so I can see how much each client consumes.',
        exemploBPorque: 'who uses it and what for',
        placeholder: 'e.g. an app that organizes my reading and reminds me what I left halfway…',
        carregando: 'Loading the prompt…',
        salvar: 'Save and go to refinement',
        salvando: 'Saving…',
        escrevaAlgo: 'Write the prompt to continue.',
        vazioRecusa: 'The prompt is empty. Write what you want to build.',
        naoGerou: 'The prompt was not saved',
        modeloRespondeu: 'The model raised a point before generating',
        detalheTecnico: 'What the validator refused',
        falha: 'Could not save the prompt. Try again.'
      },
      brief: {
        titulo: 'Project brief',
        descricao:
          'What the app understood about {{nome}}. Every statement says where it came from; cut what does not fit before accepting.',
        carregando: 'Loading the brief…',
        vazio: 'No brief yet',
        vazioDescricao: 'Write the prompt and generate the brief to see what the app understood.',
        cortar: 'Cut',
        cortarEsta: 'Cut the statement: {{texto}}',
        pendenciaMaterial: 'Decide this before accepting',
        pendenciaOndeVer_one: '{{count}} pending item, listed in the acceptance panel.',
        pendenciaOndeVer_other: '{{count}} pending items, listed in the acceptance panel.',
        aceitar: 'Accept the brief',
        aceiteTitulo: 'Brief acceptance',
        aceiteDescricao:
          'Accepting freezes this brief as the basis for the PRD. Cut what does not belong first: after acceptance, changing it means redoing the stage.',
        aceiteBloqueado: 'Resolve the pending items to accept.',
        origensTitulo: 'Origin of the {{total}} statements',
        contagem: {
          prompt: 'From the prompt',
          decisao: 'From your decision',
          proposto: 'Proposed by the AI'
        },
        aceiteFalhou: 'Could not record the acceptance. Try again.',
        propostosTitulo: '{{count}} statements proposed by the AI',
        propostosDescricao:
          'Nobody said this — the AI inferred it from the prompt. Cut what does not make sense.',
        origem: {
          prompt: 'from your prompt',
          decisao: 'from your decision',
          proposto: 'proposed by the AI'
        },
        blocos: {
          identidade: 'Identity',
          'problema-usuarios-resultado': 'Problem, users and outcome',
          'escopo-e-metricas': 'Scope and metrics',
          jornadas: 'Journeys',
          'dominio-e-dados': 'Domain and data',
          integracoes: 'Integrations',
          'stack-e-restricoes': 'Stack and constraints',
          'nao-funcionais-e-testes': 'Non-functional and tests',
          'politica-git-provider-orcamento': 'Policy, provider and budget',
          'riscos-e-decisoes-abertas': 'Risks and open decisions'
        }
      },
      prd: {
        titulo: 'PRD, Landscape and Convention',
        abasRotulo: 'Structural package documents',
        abaRevisar: 'To review',
        abaRevisarVazia: 'Nothing to review',
        revisarTitulo: 'What needs your decision before accepting',
        revisarDescricao:
          'Gathered here so you do not have to look document by document. Contradictions block acceptance; proposed statements do not — but none of them came from you.',
        revisarVazio: 'Nothing to review',
        revisarVazioDescricao:
          'The AI inferred nothing on its own and nothing in the package contradicts itself. Read the documents and accept when you agree.',
        revisarPropostosTitulo: 'Statements proposed by the AI',
        descricao:
          'What the app derived from the accepted brief of {{nome}}. Every statement says what backs it; cut what does not fit before accepting.',
        carregando: 'Loading the documents…',
        vazio: 'No documents yet',
        vazioDescricao:
          'Confirm the research term (or leave it empty) and generate the PRD, Landscape and Convention.',
        termo: 'Market research term',
        termoAjuda:
          'The AI proposed this term from the brief. Adjust it before generating; the search only runs when you generate.',
        termoPlaceholder: 'e.g. planning tools for small teams',
        semTermo: 'Without a term, the Landscape stays pending and the PRD moves on.',
        gerar: 'Generate the documents',
        regerar: 'Generate again',
        documentoVazio: 'No statements in this revision.',
        cortar: 'Cut',
        cortarEsta: 'Cut the statement: {{texto}}',
        landscapeBloqueado: 'Landscape pending: the research did not run',
        propostosTitulo: '{{count}} statements proposed by the AI',
        propostosDescricao:
          'Nobody said this — the AI inferred it. Cut what does not make sense before accepting.',
        contradicoesTitulo: '{{count}} contradictions to resolve',
        contradicoesDescricao:
          'Two statements cannot hold at once. Decide and generate again; nothing was fixed on its own.',
        recomendacao: 'Recommendation: {{texto}}',
        chegadaTitulo_one: 'The AI proposed 1 adjustment',
        chegadaTitulo_other: 'The AI proposed {{count}} adjustments',
        chegadaDescricao:
          'The architecture was generated. The AI compared your prototypes with the PRD and noted what does not add up.',
        chegadaOQueE:
          'Nothing was changed in your attachments. The only action on an adjustment is discarding it from this revision — changing the design is your act, outside the app.',
        chegadaVer: 'See the adjustments',
        chegadaDepois: 'Later',
        aceitar: 'Accept the PRD',
        aceiteTitulo: 'PRD acceptance',
        aceiteDescricao:
          'Accepting freezes this revision of the three documents as the basis for the architecture. Generating again creates another revision and reopens this acceptance.',
        aceiteBloqueado: 'Resolve the contradictions above to accept.',
        aceiteFalhou: 'Could not record the acceptance. Try again.',
        origem: {
          brief: 'from the accepted brief',
          decisao: 'from your decision',
          evidencia: 'from a researched source',
          proposto: 'proposed by the AI'
        },
        documentos: {
          PRD: 'PRD',
          LANDSCAPE: 'Landscape',
          CONVENTION: 'Convention'
        },
        descricoes: {
          PRD: 'Problem, users, scope and success criteria — derived from the brief you accepted.',
          LANDSCAPE:
            'The landscape and the alternatives. Every statement about third parties cites its source.',
          CONVENTION:
            'The entities, states and vocabulary of this project — nothing imported from another.'
        },
        resultados: {
          gerado: 'Documents generated',
          'bloqueado-sem-rota': 'No generation route available',
          'saida-invalida': 'The model output was rejected',
          'projeto-inexistente': 'Project not found',
          'brief-nao-aceito': 'Accept the brief first',
          'sem-contexto': 'The project context could not be assembled',
          'falha-de-escrita': 'Could not write the documents'
        }
      },
      arquitetura: {
        titulo: 'Architecture, decisions, testing and review',
        abasRotulo: 'Architecture package documents',
        abaRevisar: 'To review',
        abaRevisarVazia: 'Nothing to review',
        revisarTitulo: 'What needs your decision before accepting',
        revisarDescricao:
          'Gathered here so you do not have to look document by document. Adjustments speak about your prototypes; proposed statements are AI inferences inside the documents.',
        revisarVazio: 'Nothing to review',
        revisarVazioDescricao:
          'The AI inferred nothing on its own and found no divergence between the prototypes and the PRD. Read the documents and accept when you agree.',
        revisarPropostosTitulo: 'Statements proposed by the AI',
        descricao:
          'What the app derived from the accepted PRD and the prototypes of {{nome}}. Every statement says what backs it; a flow is only promised with the screen that drew it.',
        carregando: 'Loading the documents…',
        vazio: 'No documents yet',
        vazioDescricao:
          'With the attachments complete and the PRD accepted, generate the architecture, decisions, testing and review.',
        gerar: 'Generate the documents',
        regerar: 'Generate again',
        documentoVazio: 'No statements in this revision.',
        cortar: 'Cut',
        cortarEsta: 'Cut the statement: {{texto}}',
        descartar: 'Dismiss',
        descartarEste: 'Dismiss the adjustment: {{texto}}',
        propostosTitulo: '{{count}} statements proposed by AI',
        propostosDescricao:
          'Nobody said this — the AI inferred it. Cut what does not make sense before accepting.',
        ajustesTitulo: '{{count}} adjustments proposed by AI',
        ajustesDescricao:
          'The AI read your prototypes against the PRD. Nothing was changed in the attachments: changing the design is your act, and dismissing only removes the adjustment from this revision.',
        recomendacao: 'Recommendation: {{texto}}',
        aceitar: 'Accept the package',
        aceiteTitulo: 'Package acceptance',
        aceiteDescricao:
          'Accepting freezes this revision — PRD, attachments, architecture, testing and review — as the basis for the roadmap. Generating again later creates another revision and reopens this acceptance.',
        aceiteFalhou: 'The acceptance could not be recorded. Try again.',
        origem: {
          prd: 'from the accepted PRD',
          prototipo: 'from the prototype you drew',
          decisao: 'from your decision',
          proposto: 'proposed by AI'
        },
        ajustes: {
          telaSemRequisito: 'screen without requirement',
          requisitoSemTela: 'requirement without screen',
          estadoAusente: 'missing state'
        },
        documentos: {
          ARCHITECTURE: 'Architecture',
          DECISIONS: 'Decisions',
          TESTING: 'Testing',
          REVIEW: 'Review'
        },
        descricoes: {
          ARCHITECTURE:
            'Modules, data, boundaries and resilience. Flows cite the prototype screen that drew them.',
          DECISIONS:
            'The structural decisions as ADRs. The ones proposed by AI appear as proposals, not as decisions taken.',
          TESTING:
            'The evidence strategy for this project, derived from the requirements and the prototyped journeys.',
          REVIEW: 'How to review the code of this project — nothing imported from another.'
        },
        resultados: {
          gerada: 'Documents generated',
          'projeto-inexistente': 'Project not found',
          'anexos-pendentes': 'Design attachments are missing',
          'prd-ausente': 'Generate the PRD first',
          'prototipos-invalidos': 'The prototypes have problems to solve',
          'bloqueado-sem-rota': 'No generation route available',
          'saida-invalida': 'The model output was refused',
          'sem-contexto': 'The project context could not be assembled',
          'falha-de-escrita': 'The documents could not be written'
        }
      },
      refinamento: {
        titulo: 'Refinement',
        descricao: 'The AI asks what the prompt for {{nome}} left out. One decision at a time.',
        carregando: 'Loading refinement…',
        gerar: 'Generate the questions',
        gerarBrief: 'Generate the brief',
        briefFalhou: 'Could not generate the brief. Try again.',
        gerarMais: 'Look for what is still missing',
        responder: 'Answer the next one',
        restantes: '{{count}} decisions pending.',
        aSeguir: 'Up next',
        concluido: 'All questions have been answered.',
        semRota: 'Generation is unavailable',
        naoGerou: 'The questions were not generated',
        falha: 'Could not generate the questions. Try again.'
      },
      jornada: {
        titulo: 'Planning journey',
        pedeAceite: 'Needs your acceptance',
        descricao: 'One step at a time. Approvals are yours; the app prepares the rest.',
        carregando: 'Loading the journey…',
        regrediu: 'The journey moved back a step',
        etapas: {
          prompt: 'Initial prompt',
          refinamento: 'Refinement',
          'brief-aceito': 'Brief approval',
          prd: 'PRD',
          'prd-aceito': 'PRD approval',
          design: 'Design attachments',
          arquitetura: 'Architecture',
          'pacote-aceito': 'Package approval',
          roadmap: 'Roadmap',
          'mvp-aceito': 'MVP approval',
          'spec-aceita': 'Spec approval',
          construcao: 'Build'
        }
      },
      roadmap: {
        titulo: 'Roadmap and approvals',
        abasRotulo: 'Roadmap stages',
        abaMvps: 'MVPs',
        abaSpec: 'Slice SPEC',
        abaGates: 'Approvals',
        specAusente: 'No SPEC yet',
        specAusenteDescricao:
          'The first slice SPEC is born when you choose the MVP that enters the queue. Choose one in the MVPs tab.',
        descricao:
          'The MVPs for {{nome}}, proposed from the accepted PRD and the approved architecture. Generating proposes; choosing and approving are yours.',
        carregando: 'Loading the roadmap…',
        gerar: 'Generate roadmap',
        regerar: 'Generate again',
        vazio: 'No roadmap generated yet',
        vazioDescricao:
          'MVPs come from the accepted PRD and the approved architecture. Generating proposes the map; which MVP is queued is your call.',
        mvps: '{{count}} proposed MVPs',
        resultado: 'Outcome: {{texto}}',
        naFila: 'Queued',
        escolher: 'Choose and generate the SPEC',
        escolherEste: 'Choose "{{titulo}}" and generate the SPEC',
        inelegivel: 'Depends on an MVP that has not been delivered yet.',
        origem: {
          prd: 'PRD',
          arquitetura: 'Architecture',
          proposto: 'Proposed by AI'
        },
        resultados: {
          gerado: 'Roadmap generated',
          'projeto-inexistente': 'Project not found',
          'pacote-ausente': 'The project package is missing',
          'bloqueado-sem-rota': 'No authorized route',
          'sem-contexto': 'The context could not be assembled',
          'saida-invalida': 'The proposed roadmap failed validation',
          'mvp-nao-escolhido': 'No MVP queued yet',
          'mvp-inelegivel': 'This MVP cannot be queued yet',
          'falha-de-escrita': 'The documents could not be written'
        },
        specTitulo: 'SPEC — {{titulo}}',
        specDescricao:
          'The first slice of {{mvp}}. It starts as a draft: accepting is yours, and it depends on the questions below.',
        spec: {
          objetivo: 'Objective',
          fluxo: 'Flow',
          regras: 'Rules',
          criterios: 'Acceptance criteria',
          testes: 'Tests and evidence'
        },
        perguntasTitulo: '{{count}} open decisions',
        perguntasDescricao:
          'The SPEC cannot be accepted while a question is unanswered. These are your decisions, not the model’s.',
        perguntasRespondidas: 'Every decision has been made',
        perguntasRespondidasDescricao: 'The SPEC can be accepted at the gate below.',
        recomendada: 'Recommended',
        escolhida: 'Chosen',
        responder: 'Choose',
        responderCom: 'Choose "{{rotulo}}"',
        justificativa: 'Why the recommendation: {{texto}}',
        estado: {
          proposto: 'Proposed',
          'na-fila': 'Queued',
          concluido: 'Done'
        },
        dependeDe: 'Depends on: {{lista}}.',
        detalhada: 'Detailed SPEC',
        gates: 'Approval center',
        gate: {
          PROJECT_PACKAGE: 'The project package: PRD, architecture and the design attachments.',
          MVP_ENTRY: 'The revision of the MVP entering the execution queue.',
          SLICE_ENTRY: 'The revision of the SPEC to execute.'
        },
        aprovado: 'Approved',
        pendente: 'Awaiting approval',
        aprovar: 'Approve',
        semRevisoes: 'Nothing to approve in this gate yet.',
        aprovadoPor: 'Approved by {{identidade}}.',
        hashCompleto: 'Full hash: {{hash}}'
      },
      anexos: {
        titulo: 'Design attachments',
        descricao:
          'The design system and prototypes for {{nome}}. Architecture is only generated once they arrive — attaching is your act, and it is what counts.',
        carregando: 'Loading attachments…',
        tipo: {
          'design-system': 'DESIGN-SYSTEM.md',
          prototipo: 'HTML prototype',
          asset: 'Asset'
        },
        anexado: 'Attached',
        pendente: 'Pending',
        anexar: 'Attach',
        substituir: 'Replace',
        remover: 'Remove',
        removerAnexo: 'Remove {{caminho}}',
        assets: 'Assets referenced by the prototypes',
        adicionarAsset: 'Add asset',
        semAssets: 'No assets attached. Attach the ones your prototypes reference.',
        gateAberto: 'Attachments are complete. Architecture can be generated.',
        gateFechado: 'Still to attach: {{lista}}.',
        validar: 'Validate prototypes',
        pendencias: 'Missing: {{lista}}.',
        validacaoLimpa: 'The prototypes raised no issues.',
        impede: 'Blocks architecture',
        recomendacao: 'Recommendation: {{texto}}',
        revisao: 'Latest architecture of {{count}}',
        semCommit: 'No commit',
        commitCompleto: 'Full commit: {{hash}}',
        afirmacoes: '{{count}} statements',
        hashCompleto: 'Full hash: {{hash}}'
      },
      pacote: {
        titulo: 'Structural package',
        descricao:
          'PRD, Landscape and Convention for {{nome}}, composed from planning decisions and researched sources.',
        consulta: 'Market research',
        consultaPlaceholder: 'e.g. alternatives to local task managers',
        consultaAjuda:
          'The term used to find competitors and alternatives. Left blank, the Landscape ships without a scenario and says so.',
        gerar: 'Generate package',
        carregando: 'Loading revisions…',
        vazio: 'No revision generated yet.',
        pendencias: 'Missing: {{lista}}.',
        revisao: 'Latest revision of {{count}}',
        semCommit: 'No commit',
        commitCompleto: 'Full commit: {{hash}}',
        afirmacoes: '{{count}} statements',
        hashCompleto: 'Full hash: {{hash}}',
        bloqueio: {
          causa: 'Cause',
          evidencia: 'Evidence',
          tentativas: 'Attempts',
          porQueNaoSeguir: 'Why not proceed',
          retomada: 'How to resume'
        }
      },
      wizard: {
        titulo: 'Planning for {{nome}}',
        descricao:
          'One decision at a time. The recommendation comes first, but the choice is yours — and every option states its cost.',
        carregando: 'Loading planning…',
        indisponivel: 'Could not open planning for this project.',
        fechar: 'Close',
        restantes: '{{count}} remaining',
        recomendada: 'Recommended',
        porque: 'Why: {{justificativa}}',
        textoLivre: 'Another answer',
        textoLivrePlaceholder: 'Describe your choice if no option fits',
        decidePorMim: 'Decide for me',
        confirmar: 'Confirm',
        contradicaoTitulo: 'This answer changes decisions already made',
        contradicaoItem: '{{pergunta}} — decided before: {{anterior}}',
        contradicaoManter: 'Keep as is',
        contradicaoSubstituir: 'Replace',
        resumo: 'Decisions',
        jaDecidido: 'Already decided',
        resumoItem: '{{pergunta}}: {{escolha}}',
        autorPi: 'You',
        autorAgente: 'Delegated'
      },
      contexto: {
        titulo: 'Context, skills and budget',
        descricao:
          'Build the context before generating. The manifest records which revisions were sent, under which cap and through which route.',
        tarefa: 'Task or SPEC',
        tarefaPlaceholder: 'e.g. SPEC-Planejamento-02',
        tarefaAjuda: 'What this generation must solve. Goes into the manifest.',
        arquivos: 'Context files',
        arquivosPlaceholder: 'docs/PRD.md',
        arquivosAjuda:
          'Paths relative to the project, one per line. A wildcard (*) counts as broad reading and requires a reason.',
        excecao: 'Reason for broad reading',
        excecaoPlaceholder: 'e.g. regression with no known location',
        excecaoAjuda: 'Recorded in the manifest. Broad reading without a reason is refused.',
        motivoPadrao: 'selected on screen',
        montar: 'Build context',
        carregando: 'Loading context…',
        vazio: 'No context built yet',
        vazioDescricao: 'Select the task files and build the context before generating.',
        manifesto: 'Latest manifest',
        hashDoPack: 'pack {{hash}}',
        hashCompleto: 'Full hash: {{hash}}',
        colunaArquivo: 'File',
        colunaOrigem: 'Source',
        colunaHash: 'Revision',
        colunaBytes: 'Bytes',
        legendaTabela: 'Files sent in the context for {{tarefa}}',
        origem: {
          explicito: 'Explicit',
          'busca-estrutural': 'Search',
          'leitura-ampla': 'Broad',
          'decisao-aprovada': 'Decision',
          'evidencia-externa': 'Evidence'
        },
        tokensDaEtapa: 'Tokens for this step',
        tokensDe: '{{usados}} of {{teto}}',
        rotaSemCusto: 'Route {{rota}}: records usage (calls, tokens and time), no per-call cost.',
        rotaComCusto: 'Route {{rota}}: {{valor}} estimated for this step.',
        expansao: 'Cap expanded: {{motivo}}',
        excecaoRegistrada: 'Broad-reading exception',
        tetoDaExcecao: 'Authorized cap: {{bytes}} bytes',
        falhasAbertas: 'Open failures',
        ocorrencias: '{{total}} occurrence(s)',
        resolver: 'Mark resolved',
        resolverDe: 'Mark resolved: {{resumo}}',
        capacidades: 'How the flow applies each discipline',
        meioSkill: 'Skill',
        meioDireto: 'Direct',
        erroInesperado: 'Could not build the context. Try again.'
      },
      settings: {
        titulo: 'Settings',
        abaGeral: 'General',
        abaPermissoes: 'Permissions',
        abaIa: 'AI',
        abaRoteamento: 'Models',
        abaConectores: 'Connectors',
        abaVoz: 'Voice',
        vozDescricao:
          'Transcription runs on this machine. No audio leaves it and nothing is written to disk.',
        vozModelo: 'Transcription model',
        vozModeloDescricao:
          'Larger models are more accurate and slower. A change applies to your next utterance; the new model downloads on first use.',
        vozIdioma: 'Spoken language',
        vozIdiomaDescricao: 'The language you speak, not the interface language.',
        vozHotkey: 'Global shortcut',
        vozHotkeyDescricao:
          'Works with the window minimised. One press opens the microphone, another ends it and transcribes.',
        vozTimeout: 'Stop automatically after',
        vozTimeoutDescricao:
          'Guards against a forgotten shortcut: after this long, recording ends and transcribes whatever it captured.',
        vozSegundos: '{{valor}} seconds',
        vozMinutos: '{{valor}} minutes',
        idioma: 'Language',
        idiomaDescricao: 'Applies immediately, no restart needed.',
        tema: 'Theme',
        temaDescricao: 'The default follows your system preference.',
        temaClaro: 'Light',
        temaEscuro: 'Dark',
        temaSistema: 'System',
        acento: 'Accent',
        acentoDescricao: 'The highlight color of each space. The same choice as the entry screen.',
        salvo: 'Preferences saved.',
        diretorios: 'Allowed directories',
        diretoriosDescricao:
          'The folders the app can read, write and use as a working directory in the terminal. Nothing outside this list is reachable.',
        diretoriosAdicionar: 'Allow a folder…',
        diretoriosRemover: 'Remove',
        diretoriosRemoverDe: 'Remove {{caminho}}',
        diretoriosFixo: 'Fixed',
        diretoriosFixoMotivo: 'The app folder is allowed by design and cannot be removed.',
        diretoriosCarregando: 'Loading allowed directories…',
        diretoriosVazio: 'Only the app folder is allowed',
        diretoriosVazioDescricao:
          'Allow a folder so the app can work in it — without one, the terminal refuses any working directory outside the app folder.',
        diretoriosErro: 'Could not read the allowed directories',
        diretoriosErroDescricao:
          'Close and reopen settings. Until the list loads, allowing or removing folders is not safe.',
        diretoriosErroAdicionar: 'Could not allow that folder.',
        diretoriosErroRemover: 'Could not remove that folder.'
      },
      auth: {
        titulo: 'JARVIS OS',
        subtitulo: 'Sign in with your Google account to get started.',
        entrar: 'Sign in with Google',
        aguardando: 'Waiting…',
        aguardandoNavegador: 'Waiting for the browser…',
        entrandoDescricao:
          'We opened a tab in your browser to finish signing in. Come back here when you are done.',
        sair: 'Sign out',
        sessaoExpirada: 'Session expired',
        falha: 'Could not sign in',
        tentarNovamente: 'Try again',
        conta: 'Connected account',
        copyright: '© 2026 RRB Trading — All rights reserved',
        privacidade: 'Privacy Policy',
        termos: 'Terms of Use',
        // Não traduzido: é o nome próprio da cidade e do país, não uma string de UI.
        local: 'GOIÂNIA · BRAZIL',
        usuario: 'username',
        senha: 'password',
        acessar: 'Sign in',
        ouCadastre: 'or sign up with',
        google: 'Google',
        github: 'GitHub',
        entrarCom: 'Sign in with',
        tentarNovamenteCom: 'Try again with',
        senhaEmBreve: 'Username and password sign-in and GitHub are not available yet.'
      },
      erro: {
        espaco: 'Could not load the workspace.',
        trocaEspaco: 'Could not switch the workspace.',
        preferencias: 'Could not save the preferences.'
      },
      carregando: 'Loading…'
    }
  }
} as const
