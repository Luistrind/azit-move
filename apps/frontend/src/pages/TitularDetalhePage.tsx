import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { formatCurrency } from '@azit/utils';
import { titularService } from '../services/titular.service';
import { faturaService, FaturaDetalhe } from '../services/fatura.service';
import { diasAtrasoBrasil, hojeBrasilISO } from '../lib/datas';
import { originacaoService } from '../services/originacao.service';
import { creditoService } from '../services/credito.service';
import { financeiroService } from '../services/financeiro.service';
import { catalogoService } from '../services/catalogo.service';
import { reguaService } from '../services/regua.service';
import { reaisParaCentavos } from '../lib/valor';
import { mensagemErro, usePodeRole, ROLE_OPERACAO } from '../lib/permissoes';
import { StatusBadge } from '../components/StatusBadge';
import { Modal } from '../components/Modal';
import { BotaoVerRetorno } from '../components/RetornoBiro';
import { RenegociacaoWizard } from '../components/RenegociacaoWizard';
import { NovacaoDecomposicaoModal } from '../components/NovacaoDecomposicao';
import { toast } from '../components/Toast';
import { CONTRATO_STATUS_COLORS, SITUACAO_CONTRATO_COLORS, SITUACAO_CONTRATO_LABEL, FATURA_SITUACAO_COLORS, FATURA_SITUACAO_LABEL } from '../config/statusColors';
import { Metrica, Campo } from '../components/Metrica';
import { DocumentoViewer, useDocumentoViewer } from '../components/DocumentoViewer';
import { FERRAMENTAS_TESTE } from '../lib/ambiente';
import { Tabela } from '../components/Tabela';
import { Botao } from '../components/Botao';
import { Bloco } from '../components/Bloco';
import { Secao } from '../components/Secao';

// Layout v2 (doc 03 §11): a ficha do titular (hub da conta) em Secaos — uma
// coluna no celular, duas no desktop —, relacionamento em Bloco com Leitura,
// contratos/lançamentos/faturas em Tabela responsiva (no celular cada fatura
// é um cartão: nº, vencimento, valor e situação), ações em Botao; só tokens.

const card = { background: 'var(--surface)', border: '1px solid var(--border)' };
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' } as const;

// Situação da fatura calculada em runtime (Regra 7) — cores/rótulos canônicos
// (padronização E1, 07/09: o mapa local divergente foi absorvido).
const SITUACAO: Record<string, { bg: string; fg: string; label: string }> = Object.fromEntries(
  Object.entries(FATURA_SITUACAO_COLORS).map(([k, c]) => [k, { ...c, label: FATURA_SITUACAO_LABEL[k] ?? k }]),
);

const DOC_LABEL: Record<string, string> = {
  cnh: 'CNH', comprovante_endereco: 'Comprovante de endereço',
  comprovante_renda: 'Comprovante de renda', relatorio_brick: 'Relatório Brick', outro: 'Outro',
};

function fmtData(iso: string | null): string {
  return iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—';
}

// A3 (04/09): parsear 'YYYY-MM-DD' com new Date caía em UTC e somava 1 dia de
// atraso no fuso local — cálculo agora é por calendário (lib/datas).


const PAGE = 8;

export function TitularDetalhePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pagina, setPagina] = useState(1);
  // Faturas NOVADAS (extintas pela novação) ficam fora do histórico por padrão (13/10).
  const [mostrarNovadas, setMostrarNovadas] = useState(false);
  const [faturaSel, setFaturaSel] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

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
      queryClient.invalidateQueries({ queryKey: ['titular-lancamentos'] }),
      queryClient.invalidateQueries({ queryKey: ['fatura-detalhe'] }),
    ]);
  }
  // Dev: paga a fatura (conciliação é assíncrona — aguarda o worker e recarrega).
  async function pagarFatura(faturaId: string) {
    setOcupado(true);
    try { await faturaService.simularPagamento(faturaId); await new Promise((r) => setTimeout(r, 1200)); await recarregar(); }
    finally { setOcupado(false); }
  }
  // Dev: +1 dia de atraso por clique.
  async function atrasarFatura(faturaId: string) {
    setOcupado(true);
    try { await faturaService.envelhecer(faturaId); await recarregar(); }
    finally { setOcupado(false); }
  }
  // Contingência (08/09): fatura fechada cuja cobrança automática falhou — o
  // sistema reemite mantendo o vínculo (o webhook concilia sozinho).
  // Cobrança existe no Asaas e a fatura segue em aberto: pergunta ao Asaas se
  // foi paga e reprocessa a conciliação (webhook perdido ou parcial indevido).
  async function conferirPagamento(faturaId: string) {
    setOcupado(true);
    try {
      const r = await faturaService.conferirPagamento(faturaId);
      if (r.enfileirado) { await new Promise((ok) => setTimeout(ok, 2500)); await recarregar(); }
      else window.alert(r.motivo ?? 'Nada a conferir.');
    } catch (e) {
      const msg = (e as { response?: { data?: { mensagem?: string } } })?.response?.data?.mensagem;
      window.alert(msg ?? 'Não foi possível consultar o Asaas — tente de novo.');
    } finally {
      setOcupado(false);
    }
  }

  async function gerarCobrancaManual(faturaId: string, vencimento: string, incluirEncargo: boolean) {
    setOcupado(true);
    try {
      await faturaService.gerarCobranca(faturaId, { vencimento, incluirEncargo });
      await recarregar();
    } catch (e) {
      const msg = (e as { response?: { data?: { mensagem?: string } } })?.response?.data?.mensagem;
      window.alert(msg ?? 'Não foi possível gerar a cobrança — tente de novo.');
    } finally {
      setOcupado(false);
    }
  }

  const det = useQuery({ queryKey: ['titular-detalhe', id], queryFn: () => titularService.detalhe(id), enabled: !!id });
  // Consultas de birô da pessoa (decisão 09/08) — visíveis no cadastro.
  const consultasBiro = useQuery({ queryKey: ['titular-consultas-biro', id], queryFn: () => titularService.consultasBiro(id), enabled: !!id });
  const contaId = det.data?.conta?.id;
  const faturas = useQuery({
    queryKey: ['titular-faturas', contaId, pagina, mostrarNovadas],
    queryFn: () => faturaService.daConta(contaId!, pagina, PAGE, mostrarNovadas),
    enabled: !!contaId,
  });
  // Lançamentos avulsos da conta (entradas de contrato/acordo — doc 02 §4-A.3, 30/08).
  const lancamentos = useQuery({
    queryKey: ['titular-lancamentos', contaId],
    queryFn: () => faturaService.lancamentos(contaId!),
    enabled: !!contaId,
  });
  const faturaDet = useQuery({
    queryKey: ['fatura-detalhe', faturaSel],
    queryFn: () => faturaService.detalhe(faturaSel!),
    enabled: !!faturaSel,
  });

  if (det.isLoading) return <div className="p-[24px] text-[13px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>;
  if (!det.data) return <div className="p-[24px] text-[13px]" style={{ color: 'var(--text-primary)' }}>Titular não encontrado.</div>;
  const { titular: t, resumoFinanceiro: rf, documentos, contratosCredito } = det.data;
  const totalPaginas = faturas.data ? Math.max(1, Math.ceil(faturas.data.total / PAGE)) : 1;
  const bloqueados = contratosCredito.filter((c) => c.status.toLowerCase() === 'bloqueado');

  // Leitura do Hub sobre o relacionamento: uma frase, só com números reais.
  const leituraRelacionamento =
    rf.contratosTotal === 0 ? (
      'Sem contratos nesta conta ainda.'
    ) : rf.valorEmAtraso > 0 ? (
      <>
        <b>{formatCurrency(rf.valorEmAtraso)}</b> em atraso em <b>{rf.contratosAtivos}</b> contrato{rf.contratosAtivos === 1 ? '' : 's'} ativo{rf.contratosAtivos === 1 ? '' : 's'} · saldo devedor de <b>{formatCurrency(rf.saldoDevedor)}</b>.
      </>
    ) : (
      <>
        Em dia: <b>{rf.contratosAtivos}</b> contrato{rf.contratosAtivos === 1 ? '' : 's'} ativo{rf.contratosAtivos === 1 ? '' : 's'}, <b>{formatCurrency(rf.valorPago)}</b> já pagos e <b>{formatCurrency(rf.saldoDevedor)}</b> a receber.
      </>
    );

  return (
    <div className="flex flex-col gap-[16px]">
      {viewer.doc && <DocumentoViewer doc={viewer.doc} onClose={viewer.fechar} />}
      {/* Header + hub de ações contextuais (a ficha do titular é o hub de operações) */}
      <div className="flex flex-wrap items-center gap-[12px]">
        <Botao variante="secundaria" tamanho="sm" onClick={() => navigate('/titulares')}>← Titulares</Botao>
        <div className="min-w-0">
          <div className="truncate font-display text-[18px] font-bold" style={{ color: 'var(--text-primary)' }}>{t.nome}</div>
          <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{t.tipoPessoa.toUpperCase()} · {t.cpfCnpj} · conta {det.data.conta?.status ?? '—'}</div>
        </div>
        <div className="flex-1" />
        <div className="flex flex-wrap items-center gap-[8px]">
          <Botao variante="primaria" tamanho="sm" onClick={() => setCreditoOpen(true)}>
            + Novo produto
          </Botao>
          {rf.valorEmAtraso > 0 && contaId && (
            <Botao variante="secundaria" tamanho="sm" onClick={() => setRenegOpen(true)}>
              Renegociar atraso
            </Botao>
          )}
          {contaId && contratosCredito.length > 0 && (
            <Botao variante="fantasma" tamanho="sm" onClick={() => setNovacaoOpen(true)}>
              Novação (prévia do saldo)
            </Botao>
          )}
        </div>
      </div>

      {/* Banner de bloqueio (D+3 — desbloqueio sempre manual, Doc 2 Regra 6) */}
      {bloqueados.length > 0 && (
        <div className="flex flex-wrap items-center gap-[10px] rounded-[12px] px-[16px] py-[12px]" style={{ background: 'var(--danger-bg)', border: '1px solid var(--border)' }}>
          <span className="text-[16px]">🔒</span>
          <div className="flex-1 text-[12.5px]" style={{ color: 'var(--danger-fg)' }}>
            <b>Conta bloqueada</b> — bloqueio D+3 por inadimplência. O desbloqueio é sempre manual.
          </div>
          {pode(ROLE_OPERACAO) &&
            bloqueados.map((c) => (
              <Botao key={c.id} variante="secundaria" tamanho="sm" carregando={desbloqueando} onClick={() => desbloquear(c.id)}>
                Desbloquear {c.numero}
              </Botao>
            ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-[16px] lg:grid-cols-2">
        {/* Bloco 1 — Dados pessoais + documentos + consultas */}
        <div className="flex flex-col gap-[16px] rounded-card p-[18px]" style={card}>
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

        {/* Bloco 2 — Informações gerais com a Azit (Bloco com Leitura do Hub).
            O detalhe de acordos e novações vive em UMA tela (Renegociações,
            21/10) — a ficha leva até lá filtrada por este titular. */}
        <Bloco
          titulo="Relacionamento com a Azit"
          leitura={leituraRelacionamento}
          explorar={
            rf.quantidadeAcordos > 0 || rf.quantidadeNovacoes > 0
              ? {
                  rotulo: `Ver ${rf.quantidadeAcordos > 0 ? `${rf.quantidadeAcordos} acordo(s)` : ''}${rf.quantidadeAcordos > 0 && rf.quantidadeNovacoes > 0 ? ' e ' : ''}${rf.quantidadeNovacoes > 0 ? `${rf.quantidadeNovacoes} novação(ões)` : ''} desta conta em Renegociações`,
                  to: `/acordos?titular=${id}`,
                }
              : undefined
          }
        >
          <div className="grid grid-cols-2 gap-[10px]">
            <Metrica label="Em contrato ativo" valor={formatCurrency(rf.valorEmContratoAtivo)} />
            <Metrica label="Pago até o momento" valor={formatCurrency(rf.valorPago)} />
            {(rf.encargosPagos ?? 0) > 0 && <Metrica label="Juros e multa pagos" valor={formatCurrency(rf.encargosPagos ?? 0)} />}
            <Metrica label="Saldo devedor" valor={formatCurrency(rf.saldoDevedor)} />
            <Metrica label="Em atraso" valor={formatCurrency(rf.valorEmAtraso)} alerta={rf.valorEmAtraso > 0} />
            <Metrica label="Acordos" valor={String(rf.quantidadeAcordos)} />
            <Metrica label="Contratos ativos" valor={`${rf.contratosAtivos} de ${rf.contratosTotal}`} />
          </div>
        </Bloco>
      </div>

      {/* Bloco 3 — Contratos */}
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
          onClick={(c) => navigate(`/contratos/${c.id}`)}
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

      {/* Bloco 4 — Histórico de faturas (paginado) */}
      <Secao
        titulo="Histórico de faturas"
        tag={
          <>
            {faturas.data ? `${faturas.data.total}` : ''}
            {faturas.data && (faturas.data.ocultas > 0 || mostrarNovadas) && (
              <button
                type="button"
                onClick={() => { setMostrarNovadas((v) => !v); setPagina(1); }}
                className="ml-[10px] font-semibold"
                style={{ color: 'var(--text-muted)' }}
                title="Faturas extintas pela novação ficam no histórico, mas fora da lista"
              >
                {mostrarNovadas ? 'ocultar novadas' : `${faturas.data.ocultas} novada${faturas.data.ocultas === 1 ? '' : 's'} oculta${faturas.data.ocultas === 1 ? '' : 's'} · mostrar`}
              </button>
            )}
          </>
        }
        acao={
          faturas.data && faturas.data.total > PAGE ? (
            <div className="flex items-center gap-[8px] text-[12px]">
              <Botao variante="secundaria" tamanho="sm" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)} aria-label="Página anterior">←</Botao>
              <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>{pagina} / {totalPaginas}</span>
              <Botao variante="secundaria" tamanho="sm" disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => p + 1)} aria-label="Próxima página">→</Botao>
            </div>
          ) : undefined
        }
      >
        {!contaId ? (
          <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Sem conta — faturas nascem na ativação do contrato.</div>
        ) : (
          <Tabela
            colunas={[
              {
                chave: 'numero',
                titulo: 'Fatura',
                celular: 'titulo',
                render: (f) => {
                  // Visibilidade da renegociação (30/08): a última parcela do acordo
                  // pode cair como resíduo numa fatura menor — o selo aponta onde o
                  // acordo está, e o detalhe discrimina cada item.
                  const temAcordo = f.itens.some((it) => it.descricao.startsWith('Renegociação'));
                  return (
                    <>
                      #{f.numero}
                      {temAcordo && <span className="ml-[6px] rounded-[6px] px-[6px] py-[1px] text-[10.5px] font-semibold" style={{ background: 'var(--info-bg)', color: 'var(--info-fg)' }}>inclui acordo</span>}
                    </>
                  );
                },
              },
              { chave: 'vencimento', titulo: 'Vencimento', celular: 'subtitulo', classe: 'tabular-nums', render: (f) => fmtData(f.dataVencimento) },
              { chave: 'valor', titulo: 'Valor', alinhar: 'right', celular: 'destaque', classe: 'tabular-nums', render: (f) => formatCurrency(f.valorTotal) },
              {
                chave: 'situacao',
                titulo: 'Situação',
                celular: 'campo',
                render: (f) => {
                  const s = SITUACAO[f.situacao] ?? { bg: 'var(--surface-muted)', fg: 'var(--text-body)', label: f.situacao };
                  return <span className="rounded-[6px] px-[8px] py-[2px] text-[11px] font-semibold" style={{ background: s.bg, color: s.fg }}>{s.label}</span>;
                },
              },
            ]}
            linhas={faturas.data?.data ?? []}
            chave={(f) => f.id}
            carregando={faturas.isLoading}
            vazio="Nenhuma fatura."
            acoes={(f) => <Botao variante="fantasma" tamanho="sm" onClick={() => setFaturaSel(f.id)}>Detalhe</Botao>}
          />
        )}
      </Secao>

      {/* Modal — detalhe da fatura */}
      <Modal open={!!faturaSel} onClose={() => setFaturaSel(null)} title={faturaDet.data ? `Fatura #${faturaDet.data.numero}` : 'Fatura'}>
        {!faturaDet.data ? (
          <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>
        ) : (
          <div className="flex flex-col gap-[12px]">
            <div className="grid grid-cols-2 gap-[10px]">
              <Campo label="Vencimento" valor={fmtData(faturaDet.data.dataVencimento)} />
              <Campo label="Fechamento" valor={fmtData(faturaDet.data.dataFechamento)} />
              <Campo label="Pagamento" valor={fmtData(faturaDet.data.dataPagamento)} />
              <Campo label="Situação" valor={(SITUACAO[faturaDet.data.situacao]?.label) ?? faturaDet.data.situacao} />
            </div>
            <Secao titulo="Composição">
              <div className="flex flex-col gap-[4px]">
                {faturaDet.data.itens.map((it, i) => (
                  <div key={i} className="flex items-center justify-between gap-[8px] text-[12px]" style={{ color: 'var(--text-body)' }}>
                    <span>{it.descricao} <span style={{ color: 'var(--text-muted)' }}>· {it.credor} · {it.tipo}</span></span>
                    <span className="flex-none tabular-nums">{formatCurrency(it.valor)}</span>
                  </div>
                ))}
              </div>
            </Secao>
            <div className="flex items-center justify-between border-t pt-[10px] text-[13px] font-bold" style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
              <span>Total {faturaDet.data.valorPago > 0 ? `· pago ${formatCurrency(faturaDet.data.valorPago)}` : ''}</span>
              <span className="tabular-nums">{formatCurrency(faturaDet.data.valorTotal)}</span>
            </div>

            {faturaDet.data.temCobrancaAsaas && faturaDet.data.status !== 'paga' && faturaDet.data.status !== 'paga_em_atraso' && (
              <div className="flex flex-wrap items-center gap-[8px] border-t pt-[10px] text-[12px]" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                <span>O cliente pagou e a fatura não baixou?</span>
                <Botao variante="secundaria" tamanho="sm" disabled={ocupado} onClick={() => conferirPagamento(faturaDet.data!.id)}>Conferir pagamento no Asaas</Botao>
              </div>
            )}

            {faturaDet.data.status === 'fechada' && !faturaDet.data.temCobrancaAsaas && (
              <BlocoReemissao fd={faturaDet.data} ocupado={ocupado} emitir={gerarCobrancaManual} />
            )}

            {/* Ações dev — paga a FATURA; atraso aumenta dia a dia. Só fora de produção:
                em produção o cliente paga a cobrança no Asaas e o webhook concilia. */}
            {FERRAMENTAS_TESTE && (() => {
              const fd = faturaDet.data;
              const paga = fd.status === 'paga' || fd.status === 'paga_em_atraso';
              const atraso = diasAtrasoBrasil(fd.dataVencimento);
              return (
                <div className="border-t pt-[12px]" style={{ borderColor: 'var(--border)' }}>
                  <Secao titulo={`Simulação (dev)${atraso > 0 ? ` · ${atraso} dia(s) de atraso` : ''}`}>
                    <div className="flex flex-wrap gap-[8px]">
                      {!paga && (
                        <Botao variante="primaria" disabled={ocupado} onClick={() => pagarFatura(fd.id)}>
                          Simular pagamento
                        </Botao>
                      )}
                      {!paga && (
                        <Botao variante="perigo" disabled={ocupado} onClick={() => atrasarFatura(fd.id)}>
                          + 1 dia de atraso
                        </Botao>
                      )}
                      {paga && <span className="text-[12px] font-semibold" style={{ color: 'var(--ok-fg)' }}>✓ Fatura paga</span>}
                    </div>
                  </Secao>
                </div>
              );
            })()}
          </div>
        )}
      </Modal>

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
          <div className="flex flex-wrap items-center gap-[8px]">
            <Botao variante="secundaria" onClick={() => { setProdutoDefinido(false); setCProdutoId(''); }}>
              ← Trocar produto
            </Botao>
            <Botao
              variante="primaria"
              className="flex-1"
              carregando={creditoBusy}
              disabled={cValorCent <= 0 || cNumParcelas <= 0 || (ehReembolsoSel && !fornecedorId)}
              onClick={contratarProduto}
              title={ehReembolsoSel && !fornecedorId ? 'Selecione o fornecedor a pagar para liberar o envio' : undefined}
            >
              {ehReembolsoSel && !fornecedorId ? 'Selecione o fornecedor a pagar' : 'Enviar para aprovação'}
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

// Contingência (08/09): fatura FECHADA sem cobrança no Asaas — a emissão sai
// DAQUI (o vínculo externalReference faz o webhook conciliar sozinho); nunca
// criar a cobrança pelo painel do Asaas. O Asaas rejeita vencimento no passado,
// então a vencida sai com vencimento de hoje em diante, com ou sem o encargo
// corrido — decisão do operador, caso a caso.
function BlocoReemissao({ fd, ocupado, emitir }: { fd: FaturaDetalhe; ocupado: boolean; emitir: (faturaId: string, vencimento: string, incluirEncargo: boolean) => Promise<void> }) {
  const [venc, setVenc] = useState(hojeBrasilISO());
  const [comEncargo, setComEncargo] = useState(fd.encargoAtual > 0);
  const total = fd.valorTotal + (comEncargo ? fd.encargoAtual : 0);
  return (
    <div className="flex flex-col gap-[8px] rounded-[10px] p-[12px]" style={{ background: 'var(--warn-bg)', border: '1px solid var(--warn-fg)' }}>
      <div className="text-[12px] font-bold" style={{ color: 'var(--warn-ink)' }}>Sem cobrança no Asaas</div>
      <div className="text-[12px]" style={{ color: 'var(--warn-ink)' }}>
        A cobrança automática desta fatura falhou. Emita por aqui — o boleto sai vinculado à fatura e o pagamento concilia sozinho.
      </div>
      <div className="flex flex-wrap items-end gap-[10px]">
        <label className="flex flex-col gap-[3px] text-[11px] font-semibold" style={{ color: 'var(--warn-ink)' }}>
          Vencimento da cobrança
          <input type="date" value={venc} min={hojeBrasilISO()} onChange={(e) => setVenc(e.target.value)} className="rounded-[10px] px-[8px] py-[6px] text-[12px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
        </label>
        {fd.encargoAtual > 0 && (
          <label className="flex items-center gap-[6px] pb-[8px] text-[12px]" style={{ color: 'var(--warn-ink)' }}>
            <input type="checkbox" checked={comEncargo} onChange={(e) => setComEncargo(e.target.checked)} />
            Incluir encargo de atraso até hoje ({formatCurrency(fd.encargoAtual)})
          </label>
        )}
      </div>
      <Botao variante="primaria" className="self-start" disabled={ocupado || !venc} onClick={() => void emitir(fd.id, venc, comEncargo)}>
        Gerar cobrança de {formatCurrency(total)} no Asaas
      </Botao>
    </div>
  );
}
