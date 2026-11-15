import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency } from '@azit/utils';
import { originacaoService, PropostaEspera } from '../services/originacao.service';
import { ativoService } from '../services/ativo.service';
import { StatusBadge } from '../components/StatusBadge';
import { Tabela, type Coluna } from '../components/Tabela';
import { Chips } from '../components/Chips';
import { Botao } from '../components/Botao';
import { Modal } from '../components/Modal';
import { Metrica } from '../components/Metrica';
import { toast } from '../components/Toast';
import { usePodeRole, ROLE_OPERACAO, mensagemErro } from '../lib/permissoes';
import { dataBR } from '../lib/datas';
import type { StatusColor } from '../config/statusColors';
import { LinkArea } from '../components/LinkArea';
import { AreaSistema } from '@azit/types';

// Lista de espera (doc 02 §31.3–29.4, decisão Luís 03/11): propostas APROVADAS
// por modelo de REFERÊNCIA (FIPE) enquanto não havia carro no estoque. Ordem:
// mais antiga primeiro (sugestão — o operador escolhe). Daqui o operador
// atribui um ativo disponível; a análise confere no dossiê; depois a proposta
// segue para resumo e contrato como qualquer outra.

const SITUACAO_COLORS: Record<string, StatusColor> = {
  'Na fila': { bg: 'var(--info-bg)', fg: 'var(--info-fg)' },
  'Veículo em conferência': { bg: 'var(--warn-bg)', fg: 'var(--warn-fg)' },
  'Pronta para contrato': { bg: 'var(--ok-bg)', fg: 'var(--ok-fg)' },
  'Aprovação vencida': { bg: 'var(--danger-bg)', fg: 'var(--danger-fg)' },
};
const SITUACOES = ['na_fila', 'em_conferencia', 'pronta', 'expirada'] as const;
const ROTULO: Record<string, string> = { na_fila: 'Na fila', em_conferencia: 'Veículo em conferência', pronta: 'Pronta para contrato', expirada: 'Aprovação vencida' };
const FREQ: Record<string, string> = { semanal: 'semanal', quinzenal: 'quinzenal', mensal: 'mensal' };

export function ListaEsperaPage() {
  const qc = useQueryClient();
  const pode = usePodeRole();
  const podeOperar = pode(ROLE_OPERACAO);
  const [filtro, setFiltro] = useState('');
  const [busca, setBusca] = useState('');
  const [alvo, setAlvo] = useState<PropostaEspera | null>(null);
  const [buscaAtivo, setBuscaAtivo] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const fila = useQuery({ queryKey: ['lista-espera'], queryFn: () => originacaoService.listaEspera() });
  const ativos = useQuery({
    queryKey: ['ativos-disponiveis-espera'],
    queryFn: () => ativoService.listar({ status: 'disponivel', tipo: 'veiculo' }),
    enabled: alvo !== null,
  });

  const itens = fila.data ?? [];
  const termo = busca.trim().toLowerCase();
  const porBusca = itens.filter((p) => !termo || p.titular.nome.toLowerCase().includes(termo) || (p.referencia?.rotulo ?? '').toLowerCase().includes(termo));
  const filtrados = porBusca.filter((p) => !filtro || p.situacao === filtro);

  // Sugestão de casamento: ativos do mesmo modelo da referência primeiro.
  const ativosOrdenados = useMemo(() => {
    const lista = (ativos.data?.data ?? []).filter((a) => a.status === 'disponivel');
    const t = buscaAtivo.trim().toLowerCase();
    const filtrada = t ? lista.filter((a) => `${a.descricao} ${a.placa ?? ''} ${a.marca ?? ''} ${a.modelo ?? ''}`.toLowerCase().includes(t)) : lista;
    const ref = alvo?.referencia;
    const casa = (a: { descricao: string; marca: string | null; modelo: string | null }) =>
      ref ? `${a.descricao} ${a.marca ?? ''} ${a.modelo ?? ''}`.toLowerCase().includes(ref.modelo.split(' ')[0].toLowerCase()) : false;
    return [...filtrada].sort((a, b) => Number(casa(b)) - Number(casa(a)));
  }, [ativos.data, buscaAtivo, alvo]);

  async function atribuir(ativoId: string) {
    if (!alvo) return;
    setOcupado(true);
    try {
      await originacaoService.atribuirVeiculo(alvo.id, ativoId);
      toast.sucesso('Veículo reservado — a análise foi avisada para conferir.');
      setAlvo(null);
      setBuscaAtivo('');
      await qc.invalidateQueries({ queryKey: ['lista-espera'] });
      await qc.invalidateQueries({ queryKey: ['ativos'] });
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function devolver(p: PropostaEspera) {
    if (!window.confirm(`Devolver ${p.ativo?.rotulo ?? 'o veículo'} ao estoque e voltar ${p.titular.nome} para a fila?`)) return;
    setOcupado(true);
    try {
      await originacaoService.conferirVeiculo(p.id, { confirmar: false, observacao: 'Devolvido pelo operador antes da conferência' });
      toast.sucesso('Veículo devolvido ao estoque.');
      await qc.invalidateQueries({ queryKey: ['lista-espera'] });
      await qc.invalidateQueries({ queryKey: ['ativos'] });
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  const totalFila = itens.filter((p) => p.situacao === 'na_fila' || p.situacao === 'expirada').length;
  const totalConferencia = itens.filter((p) => p.situacao === 'em_conferencia').length;
  const totalPronta = itens.filter((p) => p.situacao === 'pronta').length;

  const colunas: Coluna<PropostaEspera>[] = [
    {
      chave: 'cliente', titulo: 'Cliente', celular: 'titulo',
      render: (p) => (
        <div className="min-w-0">
          <div className="truncate font-bold" style={{ color: 'var(--text-primary)' }}>{p.titular.nome}</div>
          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>CPF {p.titular.cpfCnpj}</div>
        </div>
      ),
    },
    {
      chave: 'modelo', titulo: 'Modelo desejado', celular: 'subtitulo',
      render: (p) => (
        <div className="min-w-0">
          <div className="truncate" style={{ color: 'var(--text-primary)' }}>{p.referencia ? `${p.referencia.marca} ${p.referencia.modelo} ${p.referencia.anoModelo}` : '—'}</div>
          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{p.referencia ? `FIPE ${formatCurrency(p.referencia.valorFipe)} · ${p.referencia.fipeReferencia}` : ''}</div>
        </div>
      ),
    },
    {
      chave: 'condicao', titulo: 'Condição aprovada', celular: 'destaque', classe: 'tabular-nums',
      render: (p) => (
        <div>
          <div className="font-bold" style={{ color: 'var(--text-primary)' }}>{p.numeroParcelas}× {formatCurrency(p.valorParcela)}</div>
          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>entrada {formatCurrency(p.valorEntrada)}{p.frequencia ? ` · ${FREQ[p.frequencia] ?? p.frequencia}` : ''}{p.foraParametro ? ' · fora do parâmetro' : ''}</div>
        </div>
      ),
    },
    {
      chave: 'aprovacao', titulo: 'Aprovada em', celular: 'campo',
      render: (p) => (
        <div>
          <div style={{ color: 'var(--text-primary)' }}>{p.aprovadaEm ? dataBR(p.aprovadaEm) : '—'}</div>
          <div className="text-[11px]" style={{ color: p.diasRestantes !== null && p.diasRestantes <= 7 ? 'var(--danger-fg)' : 'var(--text-muted)' }}>
            {p.diasRestantes === null ? '' : p.diasRestantes < 0 ? `vencida há ${-p.diasRestantes} dia(s)` : `vale mais ${p.diasRestantes} dia(s)`}
          </div>
        </div>
      ),
    },
    {
      chave: 'situacao', titulo: 'Situação', celular: 'campo',
      render: (p) => (
        <div className="flex flex-col gap-[3px]">
          <StatusBadge label={ROTULO[p.situacao] ?? p.situacaoRotulo} colors={SITUACAO_COLORS} />
          {p.ativo && <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{p.ativo.rotulo}</span>}
          {p.ajuste && p.situacao !== 'na_fila' && (
            <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>parcela com o carro real {formatCurrency(p.ajuste.valorParcela)}</span>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-3">
        <Metrica label="Aguardando veículo" valor={String(totalFila)} detalhe="aprovados sem carro no estoque" />
        <Metrica label="Em conferência" valor={String(totalConferencia)} detalhe="carro reservado, análise confere" />
        <Metrica label="Prontas para contrato" valor={String(totalPronta)} detalhe="conferidas — seguir no atendimento" />
      </div>

      <div className="flex flex-wrap items-center gap-[8px]">
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar cliente ou modelo"
          aria-label="Buscar cliente ou modelo"
          className="min-h-[30px] min-w-[180px] flex-1 rounded-full border px-[12px] text-[12.5px] sm:max-w-[240px]"
          style={{ background: 'var(--surface)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}
        />
        <Chips
          itens={SITUACOES.map((s) => ({ chave: s, rotulo: ROTULO[s], contagem: porBusca.filter((p) => p.situacao === s).length }))}
          valor={filtro || null}
          onChange={(k) => setFiltro(k ?? '')}
          todos="Todas"
        />
      </div>

      <Tabela
        colunas={colunas}
        linhas={filtrados}
        chave={(p) => p.id}
        carregando={fila.isLoading}
        vazio={fila.isError ? mensagemErro(fila.error) : 'Ninguém na lista de espera. Propostas aprovadas por modelo de referência aparecem aqui.'}
        acoes={(p) => (
          <div className="flex flex-wrap gap-[6px]">
            <Link to={`/propostas/${p.id}`} className="flex h-[30px] items-center px-[8px] text-[12px] font-semibold hover:underline" style={{ color: 'var(--accent)' }}>Proposta</Link>
            {p.analiseId && (
              <LinkArea area={AreaSistema.ANALISE_CADASTRO} to={`/analises/${p.analiseId}`} className="flex h-[30px] items-center px-[8px] text-[12px] font-semibold hover:underline" style={{ color: 'var(--accent)' }}>Dossiê</LinkArea>
            )}
            {podeOperar && (p.situacao === 'na_fila' || p.situacao === 'expirada') && (
              <Botao variante="primaria" tamanho="sm" onClick={() => setAlvo(p)} disabled={ocupado}>Atribuir veículo</Botao>
            )}
            {podeOperar && p.situacao === 'em_conferencia' && (
              <Botao variante="secundaria" tamanho="sm" onClick={() => void devolver(p)} disabled={ocupado}>Devolver ao estoque</Botao>
            )}
          </div>
        )}
      />

      {/* Atribuir veículo (doc 02 §31.4 passos 1–3): escolhe um ativo disponível;
          o sistema reserva, recalcula com o carro real e avisa a análise. */}
      <Modal open={alvo !== null} onClose={() => { if (!ocupado) { setAlvo(null); setBuscaAtivo(''); } }} title={alvo ? `Atribuir veículo — ${alvo.titular.nome}` : ''} largura={620}>
        {alvo && (
          <div className="flex flex-col gap-[12px]">
            <div className="rounded-[10px] p-[10px] text-[12.5px]" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--text-body)' }}>
              Aprovado para <b>{alvo.referencia ? `${alvo.referencia.marca} ${alvo.referencia.modelo} ${alvo.referencia.anoModelo}` : 'modelo de referência'}</b>
              {alvo.referencia ? ` (FIPE ${formatCurrency(alvo.referencia.valorFipe)})` : ''} · {alvo.numeroParcelas}× {formatCurrency(alvo.valorParcela)} com entrada {formatCurrency(alvo.valorEntrada)}.
              {alvo.situacao === 'expirada' && <span className="block" style={{ color: 'var(--danger-fg)' }}>Aprovação vencida: ao atribuir, o sistema refaz a consulta de cadastro (Camada 1) antes de reservar.</span>}
              <span className="block" style={{ color: 'var(--text-muted)' }}>O carro fica reservado e a parcela é recalculada com o valor real; a análise confirma no dossiê.</span>
            </div>
            <input
              type="search"
              value={buscaAtivo}
              onChange={(e) => setBuscaAtivo(e.target.value)}
              placeholder="Buscar no estoque — modelo, placa"
              className="min-h-[34px] rounded-[10px] border px-[12px] text-[13px]"
              style={{ background: 'var(--surface-input)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}
              autoFocus
            />
            <div className="flex max-h-[360px] flex-col gap-[8px] overflow-y-auto">
              {ativos.isLoading ? (
                <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Carregando o estoque…</div>
              ) : ativosOrdenados.length === 0 ? (
                <div className="rounded-[10px] p-[12px] text-[13px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                  Nenhum veículo disponível{buscaAtivo ? ' com esse termo' : ' no estoque'}.
                </div>
              ) : (
                ativosOrdenados.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => void atribuir(a.id)}
                    disabled={ocupado || !a.valorVenda}
                    title={!a.valorVenda ? 'Sem valor de venda cadastrado — preencha na frota antes de atribuir' : 'Reservar este veículo para a proposta'}
                    className="flex items-center justify-between gap-[10px] rounded-[12px] p-[12px] text-left disabled:opacity-50"
                    style={{ background: 'var(--surface)', border: '1.5px solid var(--border)' }}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[14px] font-bold" style={{ color: 'var(--text-primary)' }}>{a.descricao}</div>
                      <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                        {a.placa ?? 'Sem placa'}{a.anoModelo ? ` · ${a.anoModelo}` : ''}{a.quilometragemEntrada != null ? ` · ${a.quilometragemEntrada.toLocaleString('pt-BR')} km` : ''}
                      </div>
                    </div>
                    <div className="whitespace-nowrap text-right text-[14px] font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                      {a.valorVenda ? formatCurrency(a.valorVenda) : 'sem valor'}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
