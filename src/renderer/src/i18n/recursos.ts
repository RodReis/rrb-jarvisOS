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
        permitirGitAviso: 'Ação de alto risco: registra o comando na lista permitida deste espaço.'
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
        permitirGitAviso: 'High-risk action: records the command in this space allowed list.'
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
