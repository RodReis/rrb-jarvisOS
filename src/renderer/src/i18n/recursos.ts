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
        inicio: 'Início',
        notas: 'Notas',
        agenda: 'Agenda',
        operacoes: 'Operações',
        projetos: 'Projetos',
        terminal: 'Terminal',
        agentes: 'Agentes',
        settings: 'Configurações'
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
        gerar: 'Gerar o brief',
        escrevaAlgo: 'Escreva o prompt para continuar.',
        semRota: 'A geração está indisponível',
        naoGerou: 'O brief não foi gerado',
        falha: 'Não foi possível gerar o brief. Tente de novo.'
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
        // O aceite do brief (SPEC-Jornada-02, critério 5). O rótulo diz o que o clique
        // faz — congela o documento e libera a próxima etapa —, não um "OK" genérico.
        aceitar: 'Aceitar o brief',
        aceiteTitulo: 'Aceite do brief',
        aceiteDescricao:
          'Aceitar congela este brief como base do PRD. Corte o que não serve antes: depois do aceite, mudar exige refazer a etapa.',
        aceiteBloqueado: 'Resolva as pendências acima para aceitar.',
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
      refinamento: {
        titulo: 'Refinamento',
        // Diz o que o refinamento faz e o que ele cobra: decisões, não formulário.
        descricao: 'A IA pergunta o que o prompt de {{nome}} não respondeu. Uma decisão por vez.',
        carregando: 'Carregando o refinamento…',
        gerar: 'Gerar as perguntas',
        gerarMais: 'Procurar o que ainda falta',
        responder: 'Responder a próxima',
        // O número diz ao PI se ele começa agora ou depois. Um botão sem essa conta pediria
        // um compromisso de duração desconhecida.
        restantes: '{{count}} decisões pendentes.',
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
        descricao:
          'Os MVPs de {{nome}}, compostos das decisões e das jornadas prototipadas. Gerar propõe; aprovar é seu.',
        carregando: 'Carregando o roadmap…',
        gerar: 'Gerar roadmap',
        regerar: 'Regerar roadmap',
        mvps: '{{count}} MVPs propostos',
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
        gerarArquitetura: 'Gerar arquitetura',
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
        abaRoteamento: 'Roteamento',
        abaConectores: 'Conectores',
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
        inicio: 'Home',
        notas: 'Notes',
        agenda: 'Calendar',
        operacoes: 'Operations',
        projetos: 'Projects',
        terminal: 'Terminal',
        agentes: 'Agents',
        settings: 'Settings'
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
        gerar: 'Generate the brief',
        escrevaAlgo: 'Write the prompt to continue.',
        semRota: 'Generation is unavailable',
        naoGerou: 'The brief was not generated',
        falha: 'Could not generate the brief. Try again.'
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
        aceitar: 'Accept the brief',
        aceiteTitulo: 'Brief acceptance',
        aceiteDescricao:
          'Accepting freezes this brief as the basis for the PRD. Cut what does not belong first: after acceptance, changing it means redoing the stage.',
        aceiteBloqueado: 'Resolve the pending items above to accept.',
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
      refinamento: {
        titulo: 'Refinement',
        descricao: 'The AI asks what the prompt for {{nome}} left out. One decision at a time.',
        carregando: 'Loading refinement…',
        gerar: 'Generate the questions',
        gerarMais: 'Look for what is still missing',
        responder: 'Answer the next one',
        restantes: '{{count}} decisions pending.',
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
        descricao:
          'The MVPs for {{nome}}, composed from decisions and prototyped journeys. Generating proposes; approving is yours.',
        carregando: 'Loading the roadmap…',
        gerar: 'Generate roadmap',
        regerar: 'Regenerate roadmap',
        mvps: '{{count}} proposed MVPs',
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
        gerarArquitetura: 'Generate architecture',
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
        abaRoteamento: 'Routing',
        abaConectores: 'Connectors',
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
