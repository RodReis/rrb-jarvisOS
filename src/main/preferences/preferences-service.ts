/**
 * Preferências do usuário: idioma e tema (SPEC-Fundacao-05).
 *
 * Persistidas no `UserProfile` (F04), por usuário. Trocar preferência **não** gera
 * `AuditEvent`: é ação de baixo risco, e o escopo de auditoria da fundação é auth +
 * workspace-switch (decisão registrada na própria spec). Poluir a cadeia com evento
 * comum de app diluiria o valor da evidência.
 */

import type { PreferencesSnapshot } from '@shared/contracts/ipc'
import {
  isLocale,
  isThemePreference,
  type ResolvedTheme,
  type ThemePreference,
  type UserPreferences,
  type UserProfile
} from '@shared/domain/entities'
import { log } from '../logging/logger'
import type { UserProfileRepository } from '../storage/repositories'

/**
 * Como o SO responde "você está no escuro?".
 *
 * Injetado em vez de importar `nativeTheme` direto: o serviço fica testável sem Electron,
 * e a resolução de `sistema` — que é a regra desta fatia — pode ser exercitada nos dois
 * estados do SO sem depender da máquina que roda o teste.
 */
export type DetectorDeTemaDoSistema = () => ResolvedTheme

export class PreferencesService {
  constructor(
    private readonly profiles: UserProfileRepository,
    private readonly userId: string,
    private readonly temaDoSistema: DetectorDeTemaDoSistema
  ) {}

  /** Resolve `sistema` no momento da leitura — o usuário pode ter mudado o SO desde o boot. */
  private resolver(preferencia: ThemePreference): ResolvedTheme {
    return preferencia === 'sistema' ? this.temaDoSistema() : preferencia
  }

  private snapshot(profile: UserProfile): PreferencesSnapshot {
    return {
      locale: profile.locale,
      theme: profile.theme,
      resolvedTheme: this.resolver(profile.theme)
    }
  }

  atual(): PreferencesSnapshot {
    const profile = this.profiles.findById(this.userId)

    if (!profile) {
      // Perfil ausente não deve derrubar a UI: cai no padrão do produto e registra.
      log.db.warn('Perfil não encontrado ao ler preferências; usando o padrão', {
        op: 'select',
        table: 'user_profile'
      })
      return { locale: 'pt-BR', theme: 'sistema', resolvedTheme: this.temaDoSistema() }
    }

    return this.snapshot(profile)
  }

  /**
   * Grava e devolve o estado resultante.
   *
   * Valores fora dos enums são **descartados**, não gravados: o renderer é fronteira de
   * confiança, e um `locale` inventado viraria uma UI sem tradução nenhuma.
   */
  salvar(preferences: UserPreferences): PreferencesSnapshot {
    const validadas: UserPreferences = {
      ...(isLocale(preferences.locale) ? { locale: preferences.locale } : {}),
      ...(isThemePreference(preferences.theme) ? { theme: preferences.theme } : {})
    }

    if (Object.keys(validadas).length === 0) {
      log.db.warn('Preferências descartadas: nenhum campo válido no pedido', {
        op: 'update',
        table: 'user_profile'
      })
      return this.atual()
    }

    const profile = this.profiles.savePreferences(this.userId, validadas)
    return profile ? this.snapshot(profile) : this.atual()
  }
}
