import { useEffect, useState } from 'react'
import { Alternador, Button, Field, Input, Select } from '@design/ui'
import type {
  AtividadeDoCronograma,
  ConfiguracaoDoCronograma,
  SequenciaDoCronograma
} from '@shared/domain/cronograma'

const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const novoId = (): string => crypto.randomUUID()
const hora = (minuto: number): string =>
  `${String(Math.floor(minuto / 60)).padStart(2, '0')}:${String(minuto % 60).padStart(2, '0')}`

export function PreferenciasDoCronograma(): React.JSX.Element | null {
  const [config, setConfig] = useState<ConfiguracaoDoCronograma>()
  const [erro, setErro] = useState<string>()
  const [aviso, setAviso] = useState<string>()
  const [ocupado, setOcupado] = useState(false)
  useEffect(() => {
    let vivo = true
    void window.jarvis
      .lerCronograma()
      .then((c) => {
        if (vivo) setConfig(c)
      })
      .catch(() => {
        if (vivo) setErro('Não foi possível ler o cronograma.')
      })
    return () => {
      vivo = false
    }
  }, [])
  if (!config) return erro ? <p role="alert">{erro}</p> : null

  function alterar(mudanca: Partial<ConfiguracaoDoCronograma>): void {
    setConfig((atual) => (atual ? { ...atual, ...mudanca } : atual))
    setAviso(undefined)
    setErro(undefined)
  }
  function mudarSequencia(
    id: string,
    atualizar: (s: SequenciaDoCronograma) => SequenciaDoCronograma
  ): void {
    alterar({ sequencias: config!.sequencias.map((s) => (s.id === id ? atualizar(s) : s)) })
  }
  function mudarAtividades(id: string, atividades: readonly AtividadeDoCronograma[]): void {
    mudarSequencia(id, (s) => ({ ...s, atividades }))
  }
  function adicionarSequencia(): void {
    alterar({
      sequencias: [
        ...config!.sequencias,
        {
          id: novoId(),
          nome: 'Nova sequência',
          ativa: false,
          gatilho: { tipo: 'evento', evento: 'boas-vindas' },
          atividades: [{ id: novoId(), tipo: 'falar' }]
        }
      ]
    })
  }
  async function selecionarMidia(id: string, tipo: 'arquivo' | 'pasta'): Promise<void> {
    setOcupado(true)
    try {
      const midia = await window.jarvis.selecionarMidiaDoCronograma(tipo)
      if (midia)
        mudarSequencia(id, (s) => ({
          ...s,
          atividades: [...s.atividades, { id: novoId(), tipo: 'tocar-midia-local', midia }]
        }))
    } catch {
      setErro('Não foi possível escolher a mídia local.')
    } finally {
      setOcupado(false)
    }
  }
  async function salvar(): Promise<void> {
    setOcupado(true)
    try {
      const salvo = await window.jarvis.salvarCronograma(config!)
      setConfig(salvo)
      setAviso('Cronograma salvo e validado pela política.')
      setErro(undefined)
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Não foi possível salvar o cronograma.')
    } finally {
      setOcupado(false)
    }
  }
  return (
    <section
      className="flex flex-col gap-5 border-t border-[var(--jos-cor-borda)] pt-6"
      aria-labelledby="cronograma-titulo"
    >
      <div>
        <h3 id="cronograma-titulo" className="text-sm font-semibold">
          Cronograma de atividades
        </h3>
        <p className="mt-1 text-xs opacity-70">
          Atividades locais em sequência, validadas pela política antes de salvar.
        </p>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm">Ativar cronograma</span>
        <Alternador
          rotulo="Ativar cronograma"
          ligado={config.ativa}
          onMudar={(ativa) => alterar({ ativa })}
        />
      </div>
      {config.sequencias.map((sequencia) => (
        <div
          key={sequencia.id}
          className="flex flex-col gap-4 rounded-xl border border-[var(--jos-cor-borda)] p-4"
        >
          <div className="flex items-center justify-between gap-3">
            <strong className="text-sm">{sequencia.nome}</strong>
            <Alternador
              rotulo={`Ativar ${sequencia.nome}`}
              ligado={sequencia.ativa}
              onMudar={(ativa) => mudarSequencia(sequencia.id, (s) => ({ ...s, ativa }))}
            />
          </div>
          <Field rotulo="Nome da sequência">
            {(atributos) => (
              <Input
                {...atributos}
                valor={sequencia.nome}
                onMudar={(nome) => mudarSequencia(sequencia.id, (s) => ({ ...s, nome }))}
              />
            )}
          </Field>
          <Field rotulo="Quando executar">
            {(atributos) => (
              <Select
                {...atributos}
                valor={sequencia.gatilho.tipo}
                onMudar={(tipo) =>
                  mudarSequencia(sequencia.id, (s) => ({
                    ...s,
                    gatilho:
                      tipo === 'horario'
                        ? { tipo: 'horario', dias: [2], minuto: 480 }
                        : { tipo: 'evento', evento: 'boas-vindas' }
                  }))
                }
                opcoes={[
                  { valor: 'evento', rotulo: 'Ao chegar · boas-vindas' },
                  { valor: 'horario', rotulo: 'Em horário recorrente' }
                ]}
              />
            )}
          </Field>
          {sequencia.gatilho.tipo === 'horario' && (
            <div className="grid grid-cols-2 gap-3">
              <Field rotulo="Dia da semana">
                {(atributos) => (
                  <Select
                    {...atributos}
                    valor={String(
                      sequencia.gatilho.tipo === 'horario' ? sequencia.gatilho.dias[0] : 2
                    )}
                    onMudar={(dia) =>
                      mudarSequencia(sequencia.id, (s) => ({
                        ...s,
                        gatilho: {
                          tipo: 'horario',
                          dias: [Number(dia)],
                          minuto: s.gatilho.tipo === 'horario' ? s.gatilho.minuto : 480
                        }
                      }))
                    }
                    opcoes={DIAS.map((rotulo, valor) => ({ rotulo, valor: String(valor) }))}
                  />
                )}
              </Field>
              <Field rotulo="Hora local">
                {(atributos) => (
                  <Input
                    {...atributos}
                    valor={hora(
                      sequencia.gatilho.tipo === 'horario' ? sequencia.gatilho.minuto : 480
                    )}
                    onMudar={(valor) => {
                      if (/^([01]\d|2[0-3]):[0-5]\d$/.test(valor)) {
                        const [h, m] = valor.split(':').map(Number)
                        mudarSequencia(sequencia.id, (s) => ({
                          ...s,
                          gatilho: {
                            tipo: 'horario',
                            dias: s.gatilho.tipo === 'horario' ? s.gatilho.dias : [2],
                            minuto: h * 60 + m
                          }
                        }))
                      }
                    }}
                    placeholder="08:00"
                  />
                )}
              </Field>
            </div>
          )}
          <div>
            <p className="text-sm font-semibold">Atividades · na ordem de execução</p>
            <ol className="mt-2 flex flex-col gap-2">
              {sequencia.atividades.map((atividade, i) => (
                <li
                  key={atividade.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-[var(--jos-cor-borda)] p-2 text-sm"
                >
                  <span>
                    {i + 1}.{' '}
                    {atividade.tipo === 'falar'
                      ? 'Falar pela persona'
                      : `Tocar mídia local · ${atividade.midia.caminho.split(/[\\/]/).pop()}`}
                  </span>
                  <span className="flex gap-1">
                    <Button
                      variante="secundaria"
                      desabilitado={i === 0}
                      onClick={() => {
                        const copia = [...sequencia.atividades]
                        ;[copia[i - 1], copia[i]] = [copia[i], copia[i - 1]]
                        mudarAtividades(sequencia.id, copia)
                      }}
                    >
                      ↑
                    </Button>
                    <Button
                      variante="secundaria"
                      desabilitado={i === sequencia.atividades.length - 1}
                      onClick={() => {
                        const copia = [...sequencia.atividades]
                        ;[copia[i + 1], copia[i]] = [copia[i], copia[i + 1]]
                        mudarAtividades(sequencia.id, copia)
                      }}
                    >
                      ↓
                    </Button>
                    <Button
                      variante="secundaria"
                      desabilitado={sequencia.atividades.length === 1}
                      onClick={() =>
                        mudarAtividades(
                          sequencia.id,
                          sequencia.atividades.filter((a) => a.id !== atividade.id)
                        )
                      }
                    >
                      Remover
                    </Button>
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variante="secundaria"
              onClick={() =>
                mudarAtividades(sequencia.id, [
                  ...sequencia.atividades,
                  { id: novoId(), tipo: 'falar' }
                ])
              }
            >
              + Falar
            </Button>
            <Button
              variante="secundaria"
              desabilitado={ocupado}
              onClick={() => void selecionarMidia(sequencia.id, 'arquivo')}
            >
              + Tocar mídia local
            </Button>
            <Button
              variante="secundaria"
              desabilitado={ocupado}
              onClick={() => void selecionarMidia(sequencia.id, 'pasta')}
            >
              + Tocar pasta local
            </Button>
            <Button
              variante="secundaria"
              onClick={() =>
                alterar({ sequencias: config!.sequencias.filter((s) => s.id !== sequencia.id) })
              }
            >
              Excluir sequência
            </Button>
          </div>
          <aside className="rounded-lg border border-[var(--jos-cor-borda)] p-3 text-xs">
            <h4 className="font-semibold">Prévia da execução</h4>
            <p className="mt-1 opacity-70">
              {sequencia.gatilho.tipo === 'evento'
                ? 'Depois das boas-vindas'
                : `${sequencia.gatilho.dias.map((dia) => DIAS[dia]).join(', ')} às ${hora(sequencia.gatilho.minuto)}`}
            </p>
            <p className="mt-2">
              {sequencia.atividades
                .map((atividade) => (atividade.tipo === 'falar' ? 'Falar' : 'Tocar mídia'))
                .join(' → ')}
            </p>
            <p className="mt-2 opacity-70">
              Se uma atividade falhar, as próximas continuam. O resumo fica no Command Center.
            </p>
          </aside>
        </div>
      ))}
      <p className="text-xs opacity-70">
        Antes de tocar áudio, o app respeita a janela de horário, o silêncio do sistema e o controle
        da escuta. Horários não tocam com a sessão bloqueada.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variante="secundaria" onClick={adicionarSequencia}>
          + Nova sequência
        </Button>
        <Button desabilitado={ocupado} onClick={() => void salvar()}>
          Validar e salvar
        </Button>
      </div>
      {aviso && (
        <p role="status" className="text-xs">
          {aviso}
        </p>
      )}
      {erro && (
        <p role="alert" className="text-xs text-[var(--jos-cor-err-leitura)]">
          {erro}
        </p>
      )}
    </section>
  )
}
