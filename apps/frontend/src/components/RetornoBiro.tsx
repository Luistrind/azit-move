import { useState } from 'react';

// Visualizador do retorno COMPLETO de uma consulta de birô (decisão 09/08):
// o "olho" abre uma JANELA GRANDE (≈ tela cheia — feedback 09/08: sem scroll
// lateral; valores quebram linha) com o retorno formatado como Atributo →
// Resultado, em tabelas aninhadas. Movimentações de processo ficam SEMPRE
// ocultas (só a contagem) — são longas e pouco úteis na análise.

const CHAVES_OCULTAS = [
  'movements', 'movimentacoes', 'movimentações', 'movimentos', 'andamentos',
  'updates', 'lawsuitupdates', 'petitions', 'peticoes', 'decisions', 'decisoes',
];

function ocultar(chave: string): boolean {
  const k = chave.toLowerCase().replace(/[^a-zà-ü]/g, '');
  return CHAVES_OCULTAS.some((c) => k === c.replace(/[^a-zà-ü]/g, ''));
}

// "TaxIdStatus" → "Tax Id Status"; "faixa_renda" → "Faixa renda".
function rotulo(chave: string): string {
  const solta = chave
    .replace(/_/g, ' ')
    .replace(/([a-zà-ü])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  return solta.charAt(0).toUpperCase() + solta.slice(1);
}

function valorSimples(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (v === true) return 'Sim';
  if (v === false) return 'Não';
  return String(v);
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function Tabela({ dados, nivel }: { dados: Record<string, unknown>; nivel: number }) {
  const entradas = Object.entries(dados);
  if (entradas.length === 0) return <div className="px-[8px] py-[4px] text-[12px] opacity-60">— vazio —</div>;
  return (
    <table className="w-full table-fixed border-collapse text-[12px]">
      <tbody>
        {entradas.map(([k, v]) => (
          <tr key={k} style={{ borderTop: '1px solid var(--border-light)' }}>
            <td className="w-[30%] break-words px-[8px] py-[5px] align-top font-semibold" style={{ color: 'var(--text-label)' }}>
              {rotulo(k)}
            </td>
            <td className="break-words px-[8px] py-[5px]">
              {ocultar(k) ? (
                <span className="opacity-60">
                  {Array.isArray(v) ? `${v.length} movimentação(ões) — ocultadas` : 'ocultado'}
                </span>
              ) : (
                <Valor v={v} nivel={nivel} />
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Valor({ v, nivel }: { v: unknown; nivel: number }) {
  if (Array.isArray(v)) {
    if (v.length === 0) return <span className="opacity-60">— nenhum —</span>;
    if (v.every((x) => !ehObjeto(x) && !Array.isArray(x))) {
      return <span className="break-words">{v.map(valorSimples).join(' · ')}</span>;
    }
    return (
      <div className="flex flex-col gap-[6px]">
        {v.map((item, i) => (
          <div key={i} className="rounded-[8px]" style={{ background: nivel % 2 ? 'var(--surface)' : 'var(--surface-input)', border: '1px solid var(--border-light)' }}>
            <div className="px-[8px] pt-[4px] text-[10.5px] font-bold opacity-60">#{i + 1}</div>
            {ehObjeto(item) ? <Tabela dados={item} nivel={nivel + 1} /> : <div className="break-words px-[8px] pb-[5px]">{valorSimples(item)}</div>}
          </div>
        ))}
      </div>
    );
  }
  if (ehObjeto(v)) {
    return (
      <div className="rounded-[8px]" style={{ background: nivel % 2 ? 'var(--surface)' : 'var(--surface-input)', border: '1px solid var(--border-light)' }}>
        <Tabela dados={v} nivel={nivel + 1} />
      </div>
    );
  }
  return <span className="break-words">{valorSimples(v)}</span>;
}

export function BotaoVerRetorno({ titulo, resultado }: { titulo: string; resultado: Record<string, unknown> | null }) {
  const [aberto, setAberto] = useState(false);
  if (!resultado || Object.keys(resultado).length === 0) return null;
  return (
    <>
      <button
        className="ml-[6px] inline-flex items-center gap-[4px] rounded-[7px] px-[8px] py-[2px] text-[11.5px] font-semibold"
        style={{ background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--navy)' }}
        title="Ver o retorno completo desta consulta"
        onClick={() => setAberto(true)}
      >
        👁 Ver retorno
      </button>
      {aberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-[16px]" style={{ background: 'rgba(0,16,41,.55)' }} onClick={() => setAberto(false)}>
          <div
            className="flex h-[92vh] w-[min(1100px,95vw)] flex-col overflow-hidden rounded-[14px]"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-[10px] px-[18px] py-[12px]" style={{ borderBottom: '1px solid var(--border)' }}>
              <div className="font-display text-[14px] font-bold">{titulo}</div>
              <button
                onClick={() => setAberto(false)}
                className="h-[32px] rounded-[8px] px-[12px] text-[13px] font-semibold"
                style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }}
              >
                Fechar ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto overflow-x-hidden px-[14px] py-[10px]">
              <Tabela dados={resultado} nivel={0} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
