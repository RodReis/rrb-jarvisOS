/**
 * Os módulos entregues, declarados ao menu (SPEC-Shell-01, mapa item ↔ módulo).
 *
 * Esta lista é curta de propósito: só entra o que **abre tela de verdade**. Os itens que o
 * protótipo previu e ainda não têm módulo — `HUD`, `Metas`, `Studio`, `Kanban`, `Analytics`… —
 * não aparecem aqui, porque item sem módulo não existe no menu (regra 2). Eles vivem no mapa da
 * spec como reserva de lugar, e os rótulos deles já estão no i18n para a fatia futura só
 * precisar acrescentar uma linha aqui.
 *
 * ## Como isto cresce
 *
 * A fatia que entrega a tela acrescenta o registro **dela** e o item aparece sozinho. A M9-F06
 * acende o Mission Control; a M17-F05 acende o Command Center e, com ele, a rota inicial do
 * JARVIS passa a ser a tela que dá identidade ao produto — sem tocar no AppShell nem aqui, além
 * da linha do próprio módulo.
 *
 * ## O grupo HARNESSES
 *
 * Não está aqui porque nenhum executor tem página (regra 3): o item só existe quando existe a
 * página que ele abre, e até lá o grupo inteiro fica oculto pela regra 2. Quando houver, ele
 * nasce do registro de executores, não de linha fixa neste arquivo.
 */

import type { ModuloRegistrado } from './registro-de-modulos'

/**
 * `disponivel: () => true` para todos os de hoje: os quatro são telas entregues e sempre
 * presentes. A função existe para os que virão — HARNESSES é o caso concreto —, e usá-la já
 * agora mantém um contrato só, em vez de dois formatos de registro convivendo.
 */
export const MODULOS_DO_APP: readonly ModuloRegistrado[] = [
  {
    id: 'projects',
    subModulo: 'command',
    grupo: 'NEGOCIOS',
    ordem: 1,
    rota: 'projects',
    disponivel: () => true
  },
  {
    /*
     * `Terminal` é item de SISTEMA, não sexta aba do Settings (regra 5, decisão do PI): é
     * ferramenta de operação, e enterrá-lo numa aba o esconderia de quem o usa para trabalhar.
     */
    id: 'terminal',
    subModulo: 'command',
    grupo: 'SISTEMA',
    ordem: 1,
    rota: 'terminal',
    disponivel: () => true
  },
  {
    /*
     * `Connectors`, `Providers` e `Permissões` **não** são itens: são abas daqui (regra 4). Um
     * caminho por tela — dois itens levando à mesma aba fariam o usuário procurar em dois
     * lugares o que mora num só.
     */
    id: 'settings',
    subModulo: 'command',
    grupo: 'SISTEMA',
    ordem: 2,
    rota: 'settings',
    disponivel: () => true
  },
  {
    /*
     * A fila de aprovação é **governança** (Operator Central do protótipo), não "Operações" —
     * que ali é Kanban/Workflows. Daí o `operacoes` → `operator` desta fatia.
     */
    id: 'operator',
    subModulo: 'agents',
    grupo: 'GOVERNANCE',
    ordem: 1,
    rota: 'operator',
    disponivel: () => true
  }
]
