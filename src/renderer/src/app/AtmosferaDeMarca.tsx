/**
 * Atmosfera das superfícies de marca — fundo carbono com Ken Burns, véu radial, brilho diagonal e
 * pontos pulsantes.
 *
 * Extraída da `TelaLogin` (#57) para ser reusada pela `TelaChoice` (#69): login e CHOICE são a
 * mesma classe de tela (superfície de marca, sempre escura) e desenham o **mesmo** fundo no
 * protótipo. Duplicar a camada faria as duas divergirem no primeiro ajuste; um componente só as
 * mantém em acordo.
 *
 * Tudo `aria-hidden` — é atmosfera, não informação. Cada camada sob `motion-safe`, então
 * `prefers-reduced-motion` entrega a mesma composição **estática** (não uma tela vazia): o fundo
 * é a identidade da marca, e removê-lo junto com o movimento puniria quem pediu menos movimento
 * com menos design.
 */
export function AtmosferaDeMarca({ imagem }: { readonly imagem: string }): React.JSX.Element {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <img
        src={imagem}
        alt=""
        draggable={false}
        // 112% e offset de -6%: o `kb` faz zoom e pan, e a sobra evita que a borda da imagem
        // entre em quadro no fim do ciclo.
        className="absolute -left-[6%] -top-[6%] h-[112%] w-[112%] object-cover motion-safe:animate-[kb_28s_ease-in-out_infinite_alternate]"
        style={{ filter: 'brightness(.62) contrast(1.08)' }}
      />
      {/* Véu radial: escurece as bordas para o conteúdo ganhar o centro sem competir com a textura. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at 50% 46%, rgba(6,7,8,0) 0%, rgba(6,7,8,.55) 58%, rgba(6,7,8,.92) 100%)'
        }}
      />
      <div
        className="absolute inset-y-0 w-[46%] motion-safe:animate-[sheen_9s_ease-in-out_infinite]"
        style={{
          background:
            'linear-gradient(100deg, rgba(200,204,212,0) 20%, rgba(200,204,212,.05) 50%, rgba(200,204,212,0) 80%)'
        }}
      />
      {/* Três pontos em ciclos primos entre si — nunca pulsam juntos, que é o que os faz ler
          como sinais independentes em vez de uma animação só. */}
      <span className="absolute left-[18%] top-[24%] size-[3px] rounded-full bg-[rgba(200,204,212,.7)] motion-safe:animate-[dotpulse_3.2s_ease-in-out_infinite]" />
      <span className="absolute right-[22%] top-[64%] size-[2px] rounded-full bg-[var(--jos-cor-acento)] opacity-80 motion-safe:animate-[dotpulse_4.1s_ease-in-out_infinite]" />
      <span className="absolute right-[30%] top-[18%] size-[2px] rounded-full bg-[rgba(200,204,212,.5)] motion-safe:animate-[dotpulse_5s_ease-in-out_infinite]" />
    </div>
  )
}
