import { useState } from 'react';
import { Modal } from './Modal';

// Visualizador do retorno COMPLETO de uma consulta de birô (decisão 09/08):
// o "olho" na linha da consulta abre o retorno formatado como Atributo →
// Resultado (tabelas aninhadas, no espírito do painel da BigDataCorp) — nada
// de JSON cru na cara do operador, mas tudo acessível.

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
  if (entradas.length === 0) return <div className="text-[12px] opacity-60">— vazio —</div>;
  return (
    <table className="w-full border-collapse text-[12px]">
      <tbody>
        {entradas.map(([k, v]) => (
          <tr key={k} style={{ borderTop: '1px solid var(--border-light)' }}>
            <td className="w-[38%] px-[8px] py-[5px] align-top font-semibold" style={{ color: 'var(--text-label)' }}>
              {rotulo(k)}
            </td>
            <td className="px-[8px] py-[5px]">
              <Valor v={v} nivel={nivel} />
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
      return <span>{v.map(valorSimples).join(' · ')}</span>;
    }
    return (
      <div className="flex flex-col gap-[6px]">
        {v.map((item, i) => (
          <div key={i} className="rounded-[8px]" style={{ background: nivel % 2 ? 'var(--surface)' : 'var(--surface-input)', border: '1px solid var(--border-light)' }}>
            <div className="px-[8px] pt-[4px] text-[10.5px] font-bold opacity-60">#{i + 1}</div>
            {ehObjeto(item) ? <Tabela dados={item} nivel={nivel + 1} /> : <div className="px-[8px] pb-[5px]">{valorSimples(item)}</div>}
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
  return <span>{valorSimples(v)}</span>;
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
        <Modal open onClose={() => setAberto(false)} title={titulo}>
          <div className="max-h-[65vh] overflow-y-auto pr-[4px]">
            <Tabela dados={resultado} nivel={0} />
          </div>
        </Modal>
      )}
    </>
  );
}
