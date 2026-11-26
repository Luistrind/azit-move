import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { formatCurrency } from '@azit/utils';
import { rotuloStatusAtivo, StatusContratoCredito } from '@azit/types';
import { ativoService, type FichaVeiculo } from '../../services/ativo.service';
import { centroCustoService } from '../../services/centro-custo.service';
import { frotaService, type Ocorrencia } from '../../services/frota.service';
import { Abas } from '../../components/Abas';
import { rotuloTipoCusto } from '../../components/CustosRecuperacao';
import { Botao } from '../../components/Botao';
import { Modal } from '../../components/Modal';
import { StatusBadge } from '../../components/StatusBadge';
import { Tabela } from '../../components/Tabela';
import { LinkArea } from '../../components/LinkArea';
import { toast } from '../../components/Toast';
import { acoesDaOcorrencia, ModalAcaoOcorrencia, ModalNovaOcorrencia, ocorrenciaAberta, rotuloDaObservacao, type AcaoOcorrencia } from '../../components/ocorrencia/AcoesOcorrencia';
import { ATIVO_STATUS_COLORS, CONTRATO_STATUS_COLORS, OCORRENCIA_STATUS_COLORS, RESPONSAVEL_OCORRENCIA_COLORS } from '../../config/statusColors';
import { AREAS_ROTA_CONTRATO, AREAS_ROTA_FICHA_TITULAR, mensagemErro, ROLE_OPERACAO, usePodeRole } from '../../lib/permissoes';
import { dataBR, dataMistaBR, instanteBR } from '../../lib/datas';
import { reaisParaCentavos } from '../../lib/valor';
import { FormularioAtivo } from './FormularioAtivo';
import { PreparacaoVeiculo } from './PreparacaoVeiculo';
import { BarraRetorno, Chip, ChipSituacao, COR_TOM, Placa, prazoDaPendencia } from './frota-ui';

// Ficha do veículo (doc 02 §25.7, protótipo aprovado em 19/11/2026): com quem
// está, pendências abertas e retornos gerados no topo; multas, custos,
// contratos e cadastro em abas. Tudo calculado — nada aqui grava status.

const TIPO_CUSTO: Record<string, string> = {
  manutencao: 'Manutenção', documentacao: 'Documentação', preparacao: 'Preparação', seguro: 'Seguro', franquia: 'Franquia', multa: 'Multa', ipva: 'IPVA', licenciamento: 'Licenciamento', outro: 'Outro',
};
const DOC_TIPOS: { v: string; l: string }[] = [
  { v: 'crlv', l: 'CRLV / documento' },
  { v: 'nota_fiscal', l: 'Nota fiscal' },
  { v: 'laudo', l: 'Laudo' },
  { v: 'outro', l: 'Outro' },
];
// Leitura das ocorrências é da operação de frota (mesmos papéis do quadro).
const ROLE_LER_OCORRENCIAS = ['ADMIN', 'DIRETOR', 'OPERADOR'];
const rotulo = 'text-[10.5px] font-semibold uppercase tracking-[0.08em]';
const inStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' } as const;
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const faseContrato = (s: string) => StatusContratoCredito[s.toUpperCase() as keyof typeof StatusContratoCredito] ?? s;

function Coluna({ titulo, destaque, children }: { titulo: string; destaque: ReactNode; children: ReactNode }) {
  return (
    <div
      className="flex min-w-0 flex-col gap-[4px] p-[18px] [&:not(:first-child)]:border-t md:[&:not(:first-child)]:border-l md:[&:not(:first-child)]:border-t-0"
      style={{ borderColor: 'var(--border-light)' }}
    >
      <div className={rotulo} style={{ color: 'var(--text-label)' }}>{titulo}</div>
      {destaque}
      <div className="flex flex-col gap-[3px] text-[12.5px]" style={{ color: 'var(--text-body)' }}>{children}</div>
    </div>
  );
}

const Destaque = ({ children, cor }: { children: ReactNode; cor?: string }) => (
  <div className="font-display text-[20px] font-semibold leading-[1.2] tabular-nums" style={{ color: cor ?? 'var(--text-primary)' }}>{children}</div>
);

function Hoje({ f }: { f: FichaVeiculo }) {
  const q = f.comQuemEsta;
  const prazo = prazoDaPendencia(f.pendencias.proximoPrazo);
  const r = f.retorno;
  return (
    <div className="grid grid-cols-1 md:grid-cols-[1.1fr_1fr_1.1fr]">
      <Coluna
        titulo="Com quem está"
        destaque={
          q ? (
            <Destaque>
              <LinkArea area={AREAS_ROTA_FICHA_TITULAR} to={`/titulares/${q.titular.id}`} className="hover:underline" style={{ color: 'var(--text-primary)' }}>{q.titular.nome}</LinkArea>
            </Destaque>
          ) : f.ativo.reserva ? (
            <Destaque>{f.ativo.reserva.titularNome}</Destaque>
          ) : (
            <Destaque cor="var(--text-muted)">Ninguém</Destaque>
          )
        }
      >
        {q ? (
          <>
            <span>
              Contrato{' '}
              <LinkArea area={AREAS_ROTA_CONTRATO} to={`/contratos/${q.contrato.id}`} className="font-semibold hover:underline" style={{ color: 'var(--text-primary)' }}>{q.contrato.numero}</LinkArea>
              {q.contrato.desde ? ` · desde ${dataMistaBR(q.contrato.desde)}` : ''}
            </span>
            <span className="mt-[4px] flex flex-wrap items-center gap-[6px]">
              <ChipSituacao s={q} />
              {q.situacao !== 'bloqueada' && q.bloqueioDisponivel && <span className="text-[11.5px] font-semibold" style={{ color: 'var(--danger-fg)' }}>bloqueio disponível pela régua</span>}
              {q.bloqueadoEm && <span className="text-[11.5px]">desde {dataMistaBR(q.bloqueadoEm)}</span>}
            </span>
          </>
        ) : f.ativo.reserva ? (
          <span>reservado pela lista de espera desde {dataMistaBR(f.ativo.reserva.em)}</span>
        ) : (
          <span>{f.ativo.status === 'disponivel' ? 'Disponível para venda.' : `Status: ${rotuloStatusAtivo(f.ativo.status)}.`}</span>
        )}
      </Coluna>

      <Coluna titulo="Pendências abertas" destaque={<Destaque cor={f.pendencias.quantidade ? undefined : 'var(--text-muted)'}>{f.pendencias.quantidade ? formatCurrency(f.pendencias.valor) : 'Nenhuma'}</Destaque>}>
        {f.pendencias.quantidade ? (
          <>
            <span><b style={{ color: 'var(--text-primary)' }}>{plural(f.pendencias.quantidade, 'ocorrência', 'ocorrências')}</b> esperando desfecho</span>
            {prazo && <span className="font-semibold" style={{ color: COR_TOM[prazo.tom] }}>{prazo.texto}</span>}
          </>
        ) : (
          <span>Nenhuma multa ou pendência em aberto.</span>
        )}
      </Coluna>

      <Coluna
        titulo="Retornos gerados"
        destaque={
          <Destaque>
            {formatCurrency(r.recebido)}
            {r.percentual !== null && <span className="ml-[6px] text-[12.5px] font-medium" style={{ color: 'var(--text-body)' }}>{r.percentual}% do investido</span>}
          </Destaque>
        }
      >
        {r.percentual !== null && <span className="my-[4px]"><BarraRetorno percentual={r.percentual} /></span>}
        <span className="tabular-nums">{r.investido ? `Investido: ${formatCurrency(r.investido)} (aquisição e custos)` : 'Sem valor de aquisição cadastrado.'}</span>
        {r.aReceber > 0 && <span className="tabular-nums">A receber nos contratos: {formatCurrency(r.aReceber)}</span>}
      </Coluna>
    </div>
  );
}

function Observacao({ f, podeEditar, onSalvo }: { f: FichaVeiculo; podeEditar: boolean; onSalvo: () => Promise<void> }) {
  async function salvar(texto: string) {
    if (texto.trim() === (f.observacao.texto ?? '').trim()) return;
    try {
      await ativoService.atualizar(f.ativo.id, { observacao: texto.trim() || null });
      await onSalvo();
      toast.sucesso('Observação salva.');
    } catch (e) {
      toast.erro(mensagemErro(e));
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-[10px] px-[18px] pb-[14px] pt-[12px]" style={{ borderTop: '1px solid var(--border-light)' }}>
      <span className={rotulo} style={{ color: 'var(--text-label)' }}>Observação</span>
      {podeEditar ? (
        <input
          key={f.observacao.texto ?? ''}
          defaultValue={f.observacao.texto ?? ''}
          placeholder="Anotação livre: na oficina, aguardando documento…"
          onBlur={(e) => void salvar(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          className="h-[32px] min-w-0 flex-[1_1_260px] rounded-[8px] px-[10px] text-[12.5px]"
          style={inStyle}
        />
      ) : (
        <span className="min-w-0 flex-1 text-[12.5px]" style={{ color: 'var(--text-body)' }}>{f.observacao.texto ?? '—'}</span>
      )}
      {f.observacao.alteradaEm && (
        <span className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
          alterada{f.observacao.alteradaPor ? ` por ${f.observacao.alteradaPor}` : ''} em {instanteBR(f.observacao.alteradaEm)} · fica no histórico
        </span>
      )}
    </div>
  );
}

function AbaPendencias({ ativoId, podeOperar, onMudou }: { ativoId: string; podeOperar: boolean; onMudou: () => Promise<void> }) {
  const lista = useQuery({ queryKey: ['ocorrencias', 'ativo', ativoId], queryFn: () => frotaService.ocorrencias({ ativoId }) });
  const [aberta, setAberta] = useState<string | null>(null);
  const [acao, setAcao] = useState<{ tipo: AcaoOcorrencia; o: Ocorrencia } | null>(null);
  // Abertas primeiro, depois as encerradas, mais recentes no topo.
  const itens = [...(lista.data ?? [])].sort((a, b) => Number(ocorrenciaAberta(b)) - Number(ocorrenciaAberta(a)) || b.dataFato.localeCompare(a.dataFato));

  return (
    <>
      <Tabela<Ocorrencia>
        semMoldura
        colunas={[
          {
            chave: 'ocorrencia',
            titulo: 'Ocorrência',
            render: (o) => (
              <span className="flex flex-col gap-[2px]">
                <b className="font-semibold" style={{ color: 'var(--text-primary)' }}>{o.tipoRotulo}</b>
                <span className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>{[o.numeroAuto, o.orgao].filter(Boolean).join(' · ') || o.descricao || '—'}</span>
              </span>
            ),
          },
          {
            chave: 'fato',
            titulo: 'Data do fato',
            classe: 'tabular-nums',
            render: (o) => (
              <span className="flex flex-col gap-[2px]">
                {dataBR(o.dataFato)}
                <span className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>{o.contrato ? `no contrato ${o.contrato.numero}` : 'fora de contrato'}</span>
              </span>
            ),
          },
          {
            chave: 'responsavel',
            titulo: 'Responsável',
            render: (o) => <Chip texto={o.responsavel === 'CLIENTE' ? 'cliente' : 'Azit'} cor={RESPONSAVEL_OCORRENCIA_COLORS[o.responsavel]} />,
          },
          { chave: 'valor', titulo: 'Valor', alinhar: 'right', celular: 'destaque', classe: 'tabular-nums font-semibold', render: (o) => formatCurrency(o.valorComDesconto ?? o.valor) },
          {
            chave: 'prazo',
            titulo: 'Prazo',
            render: (o) => {
              if (!ocorrenciaAberta(o)) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
              const candidatos = [
                o.dataVencimento ? { tipo: 'vencimento' as const, data: o.dataVencimento.slice(0, 10) } : null,
                o.status === 'REGISTRADA' && o.prazoIndicacao ? { tipo: 'indicacao' as const, data: o.prazoIndicacao.slice(0, 10) } : null,
                o.status === 'AGUARDANDO_COMPROVANTE' && o.prazoComprovante ? { tipo: 'comprovante' as const, data: o.prazoComprovante.slice(0, 10) } : null,
              ].filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => a.data.localeCompare(b.data));
              const p = prazoDaPendencia(candidatos[0] ?? null);
              return p ? <span className="text-[12px]" style={{ color: COR_TOM[p.tom] }}>{p.texto}</span> : <span style={{ color: 'var(--text-muted)' }}>—</span>;
            },
          },
          { chave: 'etapa', titulo: 'Etapa', render: (o) => <Chip texto={o.repasse ? `Cobrada na fatura nº ${o.repasse.faturaNumero}` : o.statusRotulo} cor={OCORRENCIA_STATUS_COLORS[o.status]} /> },
        ]}
        linhas={itens}
        chave={(o) => o.id}
        carregando={lista.isLoading}
        larguraMinima={860}
        vazio="Nenhuma multa ou pendência registrada para este veículo."
        onClick={(o) => setAberta(aberta === o.id ? null : o.id)}
        // O botão da linha também evita botão dentro de botão no cartão de celular.
        acoes={(o) => (
          <Botao variante="fantasma" tamanho="sm" onClick={() => setAberta(aberta === o.id ? null : o.id)}>
            {aberta === o.id ? 'fechar' : podeOperar && ocorrenciaAberta(o) ? 'decidir' : 'ver'}
          </Botao>
        )}
        expandida={(o) => {
          if (aberta !== o.id) return null;
          const botoes = acoesDaOcorrencia(o, podeOperar);
          return (
            <div className="flex flex-col gap-[8px] text-[12.5px]" style={{ color: 'var(--text-body)' }}>
              {ocorrenciaAberta(o) ? (
                <>
                  <span className={rotulo} style={{ color: 'var(--text-label)' }}>O que fazer com esta ocorrência</span>
                  {o.desfechoObs && <span style={{ color: 'var(--text-muted)' }}>{rotuloDaObservacao(o)}: {o.desfechoObs}</span>}
                </>
              ) : (
                <span>{o.desfechoEm ? `Encerrada em ${dataMistaBR(o.desfechoEm)}` : 'Encerrada'}{o.desfechoObs ? ` · ${o.desfechoObs}` : ''}</span>
              )}
              {botoes.length > 0 && (
                <div className="flex flex-wrap gap-[8px]">
                  {botoes.map((b) => <Botao key={b.acao} variante={b.variante} tamanho="sm" onClick={() => setAcao({ tipo: b.acao, o })}>{b.rotulo}</Botao>)}
                </div>
              )}
              {o.temComprovante && <div><Botao variante="secundaria" tamanho="sm" onClick={() => frotaService.abrirComprovante(o.id)}>Ver comprovante</Botao></div>}
              <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                {o.contrato
                  ? <>Responsável calculado pela data do fato: {dataBR(o.dataFato)} está dentro do contrato {o.contrato.numero}, de <LinkArea area={AREAS_ROTA_FICHA_TITULAR} to={`/titulares/${o.contrato.titular.id}`} className="font-semibold hover:underline" style={{ color: 'var(--text-primary)' }}>{o.contrato.titular.nome}</LinkArea>.</>
                  : <>A data do fato ({dataBR(o.dataFato)}) não está dentro de nenhum contrato: responsabilidade da Azit.</>}
                {o.responsavelJustificativa ? ` Responsável alterado: ${o.responsavelJustificativa}.` : ''}
                {o.repasse ? ` Cobrada na fatura nº ${o.repasse.faturaNumero}, com vencimento em ${dataBR(o.repasse.vencimento)}.` : ''}
              </span>
            </div>
          );
        }}
      />
      {acao && (
        <ModalAcaoOcorrencia
          acao={acao.tipo}
          o={acao.o}
          onFechar={() => setAcao(null)}
          onFeito={async () => {
            await lista.refetch();
            await onMudou();
          }}
        />
      )}
    </>
  );
}

function AbaCustos({ f, podeOperar, onMudou }: { f: FichaVeiculo; podeOperar: boolean; onMudou: () => Promise<void> }) {
  const c = f.custos;
  type Linha = { id: string; titulo: string; detalhe: string; data: string | null; origem: string; valor: number; removivel: boolean };
  const linhas: Linha[] = [
    { id: 'aquisicao', titulo: 'Aquisição', detalhe: f.ativo.origem ? `compra do veículo · ${f.ativo.origem}` : 'compra do veículo', data: null, origem: 'cadastro do veículo', valor: c.aquisicao, removivel: false },
    ...c.lancamentos.map((l) => ({
      id: l.id,
      titulo: TIPO_CUSTO[l.tipo] ?? rotuloTipoCusto(l.tipo),
      // Custo da recuperação (doc 02 §29.3): orçado ainda não soma no total investido.
      detalhe: `${l.descricao}${l.orcado ? ' · orçado, ainda não soma no total' : ''}`,
      data: l.data,
      origem: l.contrato
        ? `custo da recuperação · contrato ${l.contrato.numero} · ${l.repassadoAoCliente ? 'repassado ao cliente' : 'Azit assume'}`
        : l.origem?.rotulo ?? '—',
      valor: l.valor,
      // Custo de multa assumida desfaz-se na ocorrência; custo da recuperação, na ficha do contrato.
      removivel: l.origem?.tipo !== 'ocorrencia' && !l.contrato,
    })),
  ];

  async function remover(id: string) {
    try {
      await centroCustoService.removerLancamento(id);
      // (custo de multa assumida não tem "Remover": desfaz-se reabrindo a ocorrência)
      await onMudou();
      toast.sucesso('Lançamento removido.');
    } catch (e) {
      toast.erro(mensagemErro(e));
    }
  }

  return (
    <>
      <Tabela<Linha>
        semMoldura
        colunas={[
          {
            chave: 'lancamento',
            titulo: 'Lançamento',
            render: (l) => (
              <span className="flex flex-col gap-[2px]">
                <b className="font-semibold" style={{ color: 'var(--text-primary)' }}>{l.titulo}</b>
                <span className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>{l.detalhe}</span>
              </span>
            ),
          },
          { chave: 'data', titulo: 'Data', classe: 'tabular-nums', render: (l) => (l.data ? dataMistaBR(l.data) : '—') },
          { chave: 'origem', titulo: 'De onde veio', render: (l) => l.origem },
          { chave: 'valor', titulo: 'Valor', alinhar: 'right', celular: 'destaque', classe: 'tabular-nums font-semibold', render: (l) => (l.id === 'aquisicao' && !l.valor ? 'não cadastrado' : formatCurrency(l.valor)) },
        ]}
        linhas={linhas}
        chave={(l) => l.id}
        larguraMinima={680}
        acoes={podeOperar ? (l) => (l.removivel ? <Botao variante="fantasma" tamanho="sm" onClick={() => void remover(l.id)} title="Remover lançamento">Remover</Botao> : null) : undefined}
      />
      <div className="flex flex-wrap items-center justify-between gap-[8px] px-[18px] py-[12px] text-[12.5px]" style={{ borderTop: '1px solid var(--border-light)' }}>
        <span style={{ color: 'var(--text-muted)' }}>Multa que a Azit assume e custos da recuperação entram aqui sozinhos. Custo da recuperação se altera na ficha do contrato.</span>
        <b className="tabular-nums" style={{ color: 'var(--text-primary)' }}>Total investido: {formatCurrency(c.totalInvestido)}</b>
      </div>
    </>
  );
}

function AbaContratos({ f }: { f: FichaVeiculo }) {
  return (
    <Tabela<FichaVeiculo['contratos'][number]>
      semMoldura
      colunas={[
        {
          chave: 'contrato',
          titulo: 'Contrato',
          render: (c) => (
            <LinkArea area={AREAS_ROTA_CONTRATO} to={`/contratos/${c.contratoId}`} className="font-semibold hover:underline" style={{ color: 'var(--text-primary)' }}>{c.numero}</LinkArea>
          ),
        },
        {
          chave: 'cliente',
          titulo: 'Cliente',
          render: (c) => (
            <LinkArea area={AREAS_ROTA_FICHA_TITULAR} to={`/titulares/${c.titularId}`} className="hover:underline" style={{ color: 'var(--text-primary)' }}>{c.titular}</LinkArea>
          ),
        },
        { chave: 'periodo', titulo: 'Período', classe: 'tabular-nums', render: (c) => (c.inicio ? `${dataMistaBR(c.inicio)} → ${c.fim ? dataMistaBR(c.fim) : 'em vigor'}` : 'não começou') },
        { chave: 'recebido', titulo: 'Recebido', alinhar: 'right', celular: 'destaque', classe: 'tabular-nums font-semibold', render: (c) => formatCurrency(c.entradaPaga + c.parcelasPagas) },
        { chave: 'aberto', titulo: 'A receber', alinhar: 'right', classe: 'tabular-nums', render: (c) => (c.emAberto ? formatCurrency(c.emAberto) : '—') },
        { chave: 'status', titulo: 'Status', render: (c) => <StatusBadge label={faseContrato(c.status)} colors={CONTRATO_STATUS_COLORS} /> },
      ]}
      linhas={f.contratos}
      chave={(c) => c.contratoId}
      larguraMinima={760}
      vazio="Este veículo ainda não teve contrato."
    />
  );
}

function Dado({ rotulo: r, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className={rotulo} style={{ color: 'var(--text-label)' }}>{r}</span>
      <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{children}</span>
    </div>
  );
}

function AbaCadastro({ f, podeOperar, onEditar }: { f: FichaVeiculo; podeOperar: boolean; onEditar: () => void }) {
  const a = f.ativo;
  const qc = useQueryClient();
  const docs = useQuery({ queryKey: ['ativo-documentos', a.id], queryFn: () => ativoService.documentos(a.id) });
  const [docTipo, setDocTipo] = useState('crlv');
  const [anexando, setAnexando] = useState(false);

  async function anexar(file: File) {
    setAnexando(true);
    try {
      const conteudo = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      await ativoService.anexarDocumento(a.id, { tipo: docTipo, nome: file.name, conteudo });
      await qc.invalidateQueries({ queryKey: ['ativo-documentos', a.id] });
      toast.sucesso('Documento anexado.');
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setAnexando(false);
    }
  }
  async function remover(id: string) {
    try {
      await ativoService.removerDocumento(id);
      await qc.invalidateQueries({ queryKey: ['ativo-documentos', a.id] });
    } catch (e) {
      toast.erro(mensagemErro(e));
    }
  }

  return (
    <div className="grid grid-cols-1 gap-[24px] p-[18px] lg:grid-cols-[1.6fr_1fr]">
      <div className="flex min-w-0 flex-col gap-[12px]">
        <div className="flex items-center justify-between gap-[8px]">
          <span className={rotulo} style={{ color: 'var(--text-label)' }}>Dados do veículo</span>
          {podeOperar && <Botao variante="secundaria" tamanho="sm" onClick={onEditar}>Editar cadastro</Botao>}
        </div>
        <div className="grid grid-cols-2 gap-x-[18px] gap-y-[12px] text-[12.5px] md:grid-cols-4">
          <Dado rotulo="Marca / modelo">{[a.marca, a.modelo].filter(Boolean).join(' ') || '—'}</Dado>
          <Dado rotulo="Ano">{a.anoFabricacao && a.anoModelo ? `${a.anoFabricacao} / ${a.anoModelo}` : a.anoModelo ?? '—'}</Dado>
          <Dado rotulo="Cor">{a.cor ?? '—'}</Dado>
          <Dado rotulo="Combustível">{a.combustivel ?? '—'}</Dado>
          <Dado rotulo="Chassi">{a.chassi ?? '—'}</Dado>
          <Dado rotulo="RENAVAM">{a.renavam ?? '—'}</Dado>
          <Dado rotulo="Origem">{a.origem ?? '—'}</Dado>
          <Dado rotulo="Km na entrada">{a.quilometragemEntrada?.toLocaleString('pt-BR') ?? '—'}</Dado>
          <Dado rotulo="Valor de aquisição">{a.valorAquisicao ? formatCurrency(a.valorAquisicao) : '—'}</Dado>
          <Dado rotulo="Valor de venda">{a.valorVenda ? formatCurrency(a.valorVenda) : '—'}</Dado>
          <Dado rotulo="Referência FIPE">{a.fipe ? [a.fipe.modelo, a.fipe.referencia].filter(Boolean).join(' · ') : '—'}</Dado>
          <Dado rotulo="Oferta fixa">{a.ofertaFixa?.nome ?? '—'}</Dado>
          <Dado rotulo="Dono">{a.estruturaJuridica?.nome ?? 'sem estrutura — vincular'}</Dado>
          <div className="col-span-2 md:col-span-3">
            <Dado rotulo="Status">
              {rotuloStatusAtivo(a.status)}{' '}
              <span className="font-normal" style={{ color: 'var(--text-muted)' }}>— automático: muda com o contrato, a reserva e o sinistro; só a preparação para venda (acima) entra e sai por ação</span>
            </Dado>
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-[8px]">
        <div className="flex flex-wrap items-center justify-between gap-[8px]">
          <span className={rotulo} style={{ color: 'var(--text-label)' }}>Documentos {docs.data ? `· ${docs.data.length}` : ''}</span>
          {podeOperar && (
            <span className="flex flex-wrap items-center gap-[6px]">
              <select value={docTipo} onChange={(e) => setDocTipo(e.target.value)} className="h-[30px] rounded-[10px] px-[8px] text-[12px]" style={inStyle} aria-label="Tipo do documento">
                {DOC_TIPOS.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
              </select>
              <label className="inline-flex h-[30px] cursor-pointer items-center rounded-[10px] px-[11px] text-[12px] font-semibold" style={{ background: 'var(--accent)', color: 'var(--navy)', opacity: anexando ? 0.6 : 1 }}>
                {anexando ? 'Anexando…' : '+ Anexar'}
                <input type="file" className="hidden" disabled={anexando} onChange={(e) => { const file = e.target.files?.[0]; if (file) void anexar(file); e.target.value = ''; }} />
              </label>
            </span>
          )}
        </div>
        {docs.data?.length === 0 && <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Nenhum documento anexado.</span>}
        {docs.data?.map((d) => (
          <div key={d.id} className="flex items-center justify-between gap-[10px] py-[8px] text-[12.5px]" style={{ borderBottom: '1px solid var(--border-light)' }}>
            <span className="min-w-0">
              <b style={{ color: 'var(--text-primary)' }}>{DOC_TIPOS.find((t) => t.v === d.tipo)?.l ?? d.tipo}</b> · <span className="break-all">{d.nome}</span>
              <span className="block text-[11.5px]" style={{ color: 'var(--text-muted)' }}>anexado em {instanteBR(d.anexadoEm)}</span>
            </span>
            <span className="flex flex-none items-center gap-[6px]">
              <Botao variante="secundaria" tamanho="sm" onClick={() => ativoService.baixarDocumento(d.id, d.nome).catch((e) => toast.erro(mensagemErro(e)))}>Baixar</Botao>
              {podeOperar && <Botao variante="fantasma" tamanho="sm" onClick={() => void remover(d.id)}>Remover</Botao>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ModalLancarCusto({ ativoId, onFechar, onFeito }: { ativoId: string; onFechar: () => void; onFeito: () => Promise<void> }) {
  const [f, setF] = useState({ tipo: 'manutencao', descricao: '', valor: '', data: '' });
  const [ocupado, setOcupado] = useState(false);
  const cls = 'w-full rounded-[10px] px-[10px] py-[7px] text-[13px]';
  async function lancar() {
    setOcupado(true);
    try {
      await centroCustoService.criarLancamento(ativoId, {
        tipo: f.tipo,
        descricao: f.descricao.trim(),
        valor: reaisParaCentavos(f.valor),
        data: f.data ? new Date(f.data).toISOString() : undefined,
      });
      toast.sucesso('Custo lançado.');
      await onFeito();
      onFechar();
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }
  return (
    <Modal open onClose={onFechar} title="Lançar custo do veículo">
      <div className="flex flex-col gap-[10px] text-[12.5px]">
        <p style={{ color: 'var(--text-muted)' }}>O custo soma no investido do veículo e muda o percentual de retornos gerados.</p>
        <label className="flex flex-col gap-[4px]">Tipo
          <select className={cls} style={inStyle} value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
            {['manutencao', 'preparacao', 'documentacao', 'seguro', 'franquia', 'outro'].map((t) => <option key={t} value={t}>{TIPO_CUSTO[t]}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-[4px]">Descrição
          <input className={cls} style={inStyle} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} placeholder="Ex.: troca de bateria" />
        </label>
        <div className="grid grid-cols-2 gap-[10px]">
          <label className="flex flex-col gap-[4px]">Valor (R$)
            <input className={cls} style={inStyle} inputMode="decimal" value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} placeholder="1.234,56" />
          </label>
          <label className="flex flex-col gap-[4px]">Data
            <input type="date" className={cls} style={inStyle} value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} />
          </label>
        </div>
        <div className="flex flex-wrap justify-end gap-[8px]">
          <Botao variante="secundaria" tamanho="sm" onClick={onFechar}>Cancelar</Botao>
          <Botao variante="primaria" tamanho="sm" carregando={ocupado} disabled={f.descricao.trim().length < 2 || reaisParaCentavos(f.valor) <= 0} onClick={() => void lancar()}>Lançar</Botao>
        </div>
      </div>
    </Modal>
  );
}

export function FichaVeiculoPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pode = usePodeRole();
  const podeOperar = pode(ROLE_OPERACAO);
  const podeVerOcorrencias = pode(ROLE_LER_OCORRENCIAS);
  const ficha = useQuery({ queryKey: ['ficha-veiculo', id], queryFn: () => ativoService.ficha(id), enabled: !!id });
  const [aba, setAba] = useState<string>(podeVerOcorrencias ? 'pendencias' : 'custos');
  const [editar, setEditar] = useState(false);
  const [novaOcorrencia, setNovaOcorrencia] = useState(false);
  const [lancarCusto, setLancarCusto] = useState(false);

  const recarregar = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['ficha-veiculo', id] }),
      qc.invalidateQueries({ queryKey: ['frota'] }),
      qc.invalidateQueries({ queryKey: ['frota-resumo'] }),
      qc.invalidateQueries({ queryKey: ['ocorrencias'] }),
    ]);
  };

  if (ficha.isLoading) return <div className="py-[40px] text-center text-[12.5px]" style={{ color: 'var(--text-muted)' }}>Carregando a ficha do veículo…</div>;
  if (ficha.isError || !ficha.data) {
    return (
      <div className="flex flex-col items-center gap-[10px] py-[40px] text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
        {mensagemErro(ficha.error)}
        <Link to="/ativos" className="font-semibold" style={{ color: 'var(--accent)' }}>← Voltar para a frota</Link>
      </div>
    );
  }
  const f = ficha.data;
  const a = f.ativo;
  const abas = [
    ...(podeVerOcorrencias ? [{ chave: 'pendencias', rotulo: 'Multas e pendências', contagem: f.pendencias.quantidade || undefined }] : []),
    { chave: 'custos', rotulo: 'Custos', contagem: f.custos.lancamentos.length + 1 },
    { chave: 'contratos', rotulo: 'Contratos', contagem: f.contratos.length },
    { chave: 'cadastro', rotulo: 'Cadastro e documentos' },
  ];

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex flex-wrap items-center gap-[12px]">
        <Botao variante="secundaria" tamanho="sm" onClick={() => navigate('/ativos')}>← Frota</Botao>
        <div className="min-w-0 flex-[1_1_280px]">
          <h1 className="flex flex-wrap items-center gap-[8px] font-display text-[20px] font-bold" style={{ color: 'var(--text-primary)', textWrap: 'balance' }}>
            {a.descricao} <Placa placa={a.placa} /> <StatusBadge label={rotuloStatusAtivo(a.status)} colors={ATIVO_STATUS_COLORS} />
          </h1>
          <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            {[a.cor, a.combustivel, a.quilometragemEntrada ? `entrou com ${a.quilometragemEntrada.toLocaleString('pt-BR')} km` : null, a.estruturaJuridica ? `dono: ${a.estruturaJuridica.nome}` : null].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div className="flex flex-wrap gap-[8px]">
          {podeOperar && podeVerOcorrencias && <Botao variante="primaria" onClick={() => setNovaOcorrencia(true)}>+ Nova ocorrência</Botao>}
          {podeOperar && <Botao variante="secundaria" onClick={() => setLancarCusto(true)}>+ Lançar custo</Botao>}
        </div>
      </div>

      <section className="overflow-hidden rounded-card" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <Hoje f={f} />
        <Observacao f={f} podeEditar={podeOperar} onSalvo={recarregar} />
      </section>

      <PreparacaoVeiculo ativoId={a.id} status={a.status} ehVeiculo={a.tipo === 'veiculo'} preparacao={f.preparacao} podeOperar={podeOperar} onMudou={recarregar} />

      <section className="overflow-hidden rounded-card" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <Abas itens={abas} valor={aba} onChange={setAba} />
        {aba === 'pendencias' && podeVerOcorrencias && <AbaPendencias ativoId={a.id} podeOperar={podeOperar} onMudou={recarregar} />}
        {aba === 'custos' && <AbaCustos f={f} podeOperar={podeOperar} onMudou={recarregar} />}
        {aba === 'contratos' && <AbaContratos f={f} />}
        {aba === 'cadastro' && <AbaCadastro f={f} podeOperar={podeOperar} onEditar={() => setEditar(true)} />}
      </section>

      {editar && <FormularioAtivo ativo={a} onFechar={() => setEditar(false)} onSalvo={recarregar} />}
      {novaOcorrencia && <ModalNovaOcorrencia placa={a.placa} onFechar={() => setNovaOcorrencia(false)} onFeito={recarregar} />}
      {lancarCusto && <ModalLancarCusto ativoId={a.id} onFechar={() => setLancarCusto(false)} onFeito={recarregar} />}
    </div>
  );
}
