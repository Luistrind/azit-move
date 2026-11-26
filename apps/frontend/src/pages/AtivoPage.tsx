import { useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { formatCurrency } from '@azit/utils';
import { AreaSistema, rotuloStatusAtivo } from '@azit/types';
import { ativoService, type FiltroFrota, type LinhaFrota } from '../services/ativo.service';
import { StatusBadge } from '../components/StatusBadge';
import { ATIVO_STATUS_COLORS } from '../config/statusColors';
import { usePodeRole, ROLE_OPERACAO, mensagemErro, AREAS_ROTA_FICHA_TITULAR } from '../lib/permissoes';
import { toast } from '../components/Toast';
import { Tabela } from '../components/Tabela';
import { Botao } from '../components/Botao';
import { CartaoIndicador } from '../components/CartaoIndicador';
import { LinkArea } from '../components/LinkArea';
import { FormularioAtivo } from './ativo/FormularioAtivo';
import { AlertaPreparacao } from '../components/AlertaPreparacao';
import { BarraRetorno, ChipSituacao, COR_TOM, Placa, prazoDaPendencia } from './ativo/frota-ui';

// Frota e estoque (doc 02 §25.1 e §25.7, protótipo aprovado em 19/11/2026):
// indicadores que filtram no topo, e por veículo com quem está, pendências
// abertas e retornos gerados. Clicar na linha abre a ficha do veículo; a
// observação continua editável na própria linha (e agora fica auditada).

const POR_PAGINA = 20;
const inStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' };
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export function AtivoPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const pode = usePodeRole();
  const podeEditar = pode(ROLE_OPERACAO);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<FiltroFrota | null>(null);
  const [novo, setNovo] = useState(false);

  const resumo = useQuery({ queryKey: ['frota-resumo'], queryFn: () => ativoService.frotaResumo() });
  const lista = useInfiniteQuery({
    queryKey: ['frota', filtro, busca],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => ativoService.frota({ filtro: filtro ?? undefined, busca: busca.trim() || undefined, offset: pageParam, limit: POR_PAGINA }),
    getNextPageParam: (ultima) => (ultima.offset + ultima.data.length < ultima.total ? ultima.offset + ultima.data.length : undefined),
  });
  const linhas = lista.data?.pages.flatMap((p) => p.data) ?? [];
  const total = lista.data?.pages[0]?.total ?? 0;

  const recarregar = async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: ['frota'] }), qc.invalidateQueries({ queryKey: ['frota-resumo'] })]);
  };

  async function salvarObservacao(id: string, texto: string, anterior: string | null) {
    if (texto.trim() === (anterior ?? '').trim()) return;
    try {
      await ativoService.atualizar(id, { observacao: texto.trim() || null });
      await qc.invalidateQueries({ queryKey: ['frota'] });
      toast.sucesso('Observação salva.');
    } catch (e) {
      toast.erro(mensagemErro(e));
    }
  }

  const r = resumo.data;
  const n = (k: string) => r?.porStatus[k] ?? 0;
  // "Não mostra o que não existe": status sem nenhum veículo não vira cartão.
  const cartoes: { chave: FiltroFrota | null; rotulo: string; valor: number; detalhe: string; tom?: 'good' | 'bad' | 'warn' | 'neutro' }[] = r
    ? [
        { chave: null, rotulo: 'Todos', valor: r.total, detalhe: 'veículos na frota' },
        { chave: 'em_contrato', rotulo: 'Em contrato', valor: n('em_contrato'), detalhe: 'com cliente ativo' },
        { chave: 'disponivel', rotulo: 'Disponível', valor: n('disponivel'), detalhe: 'prontos para venda', tom: 'good' },
        ...(n('em_preparacao') ? [{ chave: 'em_preparacao' as const, rotulo: 'Em preparação', valor: n('em_preparacao'), detalhe: 'checklist antes da venda', tom: 'warn' as const }] : []),
        ...(n('reservado') ? [{ chave: 'reservado' as const, rotulo: 'Reservado', valor: n('reservado'), detalhe: 'lista de espera', tom: 'warn' as const }] : []),
        ...(n('sinistrado') ? [{ chave: 'sinistrado' as const, rotulo: 'Sinistrado', valor: n('sinistrado'), detalhe: 'sinistro registrado', tom: 'bad' as const }] : []),
        ...(n('transferido') ? [{ chave: 'transferido' as const, rotulo: 'Transferido', valor: n('transferido'), detalhe: 'quitado e transferido' }] : []),
        ...(n('recuperado') ? [{ chave: 'recuperado' as const, rotulo: 'Recuperado', valor: n('recuperado'), detalhe: 'retomado' }] : []),
        { chave: 'com_pendencia', rotulo: 'Com pendência', valor: r.comPendencia.veiculos, detalhe: r.comPendencia.valor ? `${formatCurrency(r.comPendencia.valor)} em aberto` : 'nenhuma multa em aberto', tom: r.comPendencia.veiculos ? 'warn' : 'neutro' },
      ]
    : [];

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex flex-wrap items-center gap-[12px]">
        <div className="min-w-0 flex-[1_1_320px] text-[12.5px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
          {r ? (
            <>
              {plural(r.total, 'veículo', 'veículos')} · {formatCurrency(r.investido)} investidos ·{' '}
              <b style={{ color: 'var(--text-primary)' }}>{formatCurrency(r.recebido)} em retornos gerados</b>
              {r.percentual !== null ? ` (${r.percentual}% do investido)` : ''}
            </>
          ) : 'Carregando…'}
        </div>
        <div className="flex flex-wrap gap-[8px]">
          <Link to="/frota/ocorrencias" className="inline-flex h-[36px] items-center gap-[8px] rounded-[10px] px-[14px] text-[12.5px] font-semibold" style={inStyle}>
            Multas e pendências
            {r && r.comPendencia.ocorrencias > 0 && (
              <span className="rounded-[6px] px-[7px] py-[1px] text-[11px] tabular-nums" style={{ background: 'var(--warn-bg)', color: 'var(--warn-fg)' }}>{r.comPendencia.ocorrencias}</span>
            )}
          </Link>
          {podeEditar && <Botao variante="primaria" onClick={() => setNovo(true)}>+ Novo veículo</Botao>}
        </div>
      </div>

      {/* Indicadores que filtram (no lugar dos botões de status). */}
      {cartoes.length > 0 && (
        <div className="grid grid-cols-2 gap-[10px] sm:grid-cols-3 lg:grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
          {cartoes.map((c) => (
            <CartaoIndicador
              key={c.chave ?? 'todos'}
              rotulo={c.rotulo}
              valor={c.valor}
              detalhe={c.detalhe}
              tom={c.tom}
              ativo={filtro === c.chave}
              onClick={() => setFiltro(c.chave)}
            />
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-[10px]">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar placa, chassi, modelo, cliente ou contrato"
          aria-label="Buscar placa, chassi, modelo, cliente ou contrato"
          className="h-[34px] min-w-0 flex-1 rounded-[10px] px-[10px] text-[12.5px] sm:max-w-[360px]"
          style={inStyle}
        />
        <span className="text-[12px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
          {lista.isLoading ? '' : `mostrando ${linhas.length} de ${total}`}
        </span>
      </div>

      <Tabela<LinhaFrota>
        colunas={[
          {
            chave: 'veiculo',
            titulo: 'Veículo',
            celular: 'titulo',
            render: (a) => (
              <span className="flex flex-col gap-[3px]">
                <b className="font-semibold" style={{ color: 'var(--text-primary)' }}>{a.descricao}</b>
                <span className="flex flex-wrap items-center gap-[6px] text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                  <Placa placa={a.placa} />
                  {[a.cor, a.anoFabricacao && a.anoModelo ? `${a.anoFabricacao}/${a.anoModelo}` : null].filter(Boolean).join(' · ')}
                </span>
              </span>
            ),
          },
          { chave: 'status', titulo: 'Status', celular: 'subtitulo', render: (a) => (
              <span className="flex flex-col items-start gap-[3px]">
                <StatusBadge label={rotuloStatusAtivo(a.status)} colors={ATIVO_STATUS_COLORS} />
                <AlertaPreparacao alerta={a.preparacao} compacto />
              </span>
            ) },
          {
            chave: 'cliente',
            titulo: 'Com quem está',
            render: (a) =>
              a.cliente && a.contrato ? (
                <span className="flex flex-col gap-[3px]">
                  <LinkArea area={AREAS_ROTA_FICHA_TITULAR} to={`/titulares/${a.cliente.id}`} onClick={(e) => e.stopPropagation()} className="font-semibold hover:underline" style={{ color: 'var(--text-primary)' }}>
                    {a.cliente.nome}
                  </LinkArea>
                  <span className="flex flex-wrap items-center gap-[6px] text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                    contrato {a.contrato.numero} <ChipSituacao s={a.contrato} />
                  </span>
                </span>
              ) : a.reserva ? (
                <span className="flex flex-col gap-[3px]">
                  <LinkArea area={AreaSistema.COMERCIAL} to="/lista-espera" onClick={(e) => e.stopPropagation()} className="font-semibold hover:underline" style={{ color: 'var(--text-primary)' }}>
                    {a.reserva.titularNome}
                  </LinkArea>
                  <span className="text-[11.5px]" style={{ color: 'var(--warn-fg)' }}>reservado · lista de espera</span>
                </span>
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>—</span>
              ),
          },
          {
            chave: 'pendencias',
            titulo: 'Pendências abertas',
            render: (a) => {
              if (!a.pendencias.quantidade) return <span style={{ color: 'var(--text-muted)' }}>nenhuma</span>;
              const prazo = prazoDaPendencia(a.pendencias.proximoPrazo);
              return (
                <span className="flex flex-col gap-[2px]">
                  <b className="font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{a.pendencias.quantidade} · {formatCurrency(a.pendencias.valor)}</b>
                  {prazo && <span className="text-[11.5px]" style={{ color: COR_TOM[prazo.tom] }}>{prazo.texto}</span>}
                </span>
              );
            },
          },
          {
            chave: 'retorno',
            titulo: 'Retornos gerados',
            alinhar: 'right',
            celular: 'destaque',
            render: (a) =>
              a.retorno.recebido > 0 ? (
                <span className="flex flex-col items-end gap-[4px]">
                  <b className="font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatCurrency(a.retorno.recebido)}</b>
                  {a.retorno.percentual !== null && (
                    <span className="flex items-center gap-[6px] text-[11.5px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
                      {a.retorno.percentual}% <BarraRetorno percentual={a.retorno.percentual} largura={56} />
                    </span>
                  )}
                </span>
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>—</span>
              ),
          },
          {
            chave: 'observacao',
            titulo: 'Observação',
            render: (a) =>
              podeEditar ? (
                <input
                  defaultValue={a.observacao ?? ''}
                  placeholder="escrever…"
                  title="Anotação livre: na oficina, aguardando documento…"
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => void salvarObservacao(a.id, e.target.value, a.observacao)}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  className="w-full min-w-[150px] rounded-[8px] px-[8px] py-[5px] text-[12px]"
                  style={inStyle}
                />
              ) : (
                <span style={{ color: 'var(--text-body)' }}>{a.observacao ?? '—'}</span>
              ),
          },
        ]}
        linhas={linhas}
        chave={(a) => a.id}
        carregando={lista.isLoading}
        larguraMinima={980}
        vazio={filtro || busca ? 'Nenhum veículo com esse filtro.' : 'Nenhum veículo cadastrado.'}
        onClick={(a) => navigate(`/ativos/${a.id}`)}
        acoes={(a) => <Botao variante="fantasma" tamanho="sm" onClick={() => navigate(`/ativos/${a.id}`)}>Ficha →</Botao>}
      />

      {lista.hasNextPage && (
        <div className="flex justify-center">
          <Botao variante="secundaria" tamanho="sm" carregando={lista.isFetchingNextPage} onClick={() => void lista.fetchNextPage()}>
            Carregar mais {Math.min(POR_PAGINA, total - linhas.length)} · faltam {total - linhas.length}
          </Botao>
        </div>
      )}

      {novo && (
        <FormularioAtivo
          onFechar={() => setNovo(false)}
          onSalvo={async (a) => {
            await recarregar();
            navigate(`/ativos/${a.id}`);
          }}
        />
      )}
    </div>
  );
}
