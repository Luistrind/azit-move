import { useState } from 'react';
import { api } from '../lib/api';
import { mascararDinheiro, dinheiroParaCentavos } from '../lib/mascaras';
import { mensagemErro } from '../lib/permissoes';

// Proteção Veicular (Catálogo F5) — simulador interno da contribuição.
// ⚠️ Valores em HOMOLOGAÇÃO: enquanto o produto estiver em Rascunho no Catálogo,
// a simulação funciona para estudo, mas não há comercialização.

interface ResultadoSimulacao {
  statusProduto: string;
  comercializavel: boolean;
  statusValores: string | null;
  cobertura: string | null;
  vigenciaMeses: number;
  baseFipe: number;
  contribuicaoMensal: number;
  contribuicaoPeriodo: number;
}

const VARIANTES = [
  { v: 'leves', l: 'Leves' },
  { v: 'duas_rodas', l: 'Duas Rodas' },
  { v: 'utilitarios', l: 'Utilitários' },
];
const OFERTAS = [
  { v: 'essencial', l: 'Essencial (roubo e furto)' },
  { v: 'protecao', l: 'Proteção (roubo, furto e colisão)' },
  { v: 'completa', l: 'Completa (coberturas ampliadas e assistência)' },
];
const FREQUENCIAS = [
  { v: 'semanal', l: 'Semanal', por: 'por semana' },
  { v: 'quinzenal', l: 'Quinzenal', por: 'por quinzena' },
  { v: 'mensal', l: 'Mensal', por: 'por mês' },
];

const inputCls = 'h-[36px] w-full rounded-[8px] px-[10px] text-[13px]';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)' } as const;

function reais(c: number): string {
  return (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function ProtecaoPage() {
  const [variante, setVariante] = useState('leves');
  const [oferta, setOferta] = useState('essencial');
  const [frequencia, setFrequencia] = useState('semanal');
  const [fipeTexto, setFipeTexto] = useState('');
  const [resultado, setResultado] = useState<ResultadoSimulacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function simular() {
    setErro(null);
    setOcupado(true);
    try {
      const { data } = await api.post<ResultadoSimulacao>('/api/v1/catalogo/protecao/simular', {
        variante,
        oferta,
        frequencia,
        fipe: dinheiroParaCentavos(fipeTexto),
      });
      setResultado(data);
    } catch (e) {
      setErro(mensagemErro(e));
      setResultado(null);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-[14px] p-[24px]">
      <div>
        <h1 className="font-display text-[20px] font-bold">Proteção veicular — simulação</h1>
        <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
          Contribuição = máximo entre a mínima da variante e a tabela FIPE × taxa da oferta,
          mais administração e assistência. Os valores vêm do Catálogo.
        </p>
      </div>

      <div className="flex flex-col gap-[10px] rounded-[14px] p-[16px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <label className="flex flex-col gap-[4px] text-[12px] font-semibold">
          Variante do veículo
          <select value={variante} onChange={(e) => setVariante(e.target.value)} className={inputCls} style={inputStyle}>
            {VARIANTES.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-[4px] text-[12px] font-semibold">
          Valor na tabela FIPE (R$)
          <input value={fipeTexto} onChange={(e) => setFipeTexto(mascararDinheiro(e.target.value))} inputMode="numeric" placeholder="50.000,00" className={inputCls} style={inputStyle} />
        </label>
        <label className="flex flex-col gap-[4px] text-[12px] font-semibold">
          Oferta
          <select value={oferta} onChange={(e) => setOferta(e.target.value)} className={inputCls} style={inputStyle}>
            {OFERTAS.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-[4px] text-[12px] font-semibold">
          Frequência de pagamento
          <select value={frequencia} onChange={(e) => setFrequencia(e.target.value)} className={inputCls} style={inputStyle}>
            {FREQUENCIAS.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}
          </select>
        </label>
        <button
          onClick={simular}
          disabled={ocupado || dinheiroParaCentavos(fipeTexto) <= 0}
          className="h-[40px] rounded-[10px] text-[13px] font-bold disabled:opacity-40"
          style={{ background: 'var(--navy)', color: '#fff' }}
        >
          {ocupado ? 'Calculando…' : 'Calcular contribuição'}
        </button>
        {erro && <div className="rounded-[8px] p-[8px] text-[12px]" style={{ background: '#fdecec', color: '#a12622' }}>{erro}</div>}
      </div>

      {resultado && (
        <div className="flex flex-col gap-[8px] rounded-[14px] p-[16px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="font-display text-[26px] font-extrabold" style={{ color: 'var(--navy)' }}>
            {reais(resultado.contribuicaoPeriodo)}
            <span className="ml-[6px] text-[14px] font-semibold" style={{ color: 'var(--text-muted)' }}>
              {FREQUENCIAS.find((f) => f.v === frequencia)?.por}
            </span>
          </div>
          <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
            Contribuição mensal {reais(resultado.contribuicaoMensal)} · FIPE × taxa = {reais(resultado.baseFipe)} ·
            vigência {resultado.vigenciaMeses} meses{resultado.cobertura ? ` · cobertura: ${resultado.cobertura}` : ''}
          </div>
          {!resultado.comercializavel && (
            <div className="rounded-[8px] p-[8px] text-[12px] font-semibold" style={{ background: '#fff3d6', color: '#8a5a00' }}>
              Produto em {resultado.statusProduto === 'RASCUNHO' ? 'rascunho' : resultado.statusProduto.toLowerCase()} —
              {' '}{resultado.statusValores ?? 'valores em homologação'}. Simulação para estudo, sem comercialização.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
