import { AprovacoesPendentes } from '../app/AprovacoesPendentes'
import { Microfone } from '../app/Microfone'
import { ProjetosLocais } from '../app/ProjetosLocais'
import { Settings } from '../app/Settings'
import { TerminalControlado } from '../app/TerminalControlado'
import { MODULOS_DO_APP } from './modulos'
import type { ModuloRegistrado } from './registro-de-modulos'

const TELAS: Readonly<Record<string, NonNullable<ModuloRegistrado['renderizar']>>> = {
  projects: ({ workspace }) => <ProjetosLocais workspace={workspace} />,
  terminal: ({ workspace }) => <TerminalControlado workspace={workspace} />,
  settings: ({ preferencias, erroPreferencias, salvar, uiTheme, workspace, nomeDoEspaco }) => (
    <Settings
      preferencias={preferencias}
      erro={erroPreferencias}
      onSalvar={(mudanca) => void salvar(mudanca)}
      uiTheme={uiTheme}
      workspace={workspace}
      nomeDoEspaco={nomeDoEspaco}
    />
  ),
  voz: ({ workspace, preferencias, salvar }) => (
    <Microfone
      workspace={workspace}
      vozDaFala={preferencias.vozDaFala}
      entradaId={preferencias.vozEntradaId}
      entradaRotulo={preferencias.vozEntradaRotulo}
      saidaId={preferencias.vozSaidaId}
      onSalvarDispositivo={salvar}
    />
  ),
  operator: ({ workspace }) => <AprovacoesPendentes workspace={workspace} />
}

export const MODULOS_RENDERIZAVEIS: readonly ModuloRegistrado[] = MODULOS_DO_APP.map((modulo) => ({
  ...modulo,
  renderizar: TELAS[modulo.id]
}))
