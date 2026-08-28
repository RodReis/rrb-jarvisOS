import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DURACAO_PADRAO,
  MAX_TOASTS,
  ToastContexto,
  type ControleToast,
  type EntradaToast,
  type Toast
} from './useToast'
import { ToastViewport } from './ToastViewport'

/**
 * Implementação do motor de Toasts (SPEC-DesignSystem-03b, README §5).
 *
 * Guarda a fila, os timers de auto-dismiss e a deduplicação. Monta o `ToastViewport` no fim da
 * árvore. É stateful de propósito — os componentes que disparam toasts ficam puros, sem saber
 * de timers.
 *
 * O relógio entra por prop (`agora`), com default. É o mesmo padrão da SPEC-Fundacao (o
 * `AuditEvent` recebe `agora()` em vez de chamar `new Date()` dentro): o `stamp` HH:MM:SS
 * precisa ser determinístico no teste, e um `new Date()` embutido tornaria a asserção refém do
 * relógio da máquina.
 */

interface ToastProviderProps {
  readonly children: React.ReactNode
  /** Fonte de horário — injetável para o teste fixar o `stamp`. */
  readonly agora?: () => Date
}

function formatarStamp(d: Date): string {
  const dois = (n: number): string => String(n).padStart(2, '0')
  return `${dois(d.getHours())}:${dois(d.getMinutes())}:${dois(d.getSeconds())}`
}

export function ToastProvider({
  children,
  agora = () => new Date()
}: ToastProviderProps): React.JSX.Element {
  const [toasts, setToasts] = useState<readonly Toast[]>([])
  // Timers e id vivem em ref: não disparam re-render e sobrevivem entre eles. Um Map por id
  // permite pausar/retomar um toast específico sem tocar nos outros.
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())
  const restante = useRef(new Map<number, { fim: number; sobra: number }>())
  const proximoId = useRef(1)

  const descartar = useCallback((id: number): void => {
    const t = timers.current.get(id)
    if (t !== undefined) clearTimeout(t)
    timers.current.delete(id)
    restante.current.delete(id)
    setToasts((atual) => atual.filter((toast) => toast.id !== id))
  }, [])

  const agendar = useCallback(
    (id: number, ms: number): void => {
      const t = setTimeout(() => descartar(id), ms)
      timers.current.set(id, t)
      restante.current.set(id, { fim: Date.now() + ms, sobra: ms })
    },
    [descartar]
  )

  const disparar = useCallback(
    (entrada: EntradaToast): void => {
      setToasts((atual) => {
        // Dedupe: um mesmo tom+título+mensagem repetido não empilha (README §5 — uma falha que
        // acontece em rajada não deve virar cinco toasts idênticos). O existente é mantido.
        const igual = atual.find(
          (t) =>
            t.tom === entrada.tom && t.titulo === entrada.titulo && t.mensagem === entrada.mensagem
        )
        if (igual !== undefined) return atual

        const id = proximoId.current++
        const duracao = entrada.duracao ?? DURACAO_PADRAO
        const novo: Toast = {
          id,
          tom: entrada.tom,
          titulo: entrada.titulo,
          mensagem: entrada.mensagem,
          duracao,
          stamp: formatarStamp(agora())
        }
        agendar(id, duracao)

        // Máx. 5, mais novo no topo (README §5.1). Ao estourar, o **mais antigo** sai — e seu
        // timer é limpo, senão dispararia um `descartar` para um id que já não existe.
        const comNovo = [novo, ...atual]
        if (comNovo.length > MAX_TOASTS) {
          const excedente = comNovo.slice(MAX_TOASTS)
          for (const t of excedente) {
            const timer = timers.current.get(t.id)
            if (timer !== undefined) clearTimeout(timer)
            timers.current.delete(t.id)
            restante.current.delete(t.id)
          }
          return comNovo.slice(0, MAX_TOASTS)
        }
        return comNovo
      })
    },
    [agora, agendar]
  )

  const pausar = useCallback((id: number): void => {
    const t = timers.current.get(id)
    const info = restante.current.get(id)
    if (t === undefined || info === undefined) return
    clearTimeout(t)
    timers.current.delete(id)
    // Guarda quanto faltava: retomar reinicia só o resto, não a duração inteira.
    restante.current.set(id, { fim: info.fim, sobra: info.fim - Date.now() })
  }, [])

  const retomar = useCallback(
    (id: number): void => {
      const info = restante.current.get(id)
      if (info === undefined || timers.current.has(id)) return
      agendar(id, Math.max(0, info.sobra))
    },
    [agendar]
  )

  // Limpa todos os timers no unmount: sem isto, um provider desmontado deixaria setTimeout
  // pendentes chamando setState sobre um componente que já não existe.
  useEffect(() => {
    const mapa = timers.current
    return () => {
      for (const t of mapa.values()) clearTimeout(t)
      mapa.clear()
    }
  }, [])

  const controle = useMemo<ControleToast>(
    () => ({ toasts, disparar, descartar, pausar, retomar }),
    [toasts, disparar, descartar, pausar, retomar]
  )

  return (
    <ToastContexto.Provider value={controle}>
      {children}
      <ToastViewport />
    </ToastContexto.Provider>
  )
}
