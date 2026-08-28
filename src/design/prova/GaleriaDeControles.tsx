import { useState } from 'react'
import { Search, User } from 'lucide-react'
import { ProvedorDeTema } from '../tokens/provider'
import type { CorAcento } from '../tokens/acento'
import type { ModoUi, Modulo } from '../tokens/semantic'
import {
  Alternador,
  Button,
  ButtonGroup,
  Checkbox,
  Combobox,
  Field,
  IconButton,
  Input,
  Link,
  PasswordInput,
  RadioGroup,
  Select,
  Slider,
  Textarea
} from '../ui'

/**
 * Galeria de prova dos controles (SPEC-DesignSystem-03a).
 *
 * Renderiza os dezesseis componentes em **todos os estados** para inspeção visual por
 * screenshot. Não é catálogo navegável (Storybook está suspenso — MVP-003 §4) nem parte do
 * app: é o alvo de uma captura por modo, que é como esta fatia verifica o que jsdom não mede
 * — layout real, contraste computado, alinhamento óptico, foco desenhado.
 *
 * O `jos-prova-*` nos data-attributes existe para o Playwright recortar seções isoladas:
 * screenshot de página inteira esconde defeito de espaçamento em thumbnail.
 */

const OPCOES = [
  { valor: 'seo', rotulo: 'SEO' },
  { valor: 'conteudo', rotulo: 'Conteúdo' },
  { valor: 'operacoes', rotulo: 'Operações' },
  { valor: 'intel', rotulo: 'Intel', desabilitada: true }
] as const

interface GaleriaProps {
  readonly modo: ModoUi
  readonly modulo?: Modulo
  readonly acento?: CorAcento
}

export function GaleriaDeControles({
  modo,
  modulo = 'jarvis',
  acento
}: GaleriaProps): React.JSX.Element {
  return (
    <ProvedorDeTema
      uiTheme={modo}
      modulo={modulo}
      superficie={modulo}
      accentJarvis={acento ?? '#C4C4C4'}
      accentNoa={acento ?? '#C4C4C4'}
    >
      <div
        data-testid="galeria"
        className="min-h-screen bg-[var(--jos-cor-superficie)] p-8 font-[family-name:var(--jos-fonte-corpo)] text-[var(--jos-cor-texto)]"
      >
        <div className="mx-auto flex max-w-4xl flex-col gap-10">
          <Cabecalho modo={modo} modulo={modulo} />
          <SecaoAcoes />
          <SecaoCampos />
          <SecaoEscolha />
          <SecaoEstados />
        </div>
      </div>
    </ProvedorDeTema>
  )
}

function Cabecalho({ modo, modulo }: { modo: ModoUi; modulo: Modulo }): React.JSX.Element {
  return (
    <header className="flex items-baseline justify-between border-b border-[rgba(var(--jos-borda-rgb),0.12)] pb-4">
      <h1 className="font-[family-name:var(--jos-fonte-display)] text-[length:var(--jos-texto-secao)] tracking-[var(--jos-tracking-acao)]">
        Controles
      </h1>
      <p className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[var(--jos-tracking-label)] text-[var(--jos-cor-texto-suave)]">
        {modulo} · {modo}
      </p>
    </header>
  )
}

function Secao({
  titulo,
  id,
  children
}: {
  titulo: string
  id: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section data-prova={id} className="flex flex-col gap-4">
      <h2 className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[var(--jos-tracking-label)] text-[var(--jos-cor-texto-suave)]">
        {titulo}
      </h2>
      {children}
    </section>
  )
}

function SecaoAcoes(): React.JSX.Element {
  return (
    <Secao titulo="Ações" id="acoes">
      <div className="flex flex-wrap items-center gap-3">
        <Button variante="primaria">Executar</Button>
        <Button variante="secundaria">Cancelar</Button>
        <Button variante="perigo">Excluir</Button>
        <Button variante="primaria" carregando>
          Executar
        </Button>
        <Button variante="secundaria" desabilitado>
          Indisponível
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <IconButton rotulo="Buscar">
          <Search className="size-[var(--jos-tamanho-icone)]" />
        </IconButton>
        <IconButton rotulo="Filtrar" ativo>
          <User className="size-[var(--jos-tamanho-icone)]" />
        </IconButton>
        <IconButton rotulo="Bloqueado" desabilitado>
          <Search className="size-[var(--jos-tamanho-icone)]" />
        </IconButton>

        <ButtonGroup rotulo="Ações do registro">
          <Button>Descartar</Button>
          <Button variante="primaria">Salvar</Button>
        </ButtonGroup>
      </div>

      <div className="flex items-center gap-4">
        <Link href="#interno">Ver detalhes</Link>
        <Link href="https://exemplo.com" externo>
          Documentação
        </Link>
      </div>
    </Secao>
  )
}

function SecaoCampos(): React.JSX.Element {
  const [texto, setTexto] = useState('')
  const [senha, setSenha] = useState('')
  const [notas, setNotas] = useState('')

  return (
    <Secao titulo="Campos" id="campos">
      <div className="grid grid-cols-2 gap-5">
        <Field rotulo="Nome do workflow" obrigatorio descricao="Use minúsculas e hífen.">
          {(campo) => (
            <Input
              {...campo}
              valor={texto}
              onMudar={setTexto}
              placeholder="publicacao-seo"
              icone={<User className="size-[var(--jos-tamanho-icone)]" />}
            />
          )}
        </Field>

        <Field rotulo="Senha">
          {(campo) => (
            <PasswordInput {...campo} valor={senha} onMudar={setSenha} placeholder="••••••••" />
          )}
        </Field>

        <Field
          rotulo="Chave do provedor"
          erro="Chave inválida. Verifique o valor no painel do provedor."
        >
          {(campo) => <Input {...campo} valor="sk-erro" onMudar={() => {}} />}
        </Field>

        <Field rotulo="Campo travado">
          {(campo) => <Input {...campo} valor="" onMudar={() => {}} desabilitado />}
        </Field>
      </div>

      <Field rotulo="Observações" descricao="Contexto para quem revisar a execução.">
        {(campo) => (
          <Textarea {...campo} valor={notas} onMudar={setNotas} placeholder="Anotações…" />
        )}
      </Field>
    </Secao>
  )
}

function SecaoEscolha(): React.JSX.Element {
  const [select, setSelect] = useState('seo')
  const [combo, setCombo] = useState('')
  const [radio, setRadio] = useState('sequencial')
  const [limite, setLimite] = useState(40)

  return (
    <Secao titulo="Escolha" id="escolha">
      <div className="grid grid-cols-2 gap-5">
        <Field rotulo="Especialidade">
          {(campo) => <Select {...campo} valor={select} onMudar={setSelect} opcoes={OPCOES} />}
        </Field>

        <Field rotulo="Skill">
          {(campo) => <Combobox {...campo} valor={combo} onMudar={setCombo} opcoes={OPCOES} />}
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-5">
        <div className="flex flex-col gap-3">
          <RadioGroup
            rotulo="Tipo de execução"
            valor={radio}
            onMudar={setRadio}
            opcoes={[
              { valor: 'sequencial', rotulo: 'Sequencial' },
              { valor: 'paralelo', rotulo: 'Paralelo' },
              { valor: 'agendado', rotulo: 'Agendado', desabilitada: true }
            ]}
          />
        </div>

        <div className="flex flex-col gap-3">
          <Checkbox rotulo="Exigir aprovação" marcado onMudar={() => {}} />
          <Checkbox rotulo="Seleção parcial" marcado="indeterminado" onMudar={() => {}} />
          <Checkbox rotulo="Bloqueado" marcado={false} onMudar={() => {}} desabilitado />

          <div className="flex items-center gap-3">
            <Alternador rotulo="Modo autônomo" ligado onMudar={() => {}} />
            <span className="text-[length:var(--jos-texto-corpo)]">Modo autônomo</span>
          </div>
        </div>
      </div>

      <Field rotulo="Limite diário">
        {() => (
          <Slider
            rotulo="Limite diário"
            valor={limite}
            onMudar={setLimite}
            formatar={(v) => `${v}%`}
          />
        )}
      </Field>
    </Secao>
  )
}

/**
 * Foco desenhado.
 *
 * O anel de foco é o estado que jsdom **não** mede e que mais some numa revisão apressada:
 * ele só existe visualmente. A seção existe para que a captura o registre.
 */
function SecaoEstados(): React.JSX.Element {
  return (
    <Secao titulo="Foco (autofocus no primeiro)" id="foco">
      <div className="flex flex-wrap items-center gap-3">
        <Button variante="primaria">Com foco via teclado</Button>
        <Field rotulo="Campo com foco">
          {(campo) => <Input {...campo} valor="" onMudar={() => {}} placeholder="Tab até aqui" />}
        </Field>
      </div>
    </Secao>
  )
}
