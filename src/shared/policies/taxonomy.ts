/**
 * Taxonomia de risco — **o seed** (SPEC-Execucao-02, critério 4).
 *
 * Isto é **dado**, não lógica: a lista abaixo espelha *"Ações Possíveis e Política de
 * Aprovação"* dos requisitos (§ Baixo/Médio/Alto/Bloqueado). Mudar o risco de uma ação é
 * editar uma linha aqui — nunca o `evaluate`. É a regra "sem hardcode" do `CLAUDE.md`: o
 * núcleo consulta este mapa, não conhece nenhuma ação por nome.
 *
 * Cada `id` é a chave estável que o runtime passa a `evaluate`. Um id ausente daqui é uma
 * ação **desconhecida**, e o engine a classifica `bloqueado` (fail-closed na classificação).
 *
 * O `outcome` por tier segue a política dos requisitos:
 *   baixo → allow · médio/alto → requires-approval · bloqueado → block.
 * Nesta fatia nada disto barra (modo report) — o outcome é registrado, não aplicado.
 */

import type { ActionId, RiskTier } from './contracts'

/** Uma entrada do seed: a ação, seu tier e uma descrição curta em pt-BR (para a UI/audit). */
export interface TaxonomyEntry {
  readonly id: ActionId
  readonly tier: Exclude<RiskTier, 'bloqueado'>
  readonly descricao: string
}

/**
 * Baixo risco (requisitos § "Baixo risco, pode executar sem aprovação se o usuário
 * configurar assim"). A única ação de runtime que o MVP-002 exercita de verdade é
 * `workflow.run-simulated` (Fatia 05) — o resto é semeado para quando terminal/providers
 * chegarem, para o mapa já nascer completo em vez de crescer por hardcode disperso.
 */
const BAIXO: readonly TaxonomyEntry[] = [
  { id: 'kanban.create-task', tier: 'baixo', descricao: 'Criar tarefa no Kanban' },
  { id: 'kanban.move-task', tier: 'baixo', descricao: 'Mover tarefa entre colunas' },
  { id: 'note.create', tier: 'baixo', descricao: 'Criar anotação/memória não sensível' },
  { id: 'service.check-status', tier: 'baixo', descricao: 'Consultar status de serviço' },
  { id: 'fs.list-allowed', tier: 'baixo', descricao: 'Listar arquivos em diretórios permitidos' },
  { id: 'workflow.run-simulated', tier: 'baixo', descricao: 'Executar workflow simulado' },
  { id: 'text.draft', tier: 'baixo', descricao: 'Gerar rascunho de texto sem publicar' },
  { id: 'analysis.read-only', tier: 'baixo', descricao: 'Rodar análise local somente leitura' },
  {
    id: 'settings.change-preference',
    tier: 'baixo',
    descricao: 'Alterar preferência visual/idioma/som/autosave'
  }
]

/** Médio risco (requisitos § "Médio risco, exige aprovação por padrão"). */
const MEDIO: readonly TaxonomyEntry[] = [
  { id: 'automation.upsert', tier: 'medio', descricao: 'Criar ou alterar automação' },
  { id: 'workflow.toggle', tier: 'medio', descricao: 'Ativar/desativar workflow' },
  { id: 'skill.install-update', tier: 'medio', descricao: 'Instalar ou atualizar skill' },
  { id: 'provider.connect', tier: 'medio', descricao: 'Conectar novo provider' },
  {
    id: 'fs.read-outside-allowed',
    tier: 'medio',
    descricao: 'Ler arquivo fora de diretório permitido'
  },
  {
    id: 'terminal.run-allowlisted',
    tier: 'medio',
    descricao: 'Executar comando de terminal allowlisted'
  },
  { id: 'api.external-call', tier: 'medio', descricao: 'Fazer chamada para API externa' },
  { id: 'fs.write-allowed', tier: 'medio', descricao: 'Gravar arquivo em diretório permitido' },
  { id: 'git.branch-commit-pr', tier: 'medio', descricao: 'Criar branch, commit ou PR' },
  {
    id: 'message.internal-draft',
    tier: 'medio',
    descricao: 'Enviar mensagem a canal interno em rascunho/aprovação'
  },
  { id: 'memory.sync-supabase', tier: 'medio', descricao: 'Sincronizar memória local com Supabase' }
]

/** Alto risco (requisitos § "Alto risco, sempre exige aprovação explícita"). */
const ALTO: readonly TaxonomyEntry[] = [
  {
    id: 'terminal.run-destructive',
    tier: 'alto',
    descricao: 'Executar comando destrutivo no terminal'
  },
  {
    id: 'fs.delete-move-overwrite',
    tier: 'alto',
    descricao: 'Apagar, mover ou sobrescrever arquivos'
  },
  {
    id: 'secrets.change',
    tier: 'alto',
    descricao: 'Alterar credenciais, tokens, .env, vault ou secrets'
  },
  { id: 'content.publish-external', tier: 'alto', descricao: 'Publicar conteúdo em canal externo' },
  {
    id: 'message.send-external',
    tier: 'alto',
    descricao: 'Enviar e-mail/WhatsApp/Telegram/Slack/Discord a terceiros'
  },
  { id: 'deploy.production', tier: 'alto', descricao: 'Fazer deploy em produção' },
  { id: 'db.alter-remote', tier: 'alto', descricao: 'Alterar banco de dados remoto' },
  {
    id: 'permissions.change',
    tier: 'alto',
    descricao: 'Alterar permissões de usuário/agente/squad/workspace'
  },
  { id: 'autonomy.enable-remote', tier: 'alto', descricao: 'Ativar modo autônomo remoto' },
  {
    id: 'dependency.install',
    tier: 'alto',
    descricao: 'Instalar dependência, binário, extensão ou MCP server'
  },
  { id: 'code.run-downloaded', tier: 'alto', descricao: 'Executar código baixado da internet' },
  {
    id: 'data.access-sensitive',
    tier: 'alto',
    descricao: 'Acessar dados de saúde, finanças ou documentos pessoais'
  },
  {
    id: 'data.export-sensitive',
    tier: 'alto',
    descricao: 'Exportar memória, logs, relatórios financeiros ou dados pessoais'
  },
  { id: 'budget.overspend', tier: 'alto', descricao: 'Gastar acima do orçamento configurado' }
]

/**
 * "Bloqueado no MVP" (requisitos § Bloqueado) **não** entra no seed como tier `bloqueado`
 * mapeável: a intenção é que essas ações **nem existam** como id reconhecido no MVP. Ação
 * assim chega ao engine como desconhecida e cai em `bloqueado` pela via fail-closed — que é
 * exatamente a postura desejada. Semear um id para elas daria a impressão de que são ações
 * previstas, só que barradas; elas não são previstas.
 */

/** O seed inteiro, indexado por id. Congelado: seed é dado de leitura, não estado mutável. */
export const RISK_TAXONOMY: ReadonlyMap<ActionId, TaxonomyEntry> = new Map(
  [...BAIXO, ...MEDIO, ...ALTO].map((entrada) => [entrada.id, entrada])
)
