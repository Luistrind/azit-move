import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { formatCurrency, mensagemDeAcordoReembolso } from '@azit/utils';
import { titularService } from '../services/titular.service';
import { faturaService } from '../services/fatura.service';
import { originacaoService } from '../services/originacao.service';
import { creditoService } from '../services/credito.service';
import { financeiroService } from '../services/financeiro.service';
import { catalogoService } from '../services/catalogo.service';
import { reguaService } from '../services/regua.service';
import { reaisParaCentavos } from '../lib/valor';
import { mensagemErro, usePodeRole, ROLE_OPERACAO, AREAS_ROTA_CONTRATO, useIrParaArea } from '../lib/permissoes';
import { StatusBadge } from '../components/StatusBadge';
import { Modal } from '../components/Modal';
import { BotaoVerRetorno } from '../components/RetornoBiro';
import { RenegociacaoWizard } from '../components/RenegociacaoWizard';
import { NovacaoDecomposicaoModal } from '../components/NovacaoDecomposicao';
import { toast } from '../components/Toast';
import { CONTRATO_STATUS_COLORS, SITUACAO_CONTRATO_COLORS, SITUACAO_CONTRATO_LABEL, CONTA_SITUACAO_COLORS, CONTA_SITUACAO_LABEL } from '../config/statusColors';
import { Campo } from '../components/Metrica';
import { DocumentoViewer, useDocumentoViewer } from '../components/DocumentoViewer';
import { Tabela } from '../components/Tabela';
import { Botao } from '../components/Botao';
import { Secao } from '../components/Secao';
import { Abas } from '../components/Abas';
import { PosicaoHoje } from './titular/PosicaoHoje';
import { FaturasDaConta } from './titular/FaturasDaConta';
import { PagamentosDaConta } from './titular/PagamentosDaConta';
import { LembretesPagamento } from '../components/LembretesPagamento';

// Ficha do titular (doc 02 §33, redesenho de 18/11): a tela responde primeiro
// "como está este cliente HOJE" — posição de hoje e cronograma no topo — e
// guarda o resto em abas: Faturas (por visão, com a fatura aberta na linha),
// Pagamentos (cada dinheiro que entrou), Contratos e Cadastro. As peças da
// conta vivem em ./titular; aqui ficam o cabeçalho, as ações e as abas.

const card = { background: 'var(--surface)', border: '1px solid var(--border)' };
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' } as const;

const DOC_LABEL: Record<string, string> = {
  cnh: 'CNH', comprovante_endereco: 'Comprovante de endereço',
  comprovante_renda: 'Comprovante de renda', relatorio_brick: 'Relatório Brick', outro: 'Outro',
};

function fmtData(iso: string | null): string {
  return iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—';
}

export function TitularDetalhePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const irParaArea = useIrParaArea();
  const queryClient = useQueryClient();
  // Aba aberta; outro titular volta para Faturas (que abre sempre em "Agora").
  const [aba, setAba] = useState('faturas');
  useEffect(() => setAba('faturas'), [id]);

  // Hub de ações do titular: contratar crédito, renegociar, desbloquear.
  const pode = usePodeRole();
  const [renegOpen, setRenegOpen] = useState(false);
  // Novação F1 (doc adaptações 13/09): prévia da decomposição do saldo por produto.
  const [novacaoOpen, setNovacaoOpen] = useState(false);
  const viewer = useDocumentoViewer(); // visualização inline de documentos (08/09)
  const [desbloqueando, setDesbloqueando] = useState(false);

  // Novo produto (Doc 2 §4.7-A + decisão 09/09): o modal abre na SELEÇÃO do
  // produto — Acordo de pagamento desvia para o wizard da régua; produto avulso
  // do catálogo (ex.: Reembolso Parcelado) segue para o formulário próprio,
  // SEM entrada e sem a palavra "crédito" na tela.
  const [creditoOpen, setCreditoOpen] = useState(false);
  const [creditoBusy, setCreditoBusy] = useState(false);
  const [cProdutoId, setCProdutoId] = useState('');
  const [produtoDefinido, setProdutoDefinido] = useState(false);
  const [cFinalidade, setCFinalidade] = useState('');
  const [cValor, setCValor] = useState('');
  const [cParcelas, setCParcelas] = useState('12');
  // Fornecedor a pagar (doc 02 §18.5, 13/09): o RP paga o FORNECEDOR do cliente
  // — escolhido aqui, com cadastro rápido inline para não quebrar o atendimento.
  const [fornecedorId, setFornecedorId] = useState('');
  const [fornNovoAberto, setFornNovoAberto] = useState(false);
  const [fornNome, setFornNome] = useState('');
  const [fornDoc, setFornDoc] = useState('');
  const [fornSalvando, setFornSalvando] = useState(false);
  // "De acordo" do cliente (doc 02 §18.7, 18/11): o Reembolso Parcelado vale por ele —
  // sem contrato nem assinatura. O envio só libera com a confirmação marcada.
  const [rpAceite, setRpAceite] = useState(false);
  const [rpResposta, setRpResposta] = useState('');
  const [rpObservacao, setRpObservacao] = useState('');


  // Fonte ÚNICA: produtos do CATÁLOGO com contratação avulsa (doc 02 §17,
  // 2026-08-16) — o model Produto legado (itens de contrato) saiu deste modal.
  const produtos = useQuery({
    queryKey: ['catalogo-avulsos'],
    queryFn: () => catalogoService.avulsos(),
    enabled: creditoOpen,
  });
  const produtosCredito = produtos.data ?? [];
  const produtoSel = produtosCredito.find((p) => p.id === cProdutoId);

  const cValorCent = reaisParaCentavos(cValor);
  const cNumParcelas = Math.max(1, parseInt(cParcelas || '0', 10) || 0);
  // Reembolso parcelado NÃO tem entrada (decisão 09/09) — o campo saiu da tela.
  const cParcelaPrev = cValorCent > 0 && cNumParcelas > 0 ? Math.round(cValorCent / cNumParcelas) : 0;
  // Rótulo sem a palavra "crédito" (decisão 09/09): reembolso é reembolso.
  const ehReembolsoSel = produtoSel?.nome.toLowerCase().includes('reembolso') ?? false;
  const rotuloValor = ehReembolsoSel ? 'Valor do reembolso (R$)' : 'Valor (R$)';
  // Fornecedores do financeiro — só carrega quando o RP está em jogo.
  const fornecedores = useQuery({
    queryKey: ['fornecedores-fin'],
    queryFn: () => financeiroService.fornecedores(),
    enabled: creditoOpen && produtoDefinido && ehReembolsoSel,
  });

  async function cadastrarFornecedorRapido() {
    if (!fornNome.trim() || !fornDoc.trim()) return;
    setFornSalvando(true);
    try {
      const f = await financeiroService.criarFornecedor({ nome: fornNome.trim(), cpfCnpj: fornDoc.replace(/\D/g, '') });
      await queryClient.invalidateQueries({ queryKey: ['fornecedores-fin'] });
      setFornecedorId(f.id);
      setFornNovoAberto(false);
      setFornNome('');
      setFornDoc('');
      toast.sucesso('Fornecedor cadastrado — dados bancários podem ser completados depois em Fornecedores.');
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setFornSalvando(false);
    }
  }
  // Prévia REAL no servidor (F3: se o Reembolso Parcelado está ativo no Catálogo,
  // vem com taxa inicial, encargo e limite de 30% da parcela principal).
  const previa = useQuery({
    queryKey: ['credito-previa', id, cValorCent, cNumParcelas],
    queryFn: () => creditoService.simular({ valor: cValorCent, numeroParcelas: cNumParcelas, valorEntrada: 0, titularId: id }),
    enabled: creditoOpen && produtoDefinido && cValorCent > 0 && cNumParcelas > 0,
    retry: false,
  });

  function fecharModalProduto() {
    setCreditoOpen(false);
    setProdutoDefinido(false);
    setCProdutoId('');
    setFornecedorId('');
    setFornNovoAberto(false);
    setRpAceite(false);
    setRpResposta('');
    setRpObservacao('');
  }

  async function contratarProduto() {
    if (cValorCent <= 0 || cNumParcelas <= 0) return;
    setCreditoBusy(true);
    try {
      const nomeProduto = produtoSel?.nome ?? 'Contratação avulsa';
      const r = await creditoService.originar(id, {
        descricao: cFinalidade.trim() ? `${nomeProduto} — ${cFinalidade.trim()}` : nomeProduto,
        valor: cValorCent,
        numeroParcelas: cNumParcelas,
        valorEntrada: 0,
        fornecedorId: ehReembolsoSel ? fornecedorId : undefined,
        ...(ehReembolsoSel
          ? { aceiteWhatsapp: rpAceite, mensagemWhatsapp: mensagemRp ?? undefined, respostaCliente: rpResposta.trim() || undefined, observacao: rpObservacao.trim() || undefined }
          : {}),
      });
      fecharModalProduto();
      setCValor('');
      setCFinalidade('');
      await recarregar();
      await queryClient.invalidateQueries({ queryKey: ['aprovacoes-contagem'] });
      toast.sucesso(`${nomeProduto} ${r.numero} enviado para a Central de Aprovações.`);
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setCreditoBusy(false);
    }
  }

  async function desbloquear(contratoId: string) {
    setDesbloqueando(true);
    try {
      await reguaService.desbloquear(contratoId);
      await recarregar();
      toast.sucesso('Contrato desbloqueado.');
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setDesbloqueando(false);
    }
  }

  async function recarregar() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['titular-detalhe', id] }),
      queryClient.invalidateQueries({ queryKey: ['titular-faturas'] }),
      queryClient.invalidateQueries({ queryKey: ['titular-posicao'] }),
      queryClient.invalidateQueries({ queryKey: ['titular-pagamentos'] }),
      queryClient.invalidateQueries({ queryKey: ['titular-lancamentos'] }),
      queryClient.invalidateQueries({ queryKey: ['fatura-detalhe'] }),
    ]);
  }
  const det = useQuery({ queryKey: ['titular-detalhe', id], queryFn: () => titularService.detalhe(id), enabled: !!id });
  // Mensagem do "de acordo": montada em @azit/utils com os números da prévia do servidor.
  const fornecedorSel = (fornecedores.data ?? []).find((f) => f.id === fornecedorId);
  const mensagemRp =
    ehReembolsoSel && previa.data && fornecedorSel && det.data
      ? mensagemDeAcordoReembolso({
          nomeCliente: det.data.titular.nome,
          fornecedorNome: fornecedorSel.nome,
          finalidade: cFinalidade,
          valorPagoAoFornecedor: previa.data.valor,
          numeroParcelas: previa.data.numeroParcelas,
          valorParcela: previa.data.valorParcela,
          totalAPagar: previa.data.totalAPagar,
          periodicidade: previa.data.periodicidade,
        })
      : null;
  async function copiarMensagemRp() {
    if (!mensagemRp) return;
    try {
      await navigator.clipboard.writeText(mensagemRp);
      toast.sucesso('Mensagem copiada — cole na conversa com o cliente.');
    } catch {
      toast.info('Não foi possível copiar sozinho: selecione o texto e copie.');
    }
  }
  // Mudou valor, parcelas ou fornecedor: o "de acordo" anterior não vale para a proposta nova.
  useEffect(() => { setRpAceite(false); }, [mensagemRp]);

  // Consultas de birô da pessoa (decisão 09/08) — visíveis no cadastro.
  const consultasBiro = useQuery({ queryKey: ['titular-consultas-biro', id], queryFn: () => titularService.consultasBiro(id), enabled: !!id });
  const contaId = det.data?.conta?.id;
  // Posição de hoje da conta (doc 02 §33.1): atraso, próxima fatura, último pagamento, cronograma.
  const posicao = useQuery({ queryKey: ['titular-posicao', contaId], queryFn: () => faturaService.posicao(contaId!), enabled: !!contaId });
  // Lançamentos avulsos da conta (entradas de contrato/acordo — doc 02 §4-A.3, 30/08).
  const lancamentos = useQuery({
    queryKey: ['titular-lancamentos', contaId],
    queryFn: () => faturaService.lancamentos(contaId!),
    enabled: !!contaId,
  });
  if (det.isLoading) return <div className="p-[24px] text-[13px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>;
  if (!det.data) return <div className="p-[24px] text-[13px]" style={{ color: 'var(--text-primary)' }}>Titular não encontrado.</div>;
  const { titular: t, resumoFinanceiro: rf, documentos, contratosCredito } = det.data;
  const bloqueados = contratosCredito.filter((c) => c.status.toLowerCase() === 'bloqueado');

  // Selo da conta: calculado no servidor pela mesma regra da grade "Clientes da carteira".
  const situacao = det.data.conta?.situacao ?? 'sem_contrato_ativo';
  const corSituacao = CONTA_SITUACAO_COLORS[situacao] ?? CONTA_SITUACAO_COLORS.em_dia;
  // Entradas (de contrato ou de acordo) com cobrança gerada e dinheiro ainda não recebido.
  const entradasPendentes = (lancamentos.data ?? []).filter((l) => l.situacao === 'aguardando_pagamento');

  return (
    <div className="flex flex-col gap-[16px]">
      {viewer.doc && <DocumentoViewer doc={viewer.doc} onClose={viewer.fechar} />}
      {/* Header + hub de ações contextuais (a ficha do titular é o hub de operações) */}
      <div className="flex flex-wrap items-center gap-[12px]">
        <Botao variante="secundaria" tamanho="sm" onClick={() => navigate('/titulares')}>← Titulares</Botao>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-[8px]">
            <span className="truncate font-display text-[18px] font-bold" style={{ color: 'var(--text-primary)' }}>{t.nome}</span>
            {det.data.conta && (
              <span className="rounded-[6px] px-[8px] py-[2px] text-[11px] font-semibold" style={{ background: corSituacao.bg, color: corSituacao.fg }}>{CONTA_SITUACAO_LABEL[situacao] ?? situacao}</span>
            )}
          </div>
          <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            {t.tipoPessoa.toUpperCase()} · {t.cpfCnpj}
            {t.whatsapp ? ` · ${t.whatsapp}` : ''}
            {det.data.conta ? ` · cliente desde ${fmtData(det.data.conta.dataAbertura)}` : ' · sem conta'}
          </div>
        </div>
        <div className="flex-1" />
        <div className="flex flex-wrap items-center gap-[8px]">
          {rf.valorEmAtraso > 0 && contaId && (
            <Botao variante="primaria" tamanho="sm" onClick={() => setRenegOpen(true)}>
              Renegociar atraso
            </Botao>
          )}
          <Botao variante={rf.valorEmAtraso > 0 && contaId ? 'secundaria' : 'primaria'} tamanho="sm" onClick={() => setCreditoOpen(true)}>
            + Novo produto
          </Botao>
          {contaId && contratosCredito.length > 0 && (
            <Botao variante="fantasma" tamanho="sm" onClick={() => setNovacaoOpen(true)}>
              Novação (prévia do saldo)
            </Botao>
          )}
        </div>
      </div>

      {/* Banner de bloqueio (desbloqueio sempre manual, Regra 6) */}
      {bloqueados.length > 0 && (
        <div className="flex flex-wrap items-center gap-[10px] rounded-[12px] px-[16px] py-[12px]" style={{ background: 'var(--danger-bg)', border: '1px solid var(--border)' }}>
          <span className="text-[16px]">🔒</span>
          <div className="flex-1 text-[12.5px]" style={{ color: 'var(--danger-fg)' }}>
            <b>Conta bloqueada</b> — veículo bloqueado por inadimplência. O desbloqueio é sempre manual.
          </div>
          {pode(ROLE_OPERACAO) &&
            bloqueados.map((c) => (
              <Botao key={c.id} variante="secundaria" tamanho="sm" carregando={desbloqueando} onClick={() => desbloquear(c.id)}>
                Desbloquear {c.numero}
              </Botao>
            ))}
        </div>
      )}

      {/* Entrada com cobrança gerada e dinheiro ainda não recebido: fica à vista, acima de tudo. */}
      {entradasPendentes.map((l) => (
        <div key={l.id} className="flex flex-wrap items-center gap-[10px] rounded-[12px] px-[16px] py-[10px] text-[12.5px]" style={{ background: 'var(--warn-bg)', border: '1px solid var(--border)', color: 'var(--warn-ink)' }}>
          <span className="flex-1">
            <b>{l.tipo === 'entrada_contrato' ? 'Entrada de contrato' : 'Entrada de acordo'} aguardando pagamento</b> — {formatCurrency(l.valor)}
            {l.dataLimite ? ` até ${fmtData(l.dataLimite)}` : ''} · {l.descricao}
          </span>
          {l.acordoId && <Botao variante="fantasma" tamanho="sm" onClick={() => navigate(`/acordos?acordo=${l.acordoId}`)}>ver o acordo →</Botao>}
        </div>
      ))}

      {/* Posição de hoje + cronograma (doc 02 §33.1) */}
      {!contaId ? (
        <div className="rounded-card p-[18px] text-[12.5px]" style={{ ...card, color: 'var(--text-muted)' }}>Sem conta ainda — a conta e as faturas nascem na ativação do primeiro contrato.</div>
      ) : posicao.data ? (
        <PosicaoHoje posicao={posicao.data} situacao={situacao} valorPago={rf.valorPago} acordos={rf.quantidadeAcordos} novacoes={rf.quantidadeNovacoes} titularId={id} />
      ) : (
        <div className="rounded-card p-[18px] text-[12.5px]" style={{ ...card, color: 'var(--text-muted)' }}>{posicao.isError ? 'Não foi possível carregar a posição da conta.' : 'Carregando a posição de hoje…'}</div>
      )}

      {/* Lembretes de pagamento pelo WhatsApp (doc 02 §28.4) — logo abaixo da posição de hoje, antes das faturas. */}
      {contaId && <LembretesPagamento titularId={id} />}

      {/* Abas: Faturas · Pagamentos · Contratos · Cadastro (doc 02 §33) */}
      <div className="rounded-card" style={card}>
        <Abas
          valor={aba}
          onChange={setAba}
          itens={[
            ...(contaId ? [{ chave: 'faturas', rotulo: 'Faturas' }, { chave: 'pagamentos', rotulo: 'Pagamentos' }] : []),
            { chave: 'contratos', rotulo: 'Contratos', contagem: contratosCredito.length },
            { chave: 'cadastro', rotulo: 'Cadastro e documentos' },
          ]}
        />
        <div className="p-[18px]">
          {aba === 'faturas' && contaId && <FaturasDaConta contaId={contaId} contagem={posicao.data?.contagem} recarregar={recarregar} />}
          {aba === 'pagamentos' && contaId && <PagamentosDaConta contaId={contaId} encargosPagos={rf.encargosPagos ?? 0} />}
          {(aba === 'contratos' || (!contaId && aba !== 'cadastro')) && (
            <div className="flex flex-col gap-[18px]">
            <Secao titulo="Contratos" tag={`${contratosCredito.length}`}>
              <Tabela
                colunas={[
                  { chave: 'numero', titulo: 'Contrato', celular: 'titulo', render: (c) => c.numero },
                  { chave: 'assinado', titulo: 'Assinado', celular: 'subtitulo', classe: 'tabular-nums', render: (c) => fmtData(c.dataAssinatura) },
                  { chave: 'valor', titulo: 'Valor', alinhar: 'right', celular: 'campo', classe: 'tabular-nums', render: (c) => formatCurrency(c.valorTotal) },
                  { chave: 'saldo', titulo: 'Saldo devedor', alinhar: 'right', celular: 'destaque', classe: 'tabular-nums', render: (c) => formatCurrency(c.saldoDevedor) },
                  {
                    chave: 'status',
                    titulo: 'Status',
                    celular: 'campo',
                    render: (c) => (
                      <span className="inline-flex flex-wrap items-center gap-[5px]">
                        <StatusBadge label={c.status} colors={CONTRATO_STATUS_COLORS} />
                        {c.situacao && <span className="rounded-[6px] px-[7px] py-[1px] text-[10.5px] font-semibold" style={{ background: SITUACAO_CONTRATO_COLORS[c.situacao]?.bg, color: SITUACAO_CONTRATO_COLORS[c.situacao]?.fg }}>{SITUACAO_CONTRATO_LABEL[c.situacao]}</span>}
                      </span>
                    ),
                  },
                ]}
                linhas={contratosCredito}
                chave={(c) => c.id}
                onClick={(c) => irParaArea(AREAS_ROTA_CONTRATO, `/contratos/${c.id}`)}
                vazio="Nenhum contrato vinculado."
              />
            </Secao>

            {/* Bloco 3½ — Entradas e lançamentos avulsos (doc 02 §4-A.3, revisão 30/08):
                dinheiro que entra fora do ciclo de fatura — entrada do contrato (dia
                zero) e entrada do acordo. Não é fatura; é lançamento da conta. */}
            {(lancamentos.data?.length ?? 0) > 0 && (
              <Secao titulo="Entradas e lançamentos" tag={`${lancamentos.data!.length}`}>
                <Tabela
                  colunas={[
                    {
                      chave: 'tipo',
                      titulo: 'Lançamento',
                      celular: 'titulo',
                      render: (l) => {
                        const pendente = l.situacao === 'aguardando_pagamento';
                        return (
                          <span className="inline-flex flex-wrap items-center gap-[6px]">
                            <span className="rounded-[6px] px-[8px] py-[2px] text-[11px] font-semibold" style={pendente ? { background: 'var(--warn-bg)', color: 'var(--warn-fg)' } : { background: 'var(--ok-bg)', color: 'var(--ok-fg)' }}>
                              {l.tipo === 'entrada_contrato' ? 'Entrada de contrato' : 'Entrada de acordo'}
                            </span>
                            {pendente && (
                              <span className="rounded-[6px] px-[8px] py-[2px] text-[11px] font-semibold" style={{ background: 'var(--danger-bg)', color: 'var(--danger-fg)' }}>
                                Aguardando pagamento{l.dataLimite ? ` · até ${fmtData(l.dataLimite)}` : ''}
                              </span>
                            )}
                          </span>
                        );
                      },
                    },
                    { chave: 'descricao', titulo: 'Descrição', celular: 'subtitulo', render: (l) => l.descricao },
                    { chave: 'pago', titulo: 'Pago em', celular: 'campo', classe: 'tabular-nums', render: (l) => (l.situacao === 'aguardando_pagamento' ? '—' : fmtData(l.dataPagamento ?? '')) },
                    { chave: 'valor', titulo: 'Valor', alinhar: 'right', celular: 'destaque', classe: 'tabular-nums font-bold', render: (l) => formatCurrency(l.valor) },
                  ]}
                  linhas={lancamentos.data!}
                  chave={(l) => l.id}
                  acoes={(l) => (l.acordoId ? <Botao variante="fantasma" tamanho="sm" onClick={() => navigate(`/acordos?acordo=${l.acordoId}`)}>ver o acordo →</Botao> : null)}
                />
              </Secao>
            )}
            </div>
          )}
          {aba === 'cadastro' && (
            <div className="grid grid-cols-1 gap-[22px] lg:grid-cols-[1.2fr_1fr]">
              <Secao titulo="Dados pessoais">
                <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
                  <Campo label="Nome" valor={t.nome} />
                  <Campo label="CPF/CNPJ" valor={t.cpfCnpj} />
                  <Campo label="RG" valor={t.rg} />
                  <Campo label="WhatsApp" valor={t.whatsapp} />
                  <Campo label="E-mail" valor={t.email} />
                  <Campo label="Estado civil" valor={t.estadoCivil} />
                  <Campo label="Profissão" valor={t.profissao} />
                  <Campo label="Endereço" valor={t.endereco} />
                  <Campo label="Bairro" valor={t.bairro} />
                  <Campo label="Cidade/UF" valor={[t.cidade, t.estado].filter(Boolean).join(' / ') || null} />
                  <Campo label="CEP" valor={t.cep} />
                </div>
              </Secao>
              <div className="flex min-w-0 flex-col gap-[16px]">
                <Secao titulo="Documentos" tag={documentos.length ? `${documentos.length}` : undefined}>
                  {documentos.length === 0 ? (
                    <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Nenhum documento anexado.</div>
                  ) : (
                    <div className="flex flex-col gap-[6px]">
                      {documentos.map((d) => (
                        <div key={d.id} className="flex flex-wrap items-center justify-between gap-[6px] rounded-[10px] px-[10px] py-[7px] text-[12px]" style={{ background: 'var(--surface-input)', color: 'var(--text-primary)' }}>
                          <span>{DOC_LABEL[d.tipo] ?? d.tipo} <span style={{ color: 'var(--text-muted)' }}>· {fmtData(d.dataAnexo)}</span></span>
                          <span className="flex items-center gap-[10px]">
                            <button type="button" onClick={() => void viewer.abrir(d.id, d.arquivoRef)} className="font-semibold" style={{ color: 'var(--accent)' }}>Visualizar</button>
                            <button type="button" onClick={() => originacaoService.baixarDocumento(d.id, d.arquivoRef)} className="font-semibold" style={{ color: 'var(--text-primary)' }}>Baixar</button>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </Secao>

                {/* Consultas de birô do cliente (decisão 09/08): tudo o que já foi
                    consultado sobre a pessoa fica no cadastro, com o retorno completo. */}
                <Secao titulo="Consultas de birô" tag={(consultasBiro.data ?? []).length ? `${consultasBiro.data!.length}` : undefined}>
                  {(consultasBiro.data ?? []).length === 0 ? (
                    <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Nenhuma consulta de birô registrada para esta pessoa.</div>
                  ) : (
                    <div className="flex flex-col gap-[6px]">
                      {(consultasBiro.data ?? []).map((c) => (
                        <div key={c.id} className="rounded-[10px] px-[10px] py-[7px] text-[12px]" style={{ background: 'var(--surface-input)', color: 'var(--text-primary)' }}>
                          <b>{c.tipo === 'CAMADA1' ? 'Camada 1 (dados cadastrais)' : c.tipo === 'SCORE_QUOD' ? 'Score Quod' : 'Restritivos Quod'}</b>
                          {' · '}{c.fornecedor} · {fmtData(String(c.dataConsulta))}
                          {c.situacao === 'FALHA'
                            ? <span style={{ color: 'var(--danger-fg)' }}> · falhou{c.motivoFalha ? ` (${c.motivoFalha})` : ''}</span>
                            : null}
                          <BotaoVerRetorno
                            titulo={`Retorno do birô — ${c.tipo === 'CAMADA1' ? 'Camada 1' : c.tipo === 'SCORE_QUOD' ? 'Score Quod' : 'Restritivos Quod'} · ${fmtData(String(c.dataConsulta))}`}
                            resultado={c.resultado}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </Secao>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Novo produto (decisão 09/09): SELEÇÃO primeiro — Acordo de pagamento desvia
          para o wizard da régua; produto avulso do catálogo segue no formulário. */}
      <Modal open={creditoOpen} onClose={fecharModalProduto} title={produtoDefinido && produtoSel ? `Novo produto — ${produtoSel.nome}` : 'Novo produto'}>
        {!produtoDefinido ? (
          <div className="flex flex-col gap-[10px]">
            <p className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>Qual produto este cliente vai contratar?</p>
            <button
              type="button"
              onClick={() => { fecharModalProduto(); setRenegOpen(true); }}
              disabled={!contaId}
              className="rounded-[10px] p-[14px] text-left disabled:opacity-50"
              style={{ background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
            >
              <div className="text-[13px] font-bold">Acordo de pagamento</div>
              <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Regularizar faturas em atraso — mesmo fluxo da régua de cobrança.</div>
            </button>
            {produtos.isLoading && (
              <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Carregando produtos do Catálogo…</div>
            )}
            {produtosCredito.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => { setCProdutoId(p.id); setProdutoDefinido(true); }}
                className="rounded-[10px] p-[14px] text-left"
                style={{ background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
              >
                <div className="text-[13px] font-bold">{p.nome}</div>
                {p.finalidade && <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{p.finalidade}</div>}
              </button>
            ))}
            {!produtos.isLoading && produtosCredito.length === 0 && (
              <div className="rounded-[10px] p-[10px] text-[12px]" style={{ background: 'var(--warn-bg)', color: 'var(--warn-ink)' }}>
                Nenhum produto de contratação avulsa ativo no Catálogo.
              </div>
            )}
          </div>
        ) : (
        <div className="flex flex-col gap-[12px]">
          <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-2">
            <label className="flex flex-col gap-[4px] text-[12px]">
              <span className="font-semibold" style={{ color: 'var(--text-label)' }}>{rotuloValor}</span>
              <input value={cValor} onChange={(e) => setCValor(e.target.value)} placeholder="5.000,00" className="h-[34px] rounded-[10px] px-[10px] text-right text-[13px]" style={inputStyle} />
            </label>
            <label className="flex flex-col gap-[4px] text-[12px]">
              <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Finalidade (opcional)</span>
              <input value={cFinalidade} onChange={(e) => setCFinalidade(e.target.value)} placeholder="ex: manutenção do veículo" className="h-[34px] rounded-[10px] px-[10px] text-[13px]" style={inputStyle} />
            </label>
            <label className="flex flex-col gap-[4px] text-[12px]">
              <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Nº de parcelas</span>
              <input value={cParcelas} onChange={(e) => setCParcelas(e.target.value.replace(/\D/g, ''))} className="h-[34px] rounded-[10px] px-[10px] text-right text-[13px]" style={inputStyle} />
            </label>
            <label className="flex flex-col gap-[4px] text-[12px]">
              <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Periodicidade</span>
              {/* Herdada do contrato principal (decisão 07/09, padrão do acordo):
                  o parcelamento cai nas MESMAS faturas — o operador não escolhe. */}
              <div className="flex h-[34px] items-center rounded-[10px] px-[10px] text-[13px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                {previa.data?.periodicidade ? previa.data.periodicidade.charAt(0).toUpperCase() + previa.data.periodicidade.slice(1) : '…'} · herdada das faturas
              </div>
            </label>
          </div>

          {/* Quem vamos pagar (doc 02 §18.5, 13/09): o reembolso paga o FORNECEDOR
              do cliente, nunca o cliente — o título do contas a pagar nasce daqui. */}
          {ehReembolsoSel && (
            <div className="flex flex-col gap-[8px] rounded-[10px] p-[12px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }}>
              <div className="text-[12px] font-bold" style={{ color: 'var(--text-primary)' }}>Quem vamos pagar</div>
              <div className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                Pagamos o fornecedor do cliente (oficina, loja) <b>à vista</b> — nunca o cliente.
                Quem paga parcelado é o cliente, nas faturas dele. O pagamento ao fornecedor
                entra no Contas a Pagar vinculado a este contrato.
              </div>
              <div className="flex flex-wrap items-center gap-[8px]">
                <select
                  value={fornecedorId}
                  onChange={(e) => setFornecedorId(e.target.value)}
                  className="h-[34px] min-w-[200px] flex-1 rounded-[10px] px-[10px] text-[13px]"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                >
                  <option value="">Selecione o fornecedor…</option>
                  {(fornecedores.data ?? []).filter((f) => f.status !== 'BLOQUEADO').map((f) => (
                    <option key={f.id} value={f.id}>{f.nome} · {f.cpfCnpj}</option>
                  ))}
                </select>
                <Botao variante="secundaria" tamanho="sm" onClick={() => setFornNovoAberto((v) => !v)}>
                  {fornNovoAberto ? 'Cancelar' : '+ Cadastrar fornecedor'}
                </Botao>
              </div>
              {fornNovoAberto && (
                <div className="flex flex-wrap items-end gap-[8px]">
                  <label className="flex min-w-[160px] flex-1 flex-col gap-[3px] text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>
                    Nome do fornecedor
                    <input value={fornNome} onChange={(e) => setFornNome(e.target.value)} placeholder="ex: Oficina do Zé" className="h-[32px] rounded-[10px] px-[10px] text-[12.5px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
                  </label>
                  <label className="flex flex-col gap-[3px] text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>
                    CPF/CNPJ
                    <input value={fornDoc} onChange={(e) => setFornDoc(e.target.value)} placeholder="somente números" className="h-[32px] w-[160px] rounded-[10px] px-[10px] text-[12.5px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
                  </label>
                  <Botao variante="primaria" tamanho="sm" carregando={fornSalvando} disabled={!fornNome.trim() || fornDoc.replace(/\D/g, '').length < 11} onClick={() => void cadastrarFornecedorRapido()}>
                    Salvar e selecionar
                  </Botao>
                  <div className="w-full text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    Dados bancários podem ser completados depois, na tela Fornecedores — o pagamento só sai com eles aprovados.
                  </div>
                </div>
              )}
            </div>
          )}
          {previa.data ? (
            <div className="flex flex-col gap-[6px] rounded-[10px] px-[12px] py-[10px] text-[12px]" style={{ background: 'var(--surface-input)', color: 'var(--text-primary)' }}>
              <div className="flex items-center justify-between gap-[8px]">
                <span style={{ color: 'var(--text-muted)' }}>
                  {previa.data.produto === 'reembolso_parcelado' ? 'Reembolso Parcelado (produto do Catálogo)' : 'Parcela estimada (provisório)'}
                </span>
                <span className="font-bold tabular-nums">{previa.data.numeroParcelas}× {formatCurrency(previa.data.valorParcela)}</span>
              </div>
              {previa.data.produto === 'reembolso_parcelado' && (
                <div className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                  Taxa inicial de processamento {formatCurrency(previa.data.taxaInicial)} (diluída nas parcelas) · encargo {(previa.data.encargoMensal * 100).toFixed(2).replace('.', ',')}% ao mês
                  {previa.data.limiteParcela !== null && ` · limite da parcela: ${formatCurrency(previa.data.limiteParcela)}`}
                </div>
              )}
              {previa.data.excedeLimite && (
                <div className="rounded-[8px] p-[6px] text-[11.5px] font-semibold" style={{ background: 'var(--danger-bg)', color: 'var(--danger-fg)' }}>
                  A parcela ultrapassa 30% da parcela do contrato principal — aumente o prazo ou reduza o valor.
                </div>
              )}
            </div>
          ) : previa.error ? (
            <div className="rounded-[10px] p-[10px] text-[12px]" style={{ background: 'var(--danger-bg)', color: 'var(--danger-fg)' }}>
              {mensagemErro(previa.error)}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-[8px] rounded-[10px] px-[12px] py-[10px] text-[12px]" style={{ background: 'var(--surface-input)', color: 'var(--text-primary)' }}>
              <span style={{ color: 'var(--text-muted)' }}>Parcela estimada <span title="Juros a definir (Vicente) — cálculo provisório">(provisório)</span></span>
              <span className="font-bold tabular-nums">{cNumParcelas}× {formatCurrency(cParcelaPrev)}</span>
            </div>
          )}
          {/* "De acordo" do cliente (doc 02 §18.7): substitui o contrato e a assinatura do Reembolso Parcelado. */}
          {ehReembolsoSel && mensagemRp && !previa.data?.excedeLimite && (
            <div className="flex flex-col gap-[8px] rounded-[10px] p-[12px]" style={{ background: 'var(--surface-input)' }}>
              <div className="flex flex-wrap items-center justify-between gap-[8px]">
                <span className="text-[12.5px] font-bold" style={{ color: 'var(--text-primary)' }}>De acordo do cliente (WhatsApp)</span>
                <Botao variante="secundaria" tamanho="sm" onClick={() => void copiarMensagemRp()}>Copiar mensagem</Botao>
              </div>
              <div className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                Este produto não tem contrato para assinar: vale a resposta do cliente. Mande a mensagem pelo WhatsApp e só envie para aprovação depois que ele responder.
              </div>
              <pre className="max-h-[160px] overflow-auto whitespace-pre-wrap rounded-[8px] p-[10px] font-sans text-[12px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-body)' }}>{mensagemRp}</pre>
              <label className="flex items-start gap-[8px] text-[12.5px]" style={{ color: 'var(--text-primary)' }}>
                <input type="checkbox" className="mt-[2px]" checked={rpAceite} onChange={(e) => setRpAceite(e.target.checked)} />
                <span>O cliente respondeu o “de acordo” no WhatsApp com estas condições</span>
              </label>
              <label className="flex flex-col gap-[4px] text-[12px]">
                <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Resposta do cliente (cole o texto)</span>
                <textarea value={rpResposta} onChange={(e) => setRpResposta(e.target.value)} rows={2} maxLength={2000} placeholder="Ex.: De acordo" className="rounded-[10px] px-[10px] py-[8px] text-[12.5px]" style={inputStyle} />
              </label>
              <label className="flex flex-col gap-[4px] text-[12px]">
                <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Observação para quem aprova (opcional)</span>
                <textarea value={rpObservacao} onChange={(e) => setRpObservacao(e.target.value)} rows={2} maxLength={2000} className="rounded-[10px] px-[10px] py-[8px] text-[12.5px]" style={inputStyle} />
              </label>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-[8px]">
            <Botao variante="secundaria" onClick={() => { setProdutoDefinido(false); setCProdutoId(''); }}>
              ← Trocar produto
            </Botao>
            <Botao
              variante="primaria"
              className="flex-1"
              carregando={creditoBusy}
              disabled={cValorCent <= 0 || cNumParcelas <= 0 || (ehReembolsoSel && (!fornecedorId || !rpAceite))}
              onClick={contratarProduto}
              title={ehReembolsoSel && !fornecedorId ? 'Selecione o fornecedor a pagar para liberar o envio' : ehReembolsoSel && !rpAceite ? 'Marque que o cliente respondeu o “de acordo” para liberar o envio' : undefined}
            >
              {ehReembolsoSel && !fornecedorId ? 'Selecione o fornecedor a pagar' : ehReembolsoSel && !rpAceite ? 'Falta o “de acordo” do cliente' : 'Enviar para aprovação'}
            </Botao>
          </div>
        </div>
        )}
      </Modal>

      {/* Wizard de renegociação conta-cêntrica (Doc 2 §7.7) */}
      {renegOpen && contaId && (
        <RenegociacaoWizard contaId={contaId} titular={t.nome} onClose={() => { setRenegOpen(false); void recarregar(); }} />
      )}

      {/* Novação F1 (doc adaptações 13/09): decomposição do saldo por produto */}
      {contaId && (
        <NovacaoDecomposicaoModal contaId={contaId} open={novacaoOpen} onClose={() => setNovacaoOpen(false)} />
      )}
    </div>
  );
}
