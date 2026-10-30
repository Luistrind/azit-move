import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { formatCurrency } from '@azit/utils';
import { VezAprovacao } from '@azit/types';
import { aprovacaoService, Aprovacao } from '../services/aprovacao.service';
import { StatusBadge } from '../components/StatusBadge';
import { Tabela, type Coluna } from '../components/Tabela';
import { Chips } from '../components/Chips';
import { Metrica } from '../components/Metrica';
import { esperaDesde, instanteCurtoBR } from '../lib/datas';
import { motivosDe, resumoDecisoes, tituloHumano } from '../lib/aprovacao';
import {
  APROVACAO_STATUS_COLORS,
  APROVACAO_STATUS_LABEL,
  TOM_DOSSIE_FG,
  VEZ_APROVACAO_COLORS,
  VEZ_APROVACAO_LABEL,
} from '../config/statusColors';

// Fila parada: acima de 2 dias a espera fica em alerta (protótipo de 14/10).
const ESPERA_ALERTA_HORAS = 48;
// "Minhas para decidir": o que depende de quem está olhando.
const VEZ_MINHA = new Set<string>([VezAprovacao.DECIDIR, VezAprovacao.RECOMENDAR, VezAprovacao.RESPONDER_COMPLEMENTO]);

// Central única de aprovações (Doc 2 §7.9-A) — LISTA (protótipo de 14/10,
// implementado em 21/10): tipo, pedido em uma frase, com quem é a operação,
// valor, quem pediu, espera, decisões e de quem é a vez. A linha abre o
// dossiê (/aprovacoes/:id) — aprovar às cegas não é aprovar.
// Layout v2 (doc 03 §11, 30/10): indicadores clicáveis filtram a fila; abas e
// filtros são Chips; a grade é a Tabela responsiva.
export function AprovacoesPage() {
  const navigate = useNavigate();
  const [aba, setAba] = useState<'pendentes' | 'historico'>('pendentes');
  const [escopo, setEscopo] = useState<'minhas' | 'todas' | null>(null); // null = automático
  const [filtroTipo, setFiltroTipo] = useState('');

  const pendentes = useQuery({ queryKey: ['aprovacoes-pendentes'], queryFn: () => aprovacaoService.pendentes() });
  const historico = useQuery({ queryKey: ['aprovacoes-historico'], queryFn: () => aprovacaoService.historico(), enabled: aba === 'historico' });

  const lista = (aba === 'pendentes' ? pendentes.data : historico.data) ?? [];
  const minhas = (pendentes.data ?? []).filter((a) => a.minha.vez && VEZ_MINHA.has(a.minha.vez));
  const escopoEfetivo = aba === 'historico' ? 'todas' : (escopo ?? (minhas.length > 0 ? 'minhas' : 'todas'));
  const tipos = useMemo(() => Array.from(new Set(lista.map((a) => a.tipoOperacaoNome))).sort(), [lista]);
  const filtrada = lista
    .filter((a) => escopoEfetivo === 'todas' || (a.minha.vez && VEZ_MINHA.has(a.minha.vez)))
    .filter((a) => !filtroTipo || a.tipoOperacaoNome === filtroTipo);
  const carregando = aba === 'pendentes' ? pendentes.isLoading : historico.isLoading;

  const maisAntiga = (pendentes.data ?? []).reduce<string | null>((min, a) => (!min || a.solicitadoEm < min ? a.solicitadoEm : min), null);
  const esperaMaisAntiga = maisAntiga ? esperaDesde(maisAntiga) : null;
  const pendente = aba === 'pendentes';

  const colunas: Coluna<Aprovacao>[] = [
    {
      chave: 'tipo',
      titulo: 'Tipo',
      celular: 'subtitulo',
      render: (a) => (
        <span className="whitespace-nowrap rounded-[6px] px-[8px] py-[2px] text-[10.5px] font-bold uppercase tracking-[.04em]" style={{ background: 'var(--surface-input)', color: 'var(--text-label)' }}>
          {a.tipoOperacaoNome}
        </span>
      ),
    },
    {
      chave: 'pedido',
      titulo: 'Pedido',
      celular: 'titulo',
      render: (a) => {
        const motivos = motivosDe(a);
        return (
          <>
            <div className="font-bold" style={{ color: 'var(--text-primary)' }}>{tituloHumano(a.resumo)}</div>
            {motivos.length > 0 && (
              <div className="mt-[2px] text-[11.5px] font-normal" style={{ color: TOM_DOSSIE_FG.atencao }}>⚠ {motivos[0]}{motivos.length > 1 ? ` (+${motivos.length - 1})` : ''}</div>
            )}
          </>
        );
      },
    },
    { chave: 'contraparte', titulo: 'Titular / fornecedor', celular: 'campo', render: (a) => a.contraparte?.nome ?? '—' },
    { chave: 'valor', titulo: 'Valor', alinhar: 'right', celular: 'destaque', classe: 'whitespace-nowrap font-bold tabular-nums', render: (a) => formatCurrency(a.valor) },
    { chave: 'solicitante', titulo: 'Solicitante', celular: 'campo', render: (a) => a.solicitante },
    {
      chave: 'espera',
      titulo: pendente ? 'Espera' : 'Pedido em',
      celular: 'campo',
      classe: 'whitespace-nowrap text-[11.5px]',
      render: (a) => {
        if (!pendente) return <span style={{ color: 'var(--text-muted)' }}>{instanteCurtoBR(a.solicitadoEm)}</span>;
        const espera = esperaDesde(a.solicitadoEm);
        return <span style={espera.horas >= ESPERA_ALERTA_HORAS ? { color: TOM_DOSSIE_FG.alerta, fontWeight: 700 } : { color: 'var(--text-muted)' }}>{espera.texto}</span>;
      },
    },
    {
      chave: 'decisoes',
      titulo: 'Decisões',
      celular: 'campo',
      classe: 'text-[11.5px]',
      render: (a) => (
        <span style={{ color: 'var(--text-muted)' }}>
          {resumoDecisoes(a)}
          {a.complementoAberto && <div style={{ color: TOM_DOSSIE_FG.atencao }}>complemento pedido · aguardando resposta</div>}
        </span>
      ),
    },
    {
      chave: 'vez',
      titulo: pendente ? 'Sua vez?' : 'Resultado',
      celular: 'campo',
      render: (a) => {
        if (!pendente) return <StatusBadge label={APROVACAO_STATUS_LABEL[a.status] ?? a.status} colors={APROVACAO_STATUS_COLORS} />;
        const vez = a.minha.vez ? VEZ_APROVACAO_LABEL[a.minha.vez] : null;
        return vez ? <StatusBadge label={vez} colors={VEZ_APROVACAO_COLORS} /> : '—';
      },
    },
  ];

  return (
    <div className="flex flex-col gap-[14px]">
      {/* Indicadores da fila — "todo dado é link": clicar filtra a lista. */}
      <div className="grid grid-cols-1 gap-[8px] sm:grid-cols-3">
        <Metrica
          tom="kpi"
          label="Pendentes"
          valor={pendentes.data ? String(pendentes.data.length) : '—'}
          detalhe="aguardando alguma decisão"
          onClick={() => { setAba('pendentes'); setEscopo('todas'); setFiltroTipo(''); }}
          ativo={pendente && escopoEfetivo === 'todas'}
        />
        <Metrica
          tom="kpi"
          label="Dependem de você"
          valor={pendentes.data ? String(minhas.length) : '—'}
          detalhe={minhas.length === 1 ? 'decisão, recomendação ou resposta' : 'decisões, recomendações ou respostas'}
          alerta={minhas.length > 0}
          onClick={() => { setAba('pendentes'); setEscopo('minhas'); setFiltroTipo(''); }}
          ativo={pendente && escopoEfetivo === 'minhas'}
        />
        <Metrica
          tom="kpi"
          label="Mais antiga espera há"
          valor={pendentes.data ? (esperaMaisAntiga?.texto ?? '—') : '—'}
          detalhe={esperaMaisAntiga ? (esperaMaisAntiga.horas >= ESPERA_ALERTA_HORAS ? 'fila parada há mais de 2 dias' : 'dentro do prazo esperado') : 'nenhuma pendente'}
          alerta={!!esperaMaisAntiga && esperaMaisAntiga.horas >= ESPERA_ALERTA_HORAS}
        />
      </div>

      <div className="flex flex-wrap items-center gap-[8px]">
        <Chips
          todos={null}
          valor={aba}
          onChange={(v) => { setAba((v as 'pendentes' | 'historico') ?? 'pendentes'); setFiltroTipo(''); }}
          itens={[
            { chave: 'pendentes', rotulo: 'Pendentes', contagem: pendentes.data?.length },
            { chave: 'historico', rotulo: 'Histórico' },
          ]}
        />
        {pendente && (
          <>
            <span className="hidden h-[18px] w-px sm:block" style={{ background: 'var(--border)' }} />
            <Chips
              todos={null}
              tamanho="sm"
              valor={escopoEfetivo}
              onChange={(v) => setEscopo((v as 'minhas' | 'todas') ?? 'todas')}
              itens={[
                { chave: 'minhas', rotulo: 'Minhas para decidir', contagem: minhas.length },
                { chave: 'todas', rotulo: 'Todas' },
              ]}
            />
          </>
        )}
        {tipos.length > 1 && (
          <>
            <span className="hidden h-[18px] w-px sm:block" style={{ background: 'var(--border)' }} />
            <Chips
              todos="Todos os tipos"
              tamanho="sm"
              valor={filtroTipo || null}
              onChange={(v) => setFiltroTipo(v ?? '')}
              itens={tipos.map((t) => ({ chave: t, rotulo: t, contagem: lista.filter((a) => a.tipoOperacaoNome === t).length }))}
            />
          </>
        )}
      </div>

      <Tabela
        colunas={colunas}
        linhas={filtrada}
        chave={(a) => a.id}
        carregando={carregando}
        onClick={(a) => navigate(`/aprovacoes/${a.id}`)}
        larguraMinima={980}
        vazio={
          aba === 'historico'
            ? 'Sem histórico ainda.'
            : escopoEfetivo === 'minhas'
              ? 'Nada depende de você agora — veja "Todas" para acompanhar a fila.'
              : 'Nenhuma solicitação aguardando aprovação.'
        }
      />
    </div>
  );
}
