/**
 * O vault como regra (SPEC-Providers-01) — precedência, `missing`, ator e auditoria.
 *
 * O repositório guarda bytes; este serviço decide **o que a credencial é**: de onde ela vem
 * (vault > env), se ela falta, quem pode mexer nela e o que fica registrado. É o ponto único
 * por onde adapters (F02), BudgetPolicy (F03) e conectores (MVP-006) leem credencial —
 * nenhum deles chama provider sem passar por aqui.
 *
 * O que **não** atravessa este serviço para fora: o valor. `resolve` devolve o segredo e é
 * chamado só de dentro do main; tudo que a UI alcança devolve `CredentialStatusView`, que não
 * tem campo onde a chave caiba.
 */

import {
  CREDENTIAL_KEYS,
  CREDENTIAL_PROVIDER_LABELS,
  nomeDaVariavelDeAmbiente,
  type CredentialActor,
  type CredentialKey,
  type CredentialSource,
  type CredentialStatusView
} from '@shared/domain/credentials'
import {
  CONNECTOR_CREDENTIAL_KEYS,
  ROTULO_DO_CONECTOR,
  type ConnectorCredentialKey,
  type ConnectorCredentialStatusView
} from '@shared/domain/connectors'
import type { WorkspaceId } from '@shared/domain/entities'
import { log } from '../logging/logger'
import type { AuditRepository } from '../storage/audit-repository'
import type { PolicyService } from '../policy/policy-service'
import type { CredentialRepository } from './credential-repository'

/** O que uma leitura de credencial devolve ao consumidor **dentro do main**. */
export interface ResolvedCredential {
  readonly key: CredentialKey
  readonly source: CredentialSource
  /** O valor cru. Existe em memória, no main, pelo tempo da chamada — e não sai daqui. */
  readonly value: string
}

export class CredentialService {
  constructor(
    private readonly repository: CredentialRepository,
    private readonly audit: AuditRepository,
    /**
     * O Policy Engine, para classificar a edição por **agente** como alto risco
     * (`secrets.change`). Entra por injeção como no `CommandAllowlistRepository`: a
     * classificação é do runtime, e o serviço precisa continuar exercitável com um serviço de
     * teste.
     */
    private readonly policy: PolicyService,
    /** O ambiente lido como fonte de bootstrap. Injetado para o teste poder semear. */
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {}

  /**
   * Resolve a credencial para uso — **vault primeiro, env como fallback** (critério 3).
   *
   * A ordem é a decisão do Cowork na spec, e é a única que faz a UI ser verdadeira: se o env
   * vencesse, o usuário adicionaria a chave no Settings, veria "salvo", e o app continuaria
   * falando com o provider usando a chave do arquivo — uma divergência silenciosa entre o que
   * a tela mostra e o que a rede usa.
   *
   * `undefined` = credencial ausente nas duas fontes. É desfecho normal, não erro: o app roda
   * sem provider configurado (mesma degradação graciosa do login sem `.env`).
   */
  resolve(
    userId: string,
    workspaceId: WorkspaceId,
    key: CredentialKey
  ): ResolvedCredential | undefined {
    const doVault = this.repository.readSecret(userId, workspaceId, key)
    if (doVault !== undefined && doVault !== '') {
      return { key, source: 'vault', value: doVault }
    }

    const doEnv = this.lerDoEnv(key)
    if (doEnv !== undefined) return { key, source: 'env', value: doEnv }

    return undefined
  }

  /**
   * O status de **todas** as chaves conhecidas naquele espaço — inclusive as que faltam
   * (critério 4).
   *
   * Varre `CREDENTIAL_KEYS` e não a tabela: `missing` é a ausência de algo *esperado*, e o
   * esperado é a lista de chaves que o app conhece. Listar só o que está gravado responderia
   * "o que eu tenho", quando a pergunta da tela é "o que falta".
   *
   * Nenhum campo do retorno carrega segredo — nem indício dele: não há tamanho, prefixo,
   * máscara nem hash. A UI sabe *que* a chave existe e *de onde* vem; não sabe nada sobre o
   * que ela é.
   */
  listStatus(userId: string, workspaceId: WorkspaceId): readonly CredentialStatusView[] {
    const noVault = new Set(this.repository.listKeys(userId, workspaceId))

    return CREDENTIAL_KEYS.map((key) => {
      const envDisponivel = this.lerDoEnv(key) !== undefined
      const source: CredentialSource | undefined = noVault.has(key)
        ? 'vault'
        : envDisponivel
          ? 'env'
          : undefined

      return {
        key,
        provider: CREDENTIAL_PROVIDER_LABELS[key],
        workspace: workspaceId,
        status: source === undefined ? 'missing' : 'present',
        ...(source === undefined ? {} : { source }),
        envDisponivel
      } satisfies CredentialStatusView
    })
  }

  /**
   * Grava uma credencial no vault e audita (critérios 5 e 6).
   *
   * O `actor` decide se há classificação de política, e essa é a decisão do PI de 2026-07-24
   * inteira: o **usuário** mexendo na própria credencial no Settings é o dono agindo sobre o
   * que é dele — audita, não pede aprovação a ninguém; o **agente** querendo alterar
   * credencial é `secrets.change`, alto risco, `requires-approval`.
   *
   * **Report-only para o agente nesta fatia**: classifica e audita, mas não barra. O gate liga
   * quando o fluxo de aprovação do MVP-004 for plugado aqui — é o mesmo padrão "report → gate"
   * do Policy Engine e da allowlist, e é o que mantém o MVP-005 independente do MVP-004.
   * Barrar agora exigiria a fila de aprovação como dependência, e a spec pede o contrário.
   */
  set(
    userId: string,
    workspaceId: WorkspaceId,
    key: CredentialKey,
    plaintext: string,
    actor: CredentialActor
  ): readonly CredentialStatusView[] {
    this.classificarSeAgente(workspaceId, key, 'set', actor)

    this.repository.upsert(userId, workspaceId, key, plaintext)

    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'credential-change',
      // `key`, ator e operação — **nunca o valor** (ADR-004). O `workspace_id` já vai no
      // envelope do evento; repeti-lo no payload seria dado duplicado que pode divergir.
      payload: { op: 'set', key, actor }
    })

    log.integracao.info('Credencial gravada no vault', { op: 'set', actor })
    return this.listStatus(userId, workspaceId)
  }

  /**
   * Remove a credencial do vault e audita.
   *
   * Só alcança o vault: o env é read-only por desenho, e uma remoção que apagasse linha de
   * `.env` faria o app editar arquivo de configuração do usuário por trás dele. Por isso a
   * `CredentialStatusView` expõe `envDisponivel` — com env presente, remover do vault devolve
   * a credencial para a fonte `env`, e a tela precisa poder dizer isso antes do clique.
   *
   * Remover o que não está no vault é no-op e **não** audita: registrar um evento que não
   * corresponde a mudança nenhuma polui a evidência (mesma regra da allowlist).
   */
  remove(
    userId: string,
    workspaceId: WorkspaceId,
    key: CredentialKey,
    actor: CredentialActor
  ): readonly CredentialStatusView[] {
    this.classificarSeAgente(workspaceId, key, 'remove', actor)

    const removeu = this.repository.remove(userId, workspaceId, key)

    if (removeu) {
      this.audit.append({
        user_id: userId,
        workspace_id: workspaceId,
        type: 'credential-change',
        payload: { op: 'remove', key, actor }
      })
      log.integracao.info('Credencial removida do vault', { op: 'remove', actor })
    }

    return this.listStatus(userId, workspaceId)
  }

  /**
   * O status das credenciais de **conector** naquele espaço (SPEC-Conectores-05, crit. 7).
   *
   * Método irmão de `listStatus` e não uma extensão dele: as duas taxonomias são separadas por
   * decisão do PI, e juntá-las numa lista só faria a tela de IA precisar filtrar chave de
   * conector — a mistura que a separação existe para evitar.
   *
   * Sem `source`: credencial de conector vive só no vault (não há `JARVIS_CREDENTIAL_TAVILY`).
   * E nenhum campo carrega segredo, nem indício dele — sem tamanho, prefixo, máscara ou hash.
   */
  listConnectorStatus(
    userId: string,
    workspaceId: WorkspaceId
  ): readonly ConnectorCredentialStatusView[] {
    const noVault = new Set(this.repository.listKeys(userId, workspaceId))

    return CONNECTOR_CREDENTIAL_KEYS.map((key) => ({
      key,
      conector: ROTULO_DO_CONECTOR[key],
      workspace: workspaceId,
      status: noVault.has(key) ? ('present' as const) : ('missing' as const),
      // O GitHub tem credencial, mas ela nasce do Device Flow (F03) e não de um campo de texto.
      // Oferecer o campo convidaria a colar um valor que nada consumiria.
      gerenciavel: key !== 'github'
    }))
  }

  /**
   * Grava a credencial de um conector no vault e audita.
   *
   * Espelha `set` no que importa — mesmo cofre, mesma auditoria, valor nunca no payload — e
   * difere no que a taxonomia exige: `key` é `ConnectorCredentialKey`, e a lista devolvida é a
   * de conectores.
   *
   * A credencial gerida por Device Flow não passa por aqui: quem a grava é o `GithubAuthService`,
   * com payload estruturado e rotação atômica. Aceitar um texto colado para ela gravaria por cima
   * do par access/refresh e quebraria o refresh silenciosamente.
   */
  setConnector(
    userId: string,
    workspaceId: WorkspaceId,
    key: ConnectorCredentialKey,
    plaintext: string,
    actor: CredentialActor
  ): readonly ConnectorCredentialStatusView[] {
    if (key === 'github') {
      throw new Error('A credencial do GitHub é obtida pelo Device Flow, não por chave colada.')
    }

    this.classificarSeAgente(workspaceId, key, 'set', actor)
    this.repository.upsert(userId, workspaceId, key, plaintext)

    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'credential-change',
      payload: { op: 'set', key, actor }
    })

    log.integracao.info('Credencial de conector gravada no vault', { op: 'set', actor })
    return this.listConnectorStatus(userId, workspaceId)
  }

  /**
   * Remove a credencial de um conector do vault e audita.
   *
   * Como em `remove`, no-op **não** audita: registrar um evento que não corresponde a mudança
   * nenhuma polui a evidência.
   */
  removeConnector(
    userId: string,
    workspaceId: WorkspaceId,
    key: ConnectorCredentialKey,
    actor: CredentialActor
  ): readonly ConnectorCredentialStatusView[] {
    this.classificarSeAgente(workspaceId, key, 'remove', actor)

    if (this.repository.remove(userId, workspaceId, key)) {
      this.audit.append({
        user_id: userId,
        workspace_id: workspaceId,
        type: 'credential-change',
        payload: { op: 'remove', key, actor }
      })
      log.integracao.info('Credencial de conector removida do vault', { op: 'remove', actor })
    }

    return this.listConnectorStatus(userId, workspaceId)
  }

  /**
   * Classifica a edição quando o ator é agente; para o usuário, não há o que classificar.
   *
   * A classificação vem **antes** da gravação, como no `CommandAllowlistRepository`: a decisão
   * de política é sobre o ato de mudar a credencial, e registrá-la depois inverteria a ordem
   * que a auditoria conta (decidi, então fiz).
   */
  private classificarSeAgente(
    workspaceId: WorkspaceId,
    // As duas taxonomias, porque a classificação é sobre o **ato** de mexer em credencial, e
    // esse ato é o mesmo `secrets.change` para chave de IA e de conector.
    key: CredentialKey | ConnectorCredentialKey,
    op: 'set' | 'remove',
    actor: CredentialActor
  ): void {
    if (actor !== 'agente') return

    this.policy.classify('secrets.change', {
      workspace: workspaceId,
      // `sensitivity: credential` não é decoração: é o que faz a redaction do ADR-005 apagar
      // este `detail` inteiro do log, em vez de gravar um objeto que descreve a credencial.
      sensitivity: 'credential',
      detail: { op, alvo: 'credential_ref', key }
    })
  }

  /**
   * Lê a chave do ambiente. Vazio conta como ausente: uma variável declarada sem valor no
   * `.env` é a intenção de não configurar, não uma credencial de string vazia que o adapter
   * mandaria para o provider.
   */
  private lerDoEnv(key: CredentialKey): string | undefined {
    const valor = this.env[nomeDaVariavelDeAmbiente(key)]
    return valor !== undefined && valor !== '' ? valor : undefined
  }
}
