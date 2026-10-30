import { useState } from 'react';
import { api } from '../lib/api';
import { mascararDinheiro, dinheiroParaCentavos } from '../lib/mascaras';
import { mensagemErro } from '../lib/permissoes';
import { Bloco } from '../components/Bloco';
import { Botao } from '../components/Botao';

// Proteção Veicular (Catálogo F5) — simulador interno da contribuição.
// ⚠️ Valores em HOMOLOGAÇÃO: enquanto o produto estiver em Rascunho no Catálogo,
// a simulação funciona para estudo, mas não há comercialização.
// Layout v2 (doc 03 §11): formulário e resultado em <Bloco>; o resultado tem a
// contribuição como número-herói e a composição na Leitura.

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

const inputCls = 'h-[36px] w-full rounded-[10px] px-[10px] text-[13px]';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' } as const;
const lblCls = 'flex flex-col gap-[4px] text-[12px] font-semibold';
const lblStyle = { color: 'var(--text-label)' } as const;

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
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-[14px]">
      <p className="m-0 text-[13px]" style={{ color: 'var(--text-muted)' }}>
        Contribuição = máximo entre a mínima da variante e a tabela FIPE × taxa da oferta,
        mais administração e assistência. Os valores vêm do Catálogo.
      </p>

      <Bloco titulo="Simulação">
        <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-2">
          <label className={lblCls} style={lblStyle}>
            Variante do veículo
            <select value={variante} onChange={(e) => setVariante(e.target.value)} className={inputCls} style={inputStyle}>
              {VARIANTES.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}
            </select>
          </label>
          <label className={lblCls} style={lblStyle}>
            Valor na tabela FIPE (R$)
            <input value={fipeTexto} onChange={(e) => setFipeTexto(mascararDinheiro(e.target.value))} inputMode="numeric" placeholder="50.000,00" className={inputCls} style={inputStyle} />
          </label>
          <label className={lblCls} style={lblStyle}>
            Oferta
            <select value={oferta} onChange={(e) => setOferta(e.target.value)} className={inputCls} style={inputStyle}>
              {OFERTAS.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}
            </select>
          </label>
          <label className={lblCls} style={lblStyle}>
            Frequência de pagamento
            <select value={frequencia} onChange={(e) => setFrequencia(e.target.value)} className={inputCls} style={inputStyle}>
              {FREQUENCIAS.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}
            </select>
          </label>
        </div>
        <Botao variante="primaria" className="w-full" onClick={simular} disabled={ocupado || dinheiroParaCentavos(fipeTexto) <= 0}>
          {ocupado ? 'Calculando…' : 'Calcular contribuição'}
        </Botao>
        {erro && <div className="rounded-[10px] p-[8px] text-[12px]" style={{ background: 'var(--danger-bg)', color: 'var(--danger-fg)' }}>{erro}</div>}
      </Bloco>

      {resultado && (
        <Bloco
          titulo="Contribuição"
          tag={FREQUENCIAS.find((f) => f.v === frequencia)?.l}
          leitura={<>Contribuição mensal <b>{reais(resultado.contribuicaoMensal)}</b> · FIPE × taxa = {reais(resultado.baseFipe)} · vigência {resultado.vigenciaMeses} meses{resultado.cobertura ? ` · cobertura: ${resultado.cobertura}` : ''}</>}
        >
          <div className="font-display text-[30px] font-bold leading-[1.1] tracking-[-0.02em] tabular-nums" style={{ color: 'var(--text-primary)' }}>
            {reais(resultado.contribuicaoPeriodo)}
            <span className="ml-[6px] text-[14px] font-semibold" style={{ color: 'var(--text-muted)' }}>
              {FREQUENCIAS.find((f) => f.v === frequencia)?.por}
            </span>
          </div>
          {!resultado.comercializavel && (
            <div className="rounded-[10px] p-[8px] text-[12px] font-semibold" style={{ background: 'var(--warn-bg)', color: 'var(--warn-ink)' }}>
              Produto em {resultado.statusProduto === 'RASCUNHO' ? 'rascunho' : resultado.statusProduto.toLowerCase()} —
              {' '}{resultado.statusValores ?? 'valores em homologação'}. Simulação para estudo, sem comercialização.
            </div>
          )}
        </Bloco>
      )}
    </div>
  );
}
