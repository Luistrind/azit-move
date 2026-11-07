import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { formatCurrency } from '@azit/utils';
import { originacaoService, type SimulacaoResumo } from '../services/originacao.service';
import { StatusBadge } from '../components/StatusBadge';
import { Tabela, type Coluna } from '../components/Tabela';
import { Botao } from '../components/Botao';
import { PROPOSTA_STATUS_COLORS } from '../config/statusColors';
import { ROTULO_SITUACAO_PROPOSTA as LABEL_STATUS } from '../lib/rotulos';

// Lista de simulações (layout v2, doc 03 §11): grade responsiva pela <Tabela>;
// no celular cada simulação vira um cartão (cliente, ativo, valor à vista).
export function SimulacoesPage() {
  const navigate = useNavigate();
  const sims = useQuery({ queryKey: ['simulacoes'], queryFn: () => originacaoService.listarSimulacoes() });
  // Busca livre (pedido Luís 05/11): cliente, ativo (placa/modelo) ou situação, sem acento.
  const [busca, setBusca] = useState('');
  const normalizar = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const termos = normalizar(busca.trim()).split(/\s+/).filter(Boolean);
  const linhas = (sims.data ?? []).filter((s) => {
    if (!termos.length) return true;
    const alvo = normalizar([s.cliente, s.ativo, s.status, s.propostaStatus ?? ''].join(' '));
    return termos.every((t) => alvo.includes(t));
  });

  const podeContinuar = (s: SimulacaoResumo) => !['convertida', 'cancelada', 'expirada'].includes(s.status);
  const ir = (s: SimulacaoResumo) => {
    if (s.propostaId) navigate(`/propostas/${s.propostaId}`);
    // Retomada no funil (correção 14/09: apontava para /originacao,
    // rota que nunca existiu — Application Error 404 do router).
    else if (podeContinuar(s)) navigate(`/atendimento?simulacao=${s.id}`);
  };

  const colunas: Coluna<SimulacaoResumo>[] = [
    { chave: 'cliente', titulo: 'Cliente', celular: 'titulo', render: (s) => s.cliente },
    { chave: 'ativo', titulo: 'Ativo', celular: 'subtitulo', render: (s) => s.ativo },
    { chave: 'avista', titulo: 'À vista', alinhar: 'right', celular: 'destaque', classe: 'tabular-nums', render: (s) => formatCurrency(s.valorAvista) },
    {
      chave: 'oferta',
      titulo: 'Oferta escolhida',
      alinhar: 'center',
      classe: 'tabular-nums',
      render: (s) => (s.ofertaEscolhida ? `${s.ofertaEscolhida.numeroParcelas}× ${formatCurrency(s.ofertaEscolhida.valorParcela)} (${s.ofertaEscolhida.frequencia})` : '—'),
    },
    {
      chave: 'situacao',
      titulo: 'Situação',
      render: (s) => (
        <span
          className="rounded-[6px] px-[8px] py-[3px] text-[11px] font-bold"
          style={
            s.status === 'expirada'
              ? { background: 'var(--danger-bg)', color: 'var(--danger-fg)' }
              : s.status === 'convertida'
                ? { background: 'var(--ok-bg)', color: 'var(--ok-fg)' }
                : { background: 'var(--surface-input)', color: 'var(--text-body)' }
          }
        >
          {s.status}
        </span>
      ),
    },
    {
      chave: 'proposta',
      titulo: 'Proposta',
      render: (s) =>
        s.propostaStatus ? (
          <StatusBadge label={LABEL_STATUS[s.propostaStatus] ?? s.propostaStatus} colors={PROPOSTA_STATUS_COLORS} />
        ) : podeContinuar(s) ? (
          <span className="text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>Continuar →</span>
        ) : (
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>—</span>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-wrap items-center justify-between gap-[8px]">
        <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>Simulações são exploratórias; a escolhida vira proposta.</div>
        <div className="flex flex-wrap items-center gap-[8px]">
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar cliente, placa, modelo ou situação"
            aria-label="Buscar simulação"
            className="h-[34px] w-full min-w-0 rounded-[10px] px-[10px] text-[12.5px] sm:w-[280px]"
            style={{ background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
          />
          <Botao variante="primaria" onClick={() => navigate('/atendimento')}>+ Novo atendimento</Botao>
        </div>
      </div>
      <Tabela
        colunas={colunas}
        linhas={linhas}
        chave={(s) => s.id}
        onClick={ir}
        carregando={sims.isLoading}
        vazio={busca.trim() ? 'Nenhuma simulação encontrada para a busca.' : 'Nenhuma simulação.'}
      />
    </div>
  );
}
