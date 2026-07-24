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
      navegacao: {
        principal: 'Navegação principal',
        de: 'Navegação de {{espaco}}',
        inicio: 'Início',
        notas: 'Notas',
        agenda: 'Agenda',
        operacoes: 'Operações',
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
      settings: {
        titulo: 'Configurações',
        idioma: 'Idioma',
        idiomaDescricao: 'Aplica imediatamente, sem reiniciar.',
        tema: 'Tema',
        temaDescricao: 'O padrão acompanha a preferência do sistema.',
        temaClaro: 'Claro',
        temaEscuro: 'Escuro',
        temaSistema: 'Sistema',
        salvo: 'Preferências salvas.'
      },
      auth: {
        titulo: 'JARVIS OS',
        subtitulo: 'Entre com sua conta Google para começar.',
        entrar: 'Entrar com o Google',
        entrando: 'Aguardando o navegador…',
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
        local: 'GOIÂNIA · BRASIL'
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
      navegacao: {
        principal: 'Main navigation',
        de: '{{espaco}} navigation',
        inicio: 'Home',
        notas: 'Notes',
        agenda: 'Calendar',
        operacoes: 'Operations',
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
      settings: {
        titulo: 'Settings',
        idioma: 'Language',
        idiomaDescricao: 'Applies immediately, no restart needed.',
        tema: 'Theme',
        temaDescricao: 'The default follows your system preference.',
        temaClaro: 'Light',
        temaEscuro: 'Dark',
        temaSistema: 'System',
        salvo: 'Preferences saved.'
      },
      auth: {
        titulo: 'JARVIS OS',
        subtitulo: 'Sign in with your Google account to get started.',
        entrar: 'Sign in with Google',
        entrando: 'Waiting for the browser…',
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
        local: 'GOIÂNIA · BRAZIL'
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
