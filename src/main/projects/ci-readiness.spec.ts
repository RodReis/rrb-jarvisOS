import { describe, expect, it } from 'vitest'
import { perfilNodeEmWindows } from '@shared/domain/ci-profile-perfis'
import { gerarWorkflowDoPerfil } from '@shared/domain/ci-profile-workflow'
import { validarWorkflowGerado } from './ci-readiness'

describe('preflight do workflow de CI', () => {
  it('aceita o YAML real gerado pelo perfil e pelo context agregado', () => {
    expect(validarWorkflowGerado(gerarWorkflowDoPerfil(perfilNodeEmWindows('p-1')))).toEqual([])
  })

  it('recusa YAML malformado', () => {
    expect(validarWorkflowGerado('jobs: [')).toEqual(['O workflow gerado não é YAML válido.'])
  })

  it('recusa gatilho push duplicado ou ausência de context agregado', () => {
    expect(validarWorkflowGerado('on:\n  push: {}\njobs:\n  validacao: {}')).toContain(
      'O workflow deve executar em pull_request, sem gatilho push.'
    )
    expect(validarWorkflowGerado('on:\n  pull_request: {}\njobs:\n  teste: {}')).toContain(
      'O workflow não declara o contexto agregado validacao.'
    )
  })
})
