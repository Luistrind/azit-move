import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  originacaoService,
  OfertaSimulada,
  SimulacaoResultado,
} from '../services/originacao.service';
import { titularService, Titular } from '../services/titular.service';
import { mascararCpf, mascararTelefone, mascararDinheiro, dinheiroParaCentavos, somenteDigitos } from '../lib/mascaras';
import { mensagemErro } from '../lib/permissoes';

// UX-2 — Modo balcão (proposta UX §4.1): atendimento + simulação mobile-primeiro,
// para usar NA FRENTE do cliente. Passos em tela cheia, cards grandes, sem tabela.
// Homologação 04/08: triagem na mesma tela (cliente novo × existente + produto de
// interesse), buscador de ativos, "ativo" na terminologia, cores da marca e
// rótulos "Oferta padrão / personalizada" (visual herdado do Atendimento
// Escritório — a tela antiga segue no ar como referência até a troca final).

const CANAIS: { v: string; l: string }[] = [
  { v: 'operador_interno', l: 'Presencial / balcão' },
  { v: 'whatsapp', l: 'WhatsApp' },
  { v: 'olx', l: 'OLX' },
  { v: 'instagram', l: 'Instagram' },
  { v: 'indicacao', l: 'Indicação' },
  { v: 'outro', l: 'Outro' },
];

const FREQUENCIAS: { v: 'semanal' | 'quinzenal' | 'mensal'; l: string; por: string }[] = [
  { v: 'semanal', l: 'Semanal', por: 'por semana' },
  { v: 'quinzenal', l: 'Quinzenal', por: 'por quinzena' },
  { v: 'mensal', l: 'Mensal', por: 'por mês' },
];

const PRODUTOS: { v: 'compra_parcelada' | 'reembolso_parcelado' | 'protecao_veicular'; l: string; d: string }[] = [
  { v: 'compra_parcelada', l: 'Compra parcelada', d: 'Ativo do estoque, com entrada e parcelas' },
  { v: 'reembolso_parcelado', l: 'Reembolso parcelado', d: 'Somente para quem já é cliente ativo' },
  { v: 'protecao_veicular', l: 'Proteção veicular', d: 'Simulação da contribuição de proteção' },
];

function reais(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function porPeriodo(frequencia: string): string {
  return FREQUENCIAS.find((f) => f.v === frequencia)?.por ?? '';
}
// Homologação 04/08: nada de "Condição N" — é Oferta padrão / personalizada.
function rotuloOferta(o: OfertaSimulada, indicePadrao: number): string {
  if (o.tipo === 'personalizada') return 'Oferta personalizada';
  if (o.tipo === 'oferta_fixa') return 'Oferta especial';
  return `Oferta padrão ${indicePadrao}`;
}

// Campos grandes (44px+ de toque, fonte 16px+ para o iPhone não dar zoom).
const inputCls = 'h-[52px] w-full rounded-[12px] px-[14px] text-[16px]';
const inputStyle = { background: 'var(--surface)', border: '1.5px solid var(--border)' } as const;
const rotuloCls = 'mb-[6px] block text-[13px] font-semibold';
const seletorAtivo = { background: 'var(--navy)', color: '#fff', border: '1.5px solid var(--navy)' } as const;
const seletorInativo = { background: 'var(--surface)', border: '1.5px solid var(--border)' } as const;

type TipoCliente = 'novo' | 'existente';
type ProdutoInteresse = 'compra_parcelada' | 'reembolso_parcelado' | 'protecao_veicular';

export function AtendimentoPage() {
  const navigate = useNavigate();
  const [passo, setPasso] = useState<1 | 2 | 3>(1);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // Passo 1 — triagem (mesma tela): tipo de cliente + produto + dados/busca
  const [tipoCliente, setTipoCliente] = useState<TipoCliente>('novo');
  const [produto, setProduto] = useState<ProdutoInteresse>('compra_parcelada');
  const [nome, setNome] = useState('');
  const [cpf, setCpf] = useState('');
  const [telefone, setTelefone] = useState('');
  const [canal, setCanal] = useState('operador_interno');
  const [leadId, setLeadId] = useState<string | null>(null);
  const [buscaCliente, setBuscaCliente] = useState('');
  const [titular, setTitular] = useState<Titular | null>(null);

  // Passo 2 — ativo
  const [buscaAtivo, setBuscaAtivo] = useState('');
  const [semAtivo, setSemAtivo] = useState(false);
  const [valorManualTexto, setValorManualTexto] = useState('');

  // Passo 2/3 — simulação
  const [simulacao, setSimulacao] = useState<SimulacaoResultado | null>(null);
  const [apresentando, setApresentando] = useState(false);

  // Personalizada
  const [entradaTexto, setEntradaTexto] = useState('');
  const [prazoMeses, setPrazoMeses] = useState('36');
  const [frequencia, setFrequencia] = useState<'semanal' | 'quinzenal' | 'mensal'>('semanal');

  const ativos = useQuery({
    queryKey: ['atendimento-ativos'],
    queryFn: () => originacaoService.ativosDisponiveis(),
    enabled: passo === 2,
  });

  // Busca de cliente existente (nome ou CPF) — sem redigitar cadastro (padrão Asaas).
  const buscaLimpa = buscaCliente.trim();
  const buscaEhCpf = somenteDigitos(buscaLimpa).length >= 4 && /^[\d.\-\s]+$/.test(buscaLimpa);
  const clientes = useQuery({
    queryKey: ['atendimento-clientes', buscaLimpa],
    queryFn: () =>
      titularService.listar(buscaEhCpf ? { cpfCnpj: somenteDigitos(buscaLimpa) } : { nome: buscaLimpa }),
    enabled: tipoCliente === 'existente' && buscaLimpa.length >= 3 && !titular,
  });

  const clienteOk =
    tipoCliente === 'existente'
      ? titular !== null
      : nome.trim().length >= 3 && somenteDigitos(cpf).length === 11 && somenteDigitos(telefone).length >= 10;

  // RP é exclusivo de cliente ativo — a triagem força a busca.
  const rpComNovo = produto === 'reembolso_parcelado' && tipoCliente === 'novo';

  async function continuarTriagem() {
    setErro(null);
    if (produto === 'protecao_veicular') {
      navigate('/protecao');
      return;
    }
    if (produto === 'reembolso_parcelado') {
      if (titular) navigate(`/titulares/${titular.id}`);
      return;
    }
    // Compra parcelada
    if (tipoCliente === 'existente') {
      setPasso(2);
      return;
    }
    setOcupado(true);
    try {
      const r = await originacaoService.criarLead({
        nome: nome.trim(),
        cpf: somenteDigitos(cpf),
        telefone: somenteDigitos(telefone),
        canalOrigem: canal,
      });
      setLeadId(r.lead?.id ?? null);
      setPasso(2);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function simularCom(body: { ativoId?: string; valorAvista?: number }) {
    setErro(null);
    setOcupado(true);
    try {
      const s = await originacaoService.simular({
        ...body,
        leadId: leadId ?? undefined,
        titularId: titular?.id ?? undefined,
      });
      setSimulacao(s);
      setPasso(3);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function simularPersonalizada() {
    if (!simulacao) return;
    setErro(null);
    setOcupado(true);
    try {
      const s = await originacaoService.simularOpcao(simulacao.id, {
        valorEntrada: dinheiroParaCentavos(entradaTexto),
        prazoMeses: Number(prazoMeses) || 1,
        frequencia,
      });
      setSimulacao(s);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function selecionar(oferta: OfertaSimulada) {
    if (!simulacao) return;
    setErro(null);
    try {
      await originacaoService.selecionarOferta(simulacao.id, oferta.id);
      const s = await originacaoService.detalheSimulacao(simulacao.id);
      setSimulacao(s);
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  async function abrirApresentacao() {
    if (!simulacao) return;
    try {
      await originacaoService.apresentarSimulacao(simulacao.id);
    } catch {
      // registrar a apresentação é telemetria; não trava o atendimento
    }
    setApresentando(true);
  }

  async function converterEmProposta() {
    if (!simulacao) return;
    setErro(null);
    setOcupado(true);
    try {
      const comprador = titular
        ? { nome: titular.nome, cpfCnpj: titular.cpfCnpj, whatsapp: titular.whatsapp }
        : { nome: nome.trim(), cpfCnpj: somenteDigitos(cpf), whatsapp: somenteDigitos(telefone) };
      const p = await originacaoService.criarProposta({ simulacaoId: simulacao.id, comprador });
      navigate(`/propostas/${p.id}`);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  const selecionada = useMemo(() => simulacao?.ofertas.find((o) => o.selecionada) ?? null, [simulacao]);

  // Buscador de ativos: qualquer termo filtra (modelo, placa, descrição).
  const ativosFiltrados = useMemo(() => {
    const lista = ativos.data ?? [];
    const termo = buscaAtivo.trim().toLowerCase();
    if (!termo) return lista;
    return lista.filter((a) =>
      `${a.descricao} ${a.placa ?? ''}`.toLowerCase().includes(termo),
    );
  }, [ativos.data, buscaAtivo]);

  return (
    <div className="mx-auto flex w-full max-w-[520px] flex-col gap-[16px] p-[16px] pb-[40px]">
      {/* Cabeçalho do fluxo — enxuto */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-[20px] font-bold">Atendimento</h1>
          <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
            {passo === 1 ? 'Quem é o cliente e o que ele procura' : passo === 2 ? 'Qual o ativo' : 'Oferta ao cliente'}
          </div>
        </div>
        <div className="flex items-center gap-[6px]">
          {[1, 2, 3].map((n) => (
            <span
              key={n}
              className="h-[10px] w-[10px] rounded-full"
              style={{ background: n <= passo ? 'var(--accent)' : 'var(--border)' }}
            />
          ))}
        </div>
      </div>

      {passo > 1 && (
        <button
          onClick={() => setPasso((p) => (p === 3 ? 2 : 1) as 1 | 2)}
          className="self-start text-[14px] font-semibold"
          style={{ color: 'var(--text-muted)', minHeight: 44 }}
        >
          ← Voltar
        </button>
      )}

      {erro && (
        <div className="rounded-[12px] p-[12px] text-[14px]" style={{ background: '#fdecec', color: '#a12622' }}>
          {erro}
        </div>
      )}

      {/* Passo 1 — triagem: tipo de cliente + produto + dados/busca (mesma tela) */}
      {passo === 1 && (
        <div className="flex flex-col gap-[14px]">
          <div>
            <span className={rotuloCls} style={{ color: 'var(--text-muted)' }}>Tipo de cliente</span>
            <div className="grid grid-cols-2 gap-[8px]">
              <button
                onClick={() => { setTipoCliente('novo'); setTitular(null); }}
                className="h-[48px] rounded-[10px] text-[14px] font-semibold"
                style={tipoCliente === 'novo' ? seletorAtivo : seletorInativo}
              >
                Novo cliente
              </button>
              <button
                onClick={() => setTipoCliente('existente')}
                className="h-[48px] rounded-[10px] text-[14px] font-semibold"
                style={tipoCliente === 'existente' ? seletorAtivo : seletorInativo}
              >
                Já é cliente
              </button>
            </div>
          </div>

          <div>
            <span className={rotuloCls} style={{ color: 'var(--text-muted)' }}>Produto de interesse</span>
            <div className="flex flex-col gap-[8px]">
              {PRODUTOS.map((p) => (
                <button
                  key={p.v}
                  onClick={() => setProduto(p.v)}
                  className="rounded-[10px] p-[12px] text-left"
                  style={produto === p.v ? { ...seletorInativo, border: '2px solid var(--accent)' } : seletorInativo}
                >
                  <div className="text-[14.5px] font-bold">{p.l}</div>
                  <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>{p.d}</div>
                </button>
              ))}
            </div>
          </div>

          {rpComNovo && (
            <div className="rounded-[12px] p-[12px] text-[13.5px]" style={{ background: '#fff3d6', color: '#8a5a00' }}>
              O reembolso parcelado é exclusivo para quem já é cliente ativo — selecione
              "Já é cliente" e busque o cadastro.
            </div>
          )}

          {tipoCliente === 'existente' ? (
            <div className="flex flex-col gap-[10px]">
              <div>
                <span className={rotuloCls} style={{ color: 'var(--text-muted)' }}>Buscar cliente (nome ou CPF)</span>
                <input
                  value={buscaCliente}
                  onChange={(e) => { setBuscaCliente(e.target.value); setTitular(null); }}
                  placeholder="Digite pelo menos 3 caracteres"
                  className={inputCls}
                  style={inputStyle}
                  autoComplete="off"
                />
              </div>
              {titular ? (
                <div className="flex items-center justify-between rounded-[12px] p-[14px]" style={{ background: 'var(--surface)', border: '2px solid var(--accent)' }}>
                  <div>
                    <div className="text-[15px] font-bold">{titular.nome}</div>
                    <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>{mascararCpf(titular.cpfCnpj)}</div>
                  </div>
                  <button className="text-[13px] font-semibold" style={{ color: 'var(--text-muted)', minHeight: 44 }} onClick={() => setTitular(null)}>
                    Trocar
                  </button>
                </div>
              ) : buscaLimpa.length >= 3 ? (
                clientes.isLoading ? (
                  <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Buscando…</div>
                ) : (clientes.data?.data ?? []).length === 0 ? (
                  <div className="rounded-[12px] p-[12px] text-[13.5px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    Nenhum cliente encontrado. Se for cliente novo, use a opção "Novo cliente".
                  </div>
                ) : (
                  (clientes.data?.data ?? []).slice(0, 6).map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setTitular(t)}
                      className="flex items-center justify-between rounded-[12px] p-[14px] text-left"
                      style={{ background: 'var(--surface)', border: '1.5px solid var(--border)', minHeight: 60 }}
                    >
                      <div>
                        <div className="text-[15px] font-bold">{t.nome}</div>
                        <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>{mascararCpf(t.cpfCnpj)}</div>
                      </div>
                      <span className="text-[13px] font-semibold" style={{ color: 'var(--accent)' }}>Selecionar</span>
                    </button>
                  ))
                )
              ) : null}
            </div>
          ) : (
            <>
              <div>
                <span className={rotuloCls} style={{ color: 'var(--text-muted)' }}>Nome completo</span>
                <input value={nome} onChange={(e) => setNome(e.target.value)} className={inputCls} style={inputStyle} autoComplete="off" />
              </div>
              <div>
                <span className={rotuloCls} style={{ color: 'var(--text-muted)' }}>CPF</span>
                <input
                  value={cpf}
                  onChange={(e) => setCpf(mascararCpf(e.target.value))}
                  inputMode="numeric"
                  placeholder="000.000.000-00"
                  className={inputCls}
                  style={inputStyle}
                />
              </div>
              <div>
                <span className={rotuloCls} style={{ color: 'var(--text-muted)' }}>Telefone / WhatsApp</span>
                <input
                  value={telefone}
                  onChange={(e) => setTelefone(mascararTelefone(e.target.value))}
                  inputMode="tel"
                  placeholder="(00) 00000-0000"
                  className={inputCls}
                  style={inputStyle}
                />
              </div>
              <div>
                <span className={rotuloCls} style={{ color: 'var(--text-muted)' }}>Como chegou até nós</span>
                <select value={canal} onChange={(e) => setCanal(e.target.value)} className={inputCls} style={inputStyle}>
                  {CANAIS.map((c) => (
                    <option key={c.v} value={c.v}>{c.l}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          <button
            onClick={continuarTriagem}
            disabled={ocupado || rpComNovo || (produto !== 'protecao_veicular' && !clienteOk)}
            className="mt-[6px] h-[54px] rounded-[12px] text-[16px] font-bold disabled:opacity-40"
            style={{ background: 'var(--navy)', color: '#fff' }}
          >
            {ocupado ? 'Registrando…' : 'Continuar'}
          </button>
          <Link to="/originacao" className="text-center text-[13px]" style={{ color: 'var(--text-muted)', minHeight: 44 }}>
            Prefiro a versão completa de escritório
          </Link>
        </div>
      )}

      {/* Passo 2 — ativo (buscador + opção de seguir só com o valor) */}
      {passo === 2 && (
        <div className="flex flex-col gap-[10px]">
          <input
            value={buscaAtivo}
            onChange={(e) => setBuscaAtivo(e.target.value)}
            placeholder="Buscar ativo — modelo, placa, qualquer termo"
            className={inputCls}
            style={inputStyle}
            autoComplete="off"
          />
          {ativos.isLoading ? (
            <div className="text-[14px]" style={{ color: 'var(--text-muted)' }}>Carregando a vitrine…</div>
          ) : ativosFiltrados.length === 0 ? (
            <div className="rounded-[12px] p-[16px] text-[14px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              {buscaAtivo ? 'Nenhum ativo disponível com esse termo.' : 'Nenhum ativo disponível para venda agora.'}
            </div>
          ) : (
            ativosFiltrados.map((a) => (
              <button
                key={a.id}
                onClick={() => simularCom({ ativoId: a.id })}
                disabled={ocupado}
                className="flex items-center justify-between gap-[10px] rounded-[14px] p-[16px] text-left disabled:opacity-50"
                style={{ background: 'var(--surface)', border: '1.5px solid var(--border)', minHeight: 72 }}
              >
                <div className="min-w-0">
                  <div className="truncate text-[16px] font-bold">{a.descricao}</div>
                  <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
                    {a.placa ?? 'Sem placa'}
                  </div>
                </div>
                {a.valorVenda != null && (
                  <div className="whitespace-nowrap text-right text-[15px] font-bold">{reais(a.valorVenda)}</div>
                )}
              </button>
            ))
          )}

          {/* Continuar só preenchendo o valor — mesma fonte de cálculo do Catálogo */}
          {semAtivo ? (
            <div className="flex flex-col gap-[10px] rounded-[14px] p-[16px]" style={{ background: 'var(--surface)', border: '1.5px dashed var(--border)' }}>
              <div className="text-[15px] font-bold">Simular só com o valor</div>
              <div>
                <span className={rotuloCls} style={{ color: 'var(--text-muted)' }}>Valor à vista do ativo (R$)</span>
                <input
                  value={valorManualTexto}
                  onChange={(e) => setValorManualTexto(mascararDinheiro(e.target.value))}
                  inputMode="numeric"
                  placeholder="0,00"
                  className={inputCls}
                  style={{ background: 'var(--surface-input)', border: '1.5px solid var(--border)' }}
                />
              </div>
              <button
                onClick={() => simularCom({ valorAvista: dinheiroParaCentavos(valorManualTexto) })}
                disabled={ocupado || dinheiroParaCentavos(valorManualTexto) <= 0}
                className="h-[50px] rounded-[12px] text-[15px] font-bold disabled:opacity-40"
                style={{ background: 'var(--surface-input)', border: '1.5px solid var(--accent)', color: 'var(--navy)' }}
              >
                {ocupado ? 'Calculando…' : 'Simular com esse valor'}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setSemAtivo(true)}
              className="h-[48px] rounded-[12px] text-[14px] font-semibold"
              style={{ background: 'var(--surface)', border: '1.5px dashed var(--border)', color: 'var(--text-muted)' }}
            >
              Continuar só preenchendo o valor
            </button>
          )}
        </div>
      )}

      {/* Passo 3 — ofertas */}
      {passo === 3 && simulacao && (
        <div className="flex flex-col gap-[14px]">
          <div className="rounded-[12px] p-[12px] text-[14px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <b>{simulacao.ativo?.descricao ?? 'Ativo a definir'}</b>
            <span style={{ color: 'var(--text-muted)' }}> · à vista {reais(simulacao.valorAvista)}</span>
          </div>

          {(() => {
            let padrao = 0;
            return simulacao.ofertas.map((o) => {
              if (o.tipo === 'padrao') padrao += 1;
              return (
                <CartaoOferta key={o.id} oferta={o} titulo={rotuloOferta(o, padrao)} onSelecionar={() => selecionar(o)} />
              );
            });
          })()}

          {/* Personalizada */}
          <div className="flex flex-col gap-[10px] rounded-[14px] p-[16px]" style={{ background: 'var(--surface)', border: '1.5px dashed var(--border)' }}>
            <div className="text-[15px] font-bold">Montar oferta personalizada</div>
            <div>
              <span className={rotuloCls} style={{ color: 'var(--text-muted)' }}>Entrada (R$)</span>
              <input
                value={entradaTexto}
                onChange={(e) => setEntradaTexto(mascararDinheiro(e.target.value))}
                inputMode="numeric"
                placeholder="0,00"
                className={inputCls}
                style={{ background: 'var(--surface-input)', border: '1.5px solid var(--border)' }}
              />
            </div>
            <div>
              <span className={rotuloCls} style={{ color: 'var(--text-muted)' }}>Prazo (meses)</span>
              <input
                value={prazoMeses}
                onChange={(e) => setPrazoMeses(somenteDigitos(e.target.value).slice(0, 2))}
                inputMode="numeric"
                className={inputCls}
                style={{ background: 'var(--surface-input)', border: '1.5px solid var(--border)' }}
              />
            </div>
            <div>
              <span className={rotuloCls} style={{ color: 'var(--text-muted)' }}>Frequência de pagamento</span>
              <div className="grid grid-cols-3 gap-[8px]">
                {FREQUENCIAS.map((f) => (
                  <button
                    key={f.v}
                    onClick={() => setFrequencia(f.v)}
                    className="h-[48px] rounded-[10px] text-[14px] font-semibold"
                    style={
                      frequencia === f.v
                        ? seletorAtivo
                        : { background: 'var(--surface-input)', border: '1.5px solid var(--border)' }
                    }
                  >
                    {f.l}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={simularPersonalizada}
              disabled={ocupado}
              className="h-[50px] rounded-[12px] text-[15px] font-bold disabled:opacity-40"
              style={{ background: 'var(--surface-input)', border: '1.5px solid var(--accent)', color: 'var(--navy)' }}
            >
              {ocupado ? 'Calculando…' : 'Calcular parcela'}
            </button>
          </div>

          {/* Ações principais */}
          <button
            onClick={abrirApresentacao}
            className="h-[54px] rounded-[12px] text-[16px] font-bold"
            style={{ background: 'var(--accent)', color: 'var(--navy)' }}
          >
            Apresentar ao cliente
          </button>
          <button
            onClick={converterEmProposta}
            disabled={!selecionada || ocupado}
            className="h-[54px] rounded-[12px] text-[16px] font-bold disabled:opacity-40"
            style={{ background: 'var(--navy)', color: '#fff' }}
          >
            {selecionada ? 'Converter em proposta' : 'Selecione uma oferta para converter'}
          </button>
        </div>
      )}

      {/* Modo apresentação — tela cheia, só o que o cliente deve ver */}
      {apresentando && simulacao && (
        <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto p-[20px]" style={{ background: 'var(--navy)' }}>
          <div className="mx-auto flex w-full max-w-[520px] flex-1 flex-col gap-[14px]">
            <div className="mt-[10px] text-center">
              <div className="text-[16px] font-semibold" style={{ color: 'var(--accent)' }}>
                {simulacao.ativo?.descricao ?? ''}
              </div>
              <div className="text-[13px]" style={{ color: 'rgba(255,255,255,.6)' }}>
                Condições para você
              </div>
            </div>

            {(() => {
              let padrao = 0;
              return simulacao.ofertas.map((o) => {
                if (o.tipo === 'padrao') padrao += 1;
                const titulo = rotuloOferta(o, padrao);
                return (
                  <button
                    key={o.id}
                    onClick={() => selecionar(o)}
                    className="rounded-[16px] p-[18px] text-left"
                    style={{
                      background: o.selecionada ? '#fff' : 'rgba(255,255,255,.08)',
                      color: o.selecionada ? 'var(--navy)' : '#fff',
                      border: o.selecionada ? '2px solid var(--accent)' : '2px solid transparent',
                    }}
                  >
                    <div className="text-[13px] font-semibold" style={{ color: o.selecionada ? 'var(--text-muted)' : 'rgba(255,255,255,.65)' }}>
                      {titulo}{o.selecionada ? ' · escolhida' : ''}
                    </div>
                    <div className="font-display text-[32px] font-extrabold leading-tight">
                      {reais(o.valorParcela)}
                      <span className="ml-[6px] text-[15px] font-semibold">{porPeriodo(o.frequencia)}</span>
                    </div>
                    <div className="mt-[4px] text-[14px]">
                      Entrada de {reais(o.valorEntrada)}
                      {o.prazoMeses ? ` · contrato de ${o.prazoMeses} meses` : ''}
                    </div>
                  </button>
                );
              });
            })()}

            <div className="text-center text-[12.5px]" style={{ color: 'rgba(255,255,255,.55)' }}>
              Valores válidos nesta simulação. Sujeito à análise de cadastro.
            </div>

            <div className="flex-1" />
            <button
              onClick={() => setApresentando(false)}
              className="mb-[8px] h-[50px] rounded-[12px] text-[15px] font-bold"
              style={{ background: 'rgba(255,255,255,.12)', color: '#fff' }}
            >
              Encerrar apresentação
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Caixinha da oferta (homologação 04/08): ocupa melhor o espaço — parcela grande
// à esquerda, entrada/prazo à direita; SEM a contagem de semanas na seleção.
function CartaoOferta({
  oferta,
  titulo,
  onSelecionar,
}: {
  oferta: OfertaSimulada;
  titulo: string;
  onSelecionar: () => void;
}) {
  return (
    <button
      onClick={onSelecionar}
      className="rounded-[14px] p-[16px] text-left"
      style={{
        background: 'var(--surface)',
        border: oferta.selecionada ? '2px solid var(--accent)' : '1.5px solid var(--border)',
        minHeight: 44,
      }}
    >
      <div className="flex items-center justify-between gap-[6px]">
        <span className="text-[13px] font-semibold" style={{ color: 'var(--text-muted)' }}>{titulo}</span>
        <span className="flex gap-[6px]">
          {oferta.foraParametro && (
            <span className="rounded-full px-[10px] py-[2px] text-[11.5px] font-bold" style={{ background: '#fff3d6', color: '#8a5a00' }} title={oferta.foraParametroMotivo ?? ''}>
              Fora do parâmetro
            </span>
          )}
          {oferta.selecionada && (
            <span className="rounded-full px-[10px] py-[2px] text-[11.5px] font-bold" style={{ background: 'var(--accent)', color: 'var(--navy)' }}>
              Escolhida
            </span>
          )}
        </span>
      </div>
      <div className="mt-[2px] flex items-end justify-between gap-[10px]">
        <div className="font-display text-[30px] font-extrabold leading-none" style={{ color: 'var(--navy)' }}>
          {reais(oferta.valorParcela)}
          <span className="ml-[6px] text-[14px] font-semibold" style={{ color: 'var(--text-muted)' }}>
            {porPeriodo(oferta.frequencia)}
          </span>
        </div>
        <div className="text-right text-[13.5px]" style={{ color: 'var(--text-muted)' }}>
          <div>Entrada de <b style={{ color: 'var(--navy)' }}>{reais(oferta.valorEntrada)}</b>{oferta.entradaParcelada ? ' (parcelada)' : ''}</div>
          {oferta.prazoMeses != null && <div>Contrato de {oferta.prazoMeses} meses</div>}
        </div>
      </div>
    </button>
  );
}
