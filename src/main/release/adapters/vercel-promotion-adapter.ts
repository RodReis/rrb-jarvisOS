import { PromotionProviderError, type PromotionFrontendPort } from '../promotion-ports'
import type { ReleaseEnvironment } from '@shared/domain/release'
import type { CommandRunner } from './command-runner'
import { exigirSucesso, falhaDeCli, lerJson } from './preview-cli-errors'

/**
 * Frontend da promoção na Vercel (SPEC-Release-04, decisão 2). Transporte declarado: CLI `vercel`.
 * Há UM deployment imutável por release (sem `--prod`, marcado com `jarvisRelease`/`jarvisSha`) e
 * ele serve Staging e Produção sem rebuild: a URL do backend NÃO entra no build — o frontend a
 * resolve em runtime pelo hostname. Staging é um alias (`vercel alias set`); Produção é
 * `vercel promote` do mesmo deployment.
 *
 * O token (`VERCEL_TOKEN`) vai só no ambiente do processo filho e é redigido da saída. O
 * diretório de trabalho é o projeto Vercel já vinculado (`vercel link`, uma vez pelo operador).
 */

export interface VercelPromotionConfig {
  readonly workdir: string
  readonly token: string
  readonly scope?: string
  /** Alias de Staging (`staging.exemplo.app` ou `https://staging.exemplo.app`). */
  readonly stagingDomain: string
  /** Domínio de Produção do projeto; é por ele que se lê qual deployment serve Produção. */
  readonly productionDomain: string
}

const BINARIO = 'vercel'
const TIMEOUT_MS = 15 * 60_000
const TIMEOUT_CURTO_MS = 5 * 60_000
/** A CLI espera a promoção até este prazo; o do processo é maior para ela mesma reportar. */
const PROMOCAO_CLI = '5m'
const TIMEOUT_PROMOCAO_MS = 8 * 60_000
const ID_DE_DEPLOYMENT = /^dpl_[A-Za-z0-9]{6,64}$/
const ID_DE_RELEASE = /^[A-Za-z0-9-]{8,64}$/
const SHA_VALIDO = /^[a-f0-9]{7,64}$/i
/** Só hostname (sem porta, caminho ou credencial): o valor vira argumento de `alias set`/`inspect`. */
const DOMINIO =
  /^(?:https:\/\/)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)$/i

interface DeploymentBruto {
  readonly meta?: unknown
  readonly uid?: unknown
  readonly id?: unknown
  readonly state?: unknown
  readonly readyState?: unknown
  readonly deployment?: unknown
}

function hostDe(valor: string, campo: string): string {
  const achado = DOMINIO.exec(valor)
  if (!achado) throw new TypeError(`O ${campo} deve ser um hostname https válido.`)
  return achado[1]!.toLowerCase()
}

const idDe = (item: DeploymentBruto): string | null => {
  const id = typeof item.uid === 'string' ? item.uid : item.id
  return typeof id === 'string' && ID_DE_DEPLOYMENT.test(id) ? id : null
}

export class VercelPromotionAdapter implements PromotionFrontendPort {
  private readonly dominios: Readonly<Record<ReleaseEnvironment, string>>

  constructor(
    private readonly runner: CommandRunner,
    private readonly config: VercelPromotionConfig
  ) {
    const staging = hostDe(config.stagingDomain, 'domínio de Staging')
    const production = hostDe(config.productionDomain, 'domínio de Produção')
    // Mesmo domínio nos dois ambientes faria "promover" e "validar" serem a mesma coisa.
    if (staging === production)
      throw new TypeError('Staging e Produção não podem usar o mesmo domínio.')
    this.dominios = { staging, production }
  }

  private cli(args: readonly string[], timeoutMs: number) {
    const escopo = this.config.scope ? ['--scope', this.config.scope] : []
    return this.runner.run(BINARIO, [...args, ...escopo, '--non-interactive'], {
      cwd: this.config.workdir,
      env: { VERCEL_TOKEN: this.config.token },
      redact: [this.config.token],
      timeoutMs
    })
  }

  /**
   * Deployments com TODAS as marcas. O filtro `--meta` é da CLI; a posse é conferida aqui, item a
   * item: resposta sem `meta` não prova nada e falha em vez de tratar o projeto inteiro como do
   * release. Deployment promovido (`target` production) continua do release — a marca é a posse.
   */
  private async listar(marcas: readonly string[], etapa: string): Promise<DeploymentBruto[]> {
    const args = ['list', ...marcas.flatMap((m) => ['--meta', m]), '--format', 'json', '--yes']
    const bruto = lerJson(exigirSucesso(await this.cli(args, TIMEOUT_CURTO_MS), etapa), etapa)
    const lista = Array.isArray(bruto)
      ? bruto
      : ((bruto as { deployments?: unknown } | null)?.deployments ?? [])
    if (!Array.isArray(lista))
      throw new PromotionProviderError(
        'failed',
        'A lista de deployments veio em formato inesperado.'
      )
    return (lista as DeploymentBruto[]).filter((item) => {
      if (typeof item.meta !== 'object' || item.meta === null)
        throw new PromotionProviderError(
          'incompatible-state',
          'A Vercel não devolveu a marca de posse dos deployments.'
        )
      const meta = item.meta as Record<string, unknown>
      return marcas.every((m) => {
        const corte = m.indexOf('=')
        return meta[m.slice(0, corte)] === m.slice(corte + 1)
      })
    })
  }

  async build(input: { releaseId: string; sourceSha: string }): Promise<{ deploymentId: string }> {
    if (!ID_DE_RELEASE.test(input.releaseId) || !SHA_VALIDO.test(input.sourceSha))
      throw new PromotionProviderError('incompatible-state', 'Identidade de release inválida.')
    const marcas = [`jarvisRelease=${input.releaseId}`, `jarvisSha=${input.sourceSha}`]
    // Reconcilia antes de criar: deployment pronto com a mesma identidade é reaproveitado.
    for (const item of await this.listar(marcas, 'listar deployments')) {
      const id = idDe(item)
      const estado = String(item.state ?? item.readyState ?? '').toUpperCase()
      if (id && estado === 'READY') return { deploymentId: id }
    }
    // Sem `--prod`/`--target` e sem `--build-env`/`--env`: preview imutável, sem backend gravado.
    const args = ['deploy', '--yes', '--format', 'json', ...marcas.flatMap((m) => ['--meta', m])]
    const etapa = 'implantar frontend'
    const saida = lerJson(exigirSucesso(await this.cli(args, TIMEOUT_MS), etapa), etapa)
    const bruto = (saida ?? {}) as DeploymentBruto
    const id = idDe((bruto.deployment as DeploymentBruto | undefined) ?? bruto)
    if (!id)
      throw new PromotionProviderError(
        'failed',
        'A Vercel não devolveu a identidade do deployment.'
      )
    return { deploymentId: id }
  }

  async current(environment: ReleaseEnvironment): Promise<string | null> {
    const etapa = 'ler deployment servido'
    const host = this.dominioDe(environment)
    const resultado = await this.cli(['inspect', host, '--format', 'json'], TIMEOUT_CURTO_MS)
    if (resultado.code !== 0 || resultado.timedOut) {
      const erro = falhaDeCli(resultado, etapa)
      if (erro.code === 'not-found') return null
      throw erro
    }
    const bruto = (lerJson(resultado, etapa) ?? {}) as DeploymentBruto
    const id = idDe((bruto.deployment as DeploymentBruto | undefined) ?? bruto)
    if (!id)
      throw new PromotionProviderError(
        'failed',
        'A Vercel não devolveu a identidade do deployment.'
      )
    return id
  }

  async assign(input: { environment: ReleaseEnvironment; deploymentId: string }): Promise<void> {
    const host = this.dominioDe(input.environment)
    if (!ID_DE_DEPLOYMENT.test(input.deploymentId))
      throw new PromotionProviderError(
        'incompatible-state',
        'Identificador de deployment inválido.'
      )
    // Idempotente. Produção NÃO exige que o deployment esteja em Staging: o rollback também usa
    // esta porta para devolver Produção a um deployment anterior, que Staging já não serve.
    if ((await this.current(input.environment)) === input.deploymentId) return
    if (input.environment === 'staging') {
      exigirSucesso(
        await this.cli(['alias', 'set', input.deploymentId, host], TIMEOUT_CURTO_MS),
        'atribuir Staging'
      )
    } else {
      exigirSucesso(
        await this.cli(
          ['promote', input.deploymentId, '--timeout', PROMOCAO_CLI, '--yes'],
          TIMEOUT_PROMOCAO_MS
        ),
        'promover Produção'
      )
    }
    // Exit 0 não prova o efeito: a leitura posterior é o que confirma o ambiente.
    if ((await this.current(input.environment)) !== input.deploymentId)
      throw new PromotionProviderError('failed', 'O ambiente não passou a servir o deployment.')
  }

  /** Só os dois domínios da config chegam à CLI; ambiente desconhecido não vira domínio. */
  private dominioDe(environment: ReleaseEnvironment): string {
    const host = Object.hasOwn(this.dominios, environment) ? this.dominios[environment] : undefined
    if (!host) throw new PromotionProviderError('incompatible-state', 'Ambiente desconhecido.')
    return host
  }
}
