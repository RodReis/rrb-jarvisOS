/**
 * O que o isolamento por run faz no **host** e não passa por Docker nem Git (SPEC-Scheduler-03):
 * sondar uma porta, preparar e remover o perfil do run, descartar o artefato do sandbox.
 *
 * Mora à parte do `IsolamentoService` porque é I/O de disco e de rede, e o serviço recebe estas
 * funções por injeção — o teste do serviço usa dublês, e estas têm o teste real aqui.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { ARTEFATOS_DO_SANDBOX } from '../squads/squad-git'

/**
 * A forma dos diretórios que o isolamento cria e, por isso, os únicos que apaga: absolutos, com o
 * nome `jarvisos-run-<run>` (o worktree) ou `jarvisos-run-<run>-perfil`. O caminho vem do banco; um
 * valor adulterado não pode virar `rm -rf` de outro lugar.
 */
const FORMA_DA_RAIZ_DO_PERFIL = /[\\/]jarvisos-run-[a-z0-9-]+-perfil$/
const FORMA_DO_WORKTREE = /[\\/]jarvisos-run-[a-z0-9-]+$/

/**
 * As interfaces onde a sonda tenta o bind. **As três importam**, e foi medido: no Windows um
 * servidor em `127.0.0.1` (o Postgres local) não impede um bind em `::`, então sondar só o
 * endereço "padrão" diria "livre" para a porta mais comum de estar tomada. O Docker publica em
 * `0.0.0.0` e `[::]`; o processo do host costuma escutar o loopback.
 */
const INTERFACES_DA_SONDA = ['127.0.0.1', '0.0.0.0', '::'] as const

/**
 * A porta está livre no host? Tenta o bind de verdade em cada interface de `INTERFACES_DA_SONDA`:
 * é o que o Docker faz ao publicar, e o que enxerga o processo que não é container. `docker ps`
 * não o vê. Só `EADDRINUSE` e `EACCES` contam como ocupada; interface que o host não tem
 * (`EAFNOSUPPORT`, `EADDRNOTAVAIL`) é pulada.
 *
 * Roda num processo filho **síncrono**, porque `net.listen` é assíncrono e a reserva de porta
 * precisa responder dentro do preflight. `ELECTRON_RUN_AS_NODE` vale só para o filho: o
 * `process.execPath` do app é o Electron, e sem a variável ele abriria outra janela.
 *
 * Porta fora de 1–65535 não é livre (fail closed): o `listen(0)` escolheria uma qualquer e a
 * sonda diria "livre" para o que nunca foi testado.
 */
export function portaLivreNoHost(porta: number): boolean {
  if (!Number.isInteger(porta) || porta < 1 || porta > 65_535) return false
  const sonda =
    `const net=require('net');const hosts=${JSON.stringify(INTERFACES_DA_SONDA)};let i=0;` +
    `(function proxima(){if(i===hosts.length)process.exit(0);` +
    `const s=net.createServer();` +
    `s.once('error',(e)=>{if(e.code==='EADDRINUSE'||e.code==='EACCES')process.exit(1);i++;proxima()});` +
    `s.listen(${porta},hosts[i],()=>s.close(()=>{i++;proxima()}))})()`
  const resultado = spawnSync(process.execPath, ['-e', sonda], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    timeout: 5_000,
    windowsHide: true
  })
  return resultado.status === 0
}

/**
 * Cria a raiz do perfil do run com o diretório do Claude dentro. Um por run: dois runs nunca
 * dividem diretório gravável. Devolve `false` se o disco recusar.
 */
export function prepararPerfil(raiz: string): boolean {
  try {
    mkdirSync(join(raiz, 'claude'), { recursive: true })
    return true
  } catch {
    return false
  }
}

/**
 * Remove a raiz do perfil. O caminho vem do inventário (banco), não de quem chama, então só se
 * apaga o que **tem a forma** de um perfil de run (`FORMA_DA_RAIZ_DO_PERFIL`).
 */
export function removerPerfil(raiz: string): void {
  if (!isAbsolute(raiz) || !FORMA_DA_RAIZ_DO_PERFIL.test(raiz)) {
    throw new Error(`Recusado: ${raiz} não é a raiz do perfil de um run.`)
  }
  rmSync(raiz, { recursive: true, force: true })
}

/**
 * Descarta o que o sandbox deixou dentro do worktree antes de o agente rodar (`.gitmeta`). Não é
 * trabalho a preservar, e sem descartá-lo o Git recusaria remover todo worktree, até o que foi
 * commitado inteiro.
 */
export function descartarArtefatosDoSandbox(worktree: string): void {
  if (!isAbsolute(worktree) || !FORMA_DO_WORKTREE.test(worktree)) {
    throw new Error(`Recusado: ${worktree} não é o worktree de um run.`)
  }
  for (const artefato of ARTEFATOS_DO_SANDBOX) {
    rmSync(join(worktree, artefato), { recursive: true, force: true })
  }
}
