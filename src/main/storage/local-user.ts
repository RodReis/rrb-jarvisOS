/**
 * Usuário local da fundação — a identidade que existe **antes** do login.
 *
 * A auditoria é escopada por `user_id` desde o dia 1 (CONVENTION §2), mas a autenticação
 * Google só nasce na F03. Sem uma identidade nomeada, o `user_id` da fatia 02 viraria uma
 * string solta espalhada pelos call sites — exatamente o "hardcode" que o CLAUDE.md
 * proíbe. Nomeá-la aqui torna explícito o que ela é e quando deixa de valer.
 *
 * Quando a F03 entrar: quem constrói o `WorkspaceService` passa o `user_id` da sessão
 * real, e este id permanece apenas nas cadeias de auditoria já gravadas — que são
 * append-only e por isso não são reescritas.
 */

import type { UserProfile } from '@shared/domain/entities'

/** Id do usuário local. Estável entre execuções: a cadeia de auditoria depende disso. */
export const LOCAL_USER_ID = 'local'

/** Perfil mínimo do usuário local, gravado na primeira execução. */
export const LOCAL_USER_PROFILE: UserProfile = {
  id: LOCAL_USER_ID,
  name: 'Usuário local',
  email: '',
  locale: 'pt-BR'
}
