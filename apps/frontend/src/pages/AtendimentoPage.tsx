import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  originacaoService,
  OfertaSimulada,
  SimulacaoResultado,
  PropostaDetalhe,
  OpcaoProtecao,
} from '../services/originacao.service';
import { titularService, Titular } from '../services/titular.service';
import { buscarCep } from '../lib/cep';
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

// Passos da jornada (doc 02 §20): 1 triagem+lead · 2 ativo · 3 ofertas ·
// 4 cadastro completo · 5 upsell da proteção · 6 documentos · 7 enviado.
type Passo = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 'reprovada';

export function AtendimentoPage() {
  const navigate = useNavigate();
  const [passo, setPasso] = useState<Passo>(1);
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

  // Passos 4–7 — proposta criada (camada 1 já rodou de forma transparente)
  const [proposta, setProposta] = useState<PropostaDetalhe | null>(null);
  const [cad, setCad] = useState({ nome: '', whatsapp: '', email: '', rg: '', estadoCivil: '', profissao: '', cep: '', endereco: '', bairro: '', cidade: '', estado: '' });
  const [segundo, setSegundo] = useState({ aberto: false, nome: '', cpf: '', telefone: '' });
  const [opcoesProtecao, setOpcoesProtecao] = useState<OpcaoProtecao[] | null>(null);
  const [docBusy, setDocBusy] = useState(false);
  const [descComplementar, setDescComplementar] = useState('');
  const [rendaTexto, setRendaTexto] = useState('');
  const [parecerTexto, setParecerTexto] = useState('');

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

  // Passo 6 da jornada: "enviar a proposta" cria a proposta e a CAMADA 1 do
  // birô roda de forma transparente. Reprovada → tela neutra; aprovada → segue
  // para o cadastro completo.
  async function enviarProposta() {
    if (!simulacao) return;
    setErro(null);
    setOcupado(true);
    try {
      const comprador = titular
        ? { nome: titular.nome, cpfCnpj: titular.cpfCnpj, whatsapp: titular.whatsapp }
        : { nome: nome.trim(), cpfCnpj: somenteDigitos(cpf), whatsapp: somenteDigitos(telefone) };
      const p = await originacaoService.criarProposta({ simulacaoId: simulacao.id, comprador });
      setProposta(p);
      if (p.status === 'reprovada') {
        setPasso('reprovada');
        return;
      }
      setCad({
        nome: p.titular.nome ?? '',
        whatsapp: mascararTelefone(p.titular.whatsapp ?? ''),
        email: '',
        rg: '',
        estadoCivil: '',
        profissao: '',
        cep: '',
        endereco: '',
        bairro: '',
        cidade: '',
        estado: '',
      });
      setPasso(4);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  // Passo 4→5: salva o cadastro completo (CPF fica bloqueado — foi o consultado
  // no birô) e o segundo comprador opcional.
  async function salvarCadastroCompleto() {
    if (!proposta) return;
    setErro(null);
    setOcupado(true);
    try {
      await titularService.atualizar(proposta.titular.id, {
        nome: cad.nome.trim() || undefined,
        whatsapp: somenteDigitos(cad.whatsapp) || undefined,
        email: cad.email.trim() || undefined,
        rg: cad.rg.trim() || undefined,
        estadoCivil: cad.estadoCivil.trim() || undefined,
        profissao: cad.profissao.trim() || undefined,
        cep: somenteDigitos(cad.cep) || undefined,
        endereco: cad.endereco.trim() || undefined,
        bairro: cad.bairro.trim() || undefined,
        cidade: cad.cidade.trim() || undefined,
        estado: cad.estado.trim() || undefined,
      });
      if (segundo.aberto && segundo.nome.trim().length >= 3 && somenteDigitos(segundo.cpf).length === 11) {
        const p2 = await originacaoService.adicionarVinculo(proposta.id, 'comprador_secundario', {
          nome: segundo.nome.trim(),
          cpfCnpj: somenteDigitos(segundo.cpf),
          whatsapp: somenteDigitos(segundo.telefone),
        });
        setProposta(p2);
      }
      // Upsell (passo 5): carrega as opções; sem opções, pula direto p/ documentos.
      const op = await originacaoService.protecaoOpcoes(proposta.id);
      if (op.disponivel) {
        setOpcoesProtecao(op.opcoes);
        setPasso(5);
      } else {
        setOpcoesProtecao(null);
        setPasso(6);
      }
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function preencherCep(valor: string) {
    setCad((c) => ({ ...c, cep: valor }));
    if (somenteDigitos(valor).length === 8) {
      const end = await buscarCep(valor);
      if (end) setCad((c) => ({ ...c, endereco: end.endereco || c.endereco, bairro: end.bairro || c.bairro, cidade: end.cidade || c.cidade, estado: end.estado || c.estado }));
    }
  }

  async function escolherPlano(plano: string) {
    if (!proposta) return;
    setErro(null);
    setOcupado(true);
    try {
      const p = await originacaoService.escolherProtecao(proposta.id, plano);
      setProposta(p);
      const op = await originacaoService.protecaoOpcoes(proposta.id);
      setOpcoesProtecao(op.opcoes);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function anexar(tipo: string, file: File, descricao?: string) {
    if (!proposta) return;
    setErro(null);
    setDocBusy(true);
    try {
      const conteudo = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      const nomeArq = descricao?.trim() ? `${descricao.trim()} — ${file.name}` : file.name;
      const p = await originacaoService.anexarDocumento(proposta.id, proposta.titular.id, tipo, { nome: nomeArq, conteudo });
      setProposta(p);
      setDescComplementar('');
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setDocBusy(false);
    }
  }

  async function enviarParaAnalise() {
    if (!proposta) return;
    setErro(null);
    setOcupado(true);
    try {
      const renda = dinheiroParaCentavos(rendaTexto);
      const p = await originacaoService.enviarParaAnalise(proposta.id, {
        rendaDeclarada: renda > 0 ? renda : undefined,
        parecerOperador: parecerTexto.trim() || undefined,
      });
      setProposta(p);
      // A Camada 1 pode ser reavaliada no envio (credenciais reais chegaram
      // depois da criação) — reprovou, cai na tela neutra.
      setPasso(p.status === 'reprovada' ? 'reprovada' : 7);
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
            {passo === 1 ? 'Quem é o cliente e o que ele procura'
              : passo === 2 ? 'Qual o ativo'
              : passo === 3 ? 'Oferta ao cliente'
              : passo === 4 ? 'Cadastro completo'
              : passo === 5 ? 'Proteção veicular'
              : passo === 6 ? 'Documentos e renda'
              : passo === 7 ? 'Proposta enviada'
              : 'Resultado da proposta'}
          </div>
        </div>
        <div className="flex items-center gap-[6px]">
          {[1, 2, 3, 4, 5, 6, 7].map((n) => (
            <span
              key={n}
              className="h-[8px] w-[8px] rounded-full"
              style={{ background: typeof passo === 'number' && n <= passo ? 'var(--accent)' : 'var(--border)' }}
            />
          ))}
        </div>
      </div>

      {typeof passo === 'number' && passo > 1 && passo <= 3 && (
        <button
          onClick={() => setPasso((p) => ((p as number) === 3 ? 2 : 1) as Passo)}
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
                onClick={() => { setTipoCliente('novo'); setTitular(null); setProduto('compra_parcelada'); }}
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
              {PRODUTOS.map((p) => {
                // Doc 02 §20 passo 2: cliente NOVO só segue com Compra Parcelada.
                const bloqueado = tipoCliente === 'novo' && p.v !== 'compra_parcelada';
                return (
                  <button
                    key={p.v}
                    onClick={() => !bloqueado && setProduto(p.v)}
                    disabled={bloqueado}
                    className="rounded-[10px] p-[12px] text-left disabled:opacity-45"
                    style={produto === p.v && !bloqueado ? { ...seletorInativo, border: '2px solid var(--accent)' } : seletorInativo}
                  >
                    <div className="text-[14.5px] font-bold">{p.l}</div>
                    <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
                      {bloqueado ? 'Disponível para quem já é cliente' : p.d}
                    </div>
                  </button>
                );
              })}
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
            onClick={enviarProposta}
            disabled={!selecionada || ocupado}
            className="h-[54px] rounded-[12px] text-[16px] font-bold disabled:opacity-40"
            style={{ background: 'var(--navy)', color: '#fff' }}
          >
            {ocupado ? 'Enviando…' : selecionada ? 'Enviar proposta' : 'Selecione uma oferta para enviar a proposta'}
          </button>
          <div className="text-center text-[12px]" style={{ color: 'var(--text-muted)' }}>
            O envio faz a verificação cadastral automática. Proposta não é garantia de aprovação.
          </div>
        </div>
      )}

      {/* Resultado neutro da camada 1 (motivos são internos — análise/diretoria) */}
      {passo === 'reprovada' && (
        <div className="flex flex-col gap-[14px]">
          <div className="rounded-[14px] p-[18px] text-[15px]" style={{ background: 'var(--surface)', border: '1.5px solid var(--border)' }}>
            <div className="mb-[6px] text-[17px] font-bold">Proposta não aprovada neste momento</div>
            <div style={{ color: 'var(--text-muted)' }}>
              A verificação cadastral não permitiu seguir com esta proposta agora. Agradeça o
              interesse do cliente — ele pode tentar novamente no futuro.
            </div>
          </div>
          <button onClick={() => window.location.reload()} className="h-[52px] rounded-[12px] text-[15px] font-bold" style={{ background: 'var(--navy)', color: '#fff' }}>
            Iniciar novo atendimento
          </button>
        </div>
      )}

      {/* Passo 4 — cadastro completo (CPF bloqueado: foi o consultado no birô) */}
      {passo === 4 && proposta && (
        <div className="flex flex-col gap-[12px]">
          <div>
            <span className={rotuloCls} style={{ color: 'var(--text-muted)' }}>Nome completo (confirme)</span>
            <input value={cad.nome} onChange={(e) => setCad({ ...cad, nome: e.target.value })} className={inputCls} style={inputStyle} />
          </div>
          <div>
            <span className={rotuloCls} style={{ color: 'var(--text-muted)' }}>CPF (bloqueado — usado na verificação)</span>
            <input value={mascararCpf(proposta.titular.cpfCnpj)} disabled className={inputCls} style={{ ...inputStyle, opacity: 0.6 }} />
          </div>
          <div className="grid grid-cols-2 gap-[10px]">
            <div>
              <span className={rotuloCls} style={{ color: 'var(--text-muted)' }}>WhatsApp</span>
              <input value={cad.whatsapp} onChange={(e) => setCad({ ...cad, whatsapp: mascararTelefone(e.target.value) })} inputMode="tel" className={inputCls} style={inputStyle} />
            </div>
            <div>
              <span className={rotuloCls} style={{ color: 'var(--text-muted)' }}>RG</span>
              <input value={cad.rg} onChange={(e) => setCad({ ...cad, rg: e.target.value })} className={inputCls} style={inputStyle} />
            </div>
          </div>
          <div>
            <span className={rotuloCls} style={{ color: 'var(--text-muted)' }}>E-mail</span>
            <input value={cad.email} onChange={(e) => setCad({ ...cad, email: e.target.value })} inputMode="email" className={inputCls} style={inputStyle} />
          </div>
          <div className="grid grid-cols-2 gap-[10px]">
            <div>
              <span className={rotuloCls} style={{ color: 'var(--text-muted)' }}>Estado civil</span>
              <input value={cad.estadoCivil} onChange={(e) => setCad({ ...cad, estadoCivil: e.target.value })} className={inputCls} style={inputStyle} />
            </div>
            <div>
              <span className={rotuloCls} style={{ color: 'var(--text-muted)' }}>Profissão</span>
              <input value={cad.profissao} onChange={(e) => setCad({ ...cad, profissao: e.target.value })} className={inputCls} style={inputStyle} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-[10px]">
            <div>
              <span className={rotuloCls} style={{ color: 'var(--text-muted)' }}>CEP (preenche o endereço)</span>
              <input value={cad.cep} onChange={(e) => void preencherCep(e.target.value)} inputMode="numeric" placeholder="00000-000" className={inputCls} style={inputStyle} />
            </div>
            <div>
              <span className={rotuloCls} style={{ color: 'var(--text-muted)' }}>Cidade / UF</span>
              <input value={cad.cidade ? `${cad.cidade}${cad.estado ? ` / ${cad.estado}` : ''}` : ''} disabled className={inputCls} style={{ ...inputStyle, opacity: 0.7 }} />
            </div>
          </div>
          <div>
            <span className={rotuloCls} style={{ color: 'var(--text-muted)' }}>Endereço (rua, número, complemento)</span>
            <input value={cad.endereco} onChange={(e) => setCad({ ...cad, endereco: e.target.value })} className={inputCls} style={inputStyle} />
          </div>

          {/* Segundo comprador — opcional */}
          {segundo.aberto ? (
            <div className="flex flex-col gap-[10px] rounded-[14px] p-[14px]" style={{ background: 'var(--surface)', border: '1.5px dashed var(--border)' }}>
              <div className="flex items-center justify-between">
                <span className="text-[14px] font-bold">Segundo comprador</span>
                <button className="text-[13px] font-semibold" style={{ color: 'var(--text-muted)' }} onClick={() => setSegundo({ aberto: false, nome: '', cpf: '', telefone: '' })}>Remover</button>
              </div>
              <input value={segundo.nome} onChange={(e) => setSegundo({ ...segundo, nome: e.target.value })} placeholder="Nome completo" className={inputCls} style={{ background: 'var(--surface-input)', border: '1.5px solid var(--border)' }} />
              <div className="grid grid-cols-2 gap-[10px]">
                <input value={segundo.cpf} onChange={(e) => setSegundo({ ...segundo, cpf: mascararCpf(e.target.value) })} placeholder="CPF" inputMode="numeric" className={inputCls} style={{ background: 'var(--surface-input)', border: '1.5px solid var(--border)' }} />
                <input value={segundo.telefone} onChange={(e) => setSegundo({ ...segundo, telefone: mascararTelefone(e.target.value) })} placeholder="Telefone" inputMode="tel" className={inputCls} style={{ background: 'var(--surface-input)', border: '1.5px solid var(--border)' }} />
              </div>
            </div>
          ) : (
            <button onClick={() => setSegundo({ ...segundo, aberto: true })} className="h-[46px] rounded-[12px] text-[14px] font-semibold" style={{ background: 'var(--surface)', border: '1.5px dashed var(--border)', color: 'var(--text-muted)' }}>
              + Incluir segundo comprador (opcional)
            </button>
          )}

          <button
            onClick={salvarCadastroCompleto}
            disabled={ocupado || cad.nome.trim().length < 3}
            className="h-[54px] rounded-[12px] text-[16px] font-bold disabled:opacity-40"
            style={{ background: 'var(--navy)', color: '#fff' }}
          >
            {ocupado ? 'Salvando…' : 'Continuar'}
          </button>
        </div>
      )}

      {/* Passo 5 — upsell da proteção: Essencial já embutida; upgrade pelo ADICIONAL */}
      {passo === 5 && proposta && opcoesProtecao && (
        <div className="flex flex-col gap-[12px]">
          <div className="text-[13.5px]" style={{ color: 'var(--text-muted)' }}>
            A oferta já inclui a <b>Proteção Veicular Essencial</b>. Mostre ao cliente o que
            ele ganha subindo de plano — pela diferença na parcela.
          </div>
          {opcoesProtecao.map((o) => (
            <button
              key={o.plano}
              onClick={() => escolherPlano(o.plano)}
              disabled={ocupado}
              className="rounded-[14px] p-[16px] text-left disabled:opacity-60"
              style={{ background: 'var(--surface)', border: o.atual ? '2px solid var(--accent)' : '1.5px solid var(--border)' }}
            >
              <div className="flex items-center justify-between">
                <span className="text-[15px] font-bold">Proteção Veicular {o.nome}</span>
                {o.atual && (
                  <span className="rounded-full px-[10px] py-[2px] text-[11.5px] font-bold" style={{ background: 'var(--accent)', color: 'var(--navy)' }}>Escolhida</span>
                )}
              </div>
              {o.cobertura && <div className="mt-[2px] text-[13px]" style={{ color: 'var(--text-muted)' }}>{o.cobertura}</div>}
              <div className="mt-[6px] text-[14.5px] font-semibold" style={{ color: 'var(--navy)' }}>
                {o.adicionalPorPeriodo === 0
                  ? 'Já incluída na parcela'
                  : `+ ${reais(o.adicionalPorPeriodo)} ${porPeriodo((simulacao?.ofertas.find((x) => x.selecionada)?.frequencia) ?? 'semanal')} → parcela ${reais(o.parcelaResultante)}`}
              </div>
            </button>
          ))}
          <button onClick={() => setPasso(6)} className="h-[54px] rounded-[12px] text-[16px] font-bold" style={{ background: 'var(--navy)', color: '#fff' }}>
            Continuar
          </button>
        </div>
      )}

      {/* Passo 6 — documentos (CNH obrigatória) + renda declarada */}
      {passo === 6 && proposta && (
        <div className="flex flex-col gap-[12px]">
          <div className="rounded-[14px] p-[14px]" style={{ background: 'var(--surface)', border: '1.5px solid var(--border)' }}>
            <div className="mb-[4px] text-[14.5px] font-bold">CNH válida (obrigatória)</div>
            {proposta.documentos.some((d) => d.tipo === 'cnh') ? (
              <div className="text-[13.5px]" style={{ color: '#1c7a3d' }}>
                ✓ Anexada: {proposta.documentos.filter((d) => d.tipo === 'cnh').map((d) => d.arquivoRef).join(', ')}
              </div>
            ) : (
              <label className="block h-[48px] cursor-pointer rounded-[10px] text-center text-[14px] font-bold leading-[48px]" style={{ background: 'var(--navy)', color: '#fff', opacity: docBusy ? 0.6 : 1 }}>
                {docBusy ? 'Anexando…' : 'Anexar foto da CNH'}
                <input type="file" accept="image/*,.pdf" className="hidden" disabled={docBusy}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void anexar('cnh', f); e.target.value = ''; }} />
              </label>
            )}
          </div>

          <div className="rounded-[14px] p-[14px]" style={{ background: 'var(--surface)', border: '1.5px dashed var(--border)' }}>
            <div className="mb-[4px] text-[14.5px] font-bold">Documentos complementares (opcional)</div>
            <div className="mb-[8px] text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
              Qualquer coisa que demonstre capacidade de pagamento: contracheque, extrato,
              contrato com locadora…
            </div>
            {proposta.documentos.filter((d) => d.tipo !== 'cnh').map((d) => (
              <div key={d.id} className="mb-[4px] text-[13px]" style={{ color: 'var(--text-muted)' }}>✓ {d.arquivoRef}</div>
            ))}
            <input
              value={descComplementar}
              onChange={(e) => setDescComplementar(e.target.value)}
              placeholder="Descrição breve (ex.: contrato da locadora)"
              className={`${inputCls} mb-[8px]`}
              style={{ background: 'var(--surface-input)', border: '1.5px solid var(--border)' }}
            />
            <label className="block h-[46px] cursor-pointer rounded-[10px] text-center text-[14px] font-semibold leading-[46px]" style={{ background: 'var(--surface-input)', border: '1.5px solid var(--accent)', color: 'var(--navy)', opacity: docBusy ? 0.6 : 1 }}>
              {docBusy ? 'Anexando…' : '+ Anexar documento'}
              <input type="file" accept="image/*,.pdf" className="hidden" disabled={docBusy}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void anexar('outro', f, descComplementar); e.target.value = ''; }} />
            </label>
          </div>

          <div>
            <span className={rotuloCls} style={{ color: 'var(--text-muted)' }}>Renda declarada pelo cliente (R$ por MÊS)</span>
            <input
              value={rendaTexto}
              onChange={(e) => setRendaTexto(mascararDinheiro(e.target.value))}
              inputMode="numeric"
              placeholder="0,00"
              className={inputCls}
              style={inputStyle}
            />
            <div className="mt-[4px] text-[12px]" style={{ color: 'var(--text-muted)' }}>
              Se o cliente falar por semana, converta para o mês.
            </div>
          </div>

          <button onClick={() => setPasso(7)} disabled={!proposta.documentos.some((d) => d.tipo === 'cnh')} className="h-[54px] rounded-[12px] text-[16px] font-bold disabled:opacity-40" style={{ background: 'var(--navy)', color: '#fff' }}>
            Continuar
          </button>
        </div>
      )}

      {/* Passo 7 — parecer opcional + envio / confirmação */}
      {passo === 7 && proposta && (
        proposta.status === 'em_analise' ? (
          <div className="flex flex-col gap-[14px]">
            <div className="rounded-[14px] p-[18px]" style={{ background: 'var(--surface)', border: '2px solid var(--accent)' }}>
              <div className="mb-[4px] text-[17px] font-bold">Proposta enviada para análise ✓</div>
              <div className="text-[13.5px]" style={{ color: 'var(--text-muted)' }}>
                A análise de cadastro vai devolver a decisão. Você será avisado — acompanhe também
                pela tela de propostas.
              </div>
            </div>
            <Link to={`/propostas/${proposta.id}`} className="h-[52px] rounded-[12px] text-center text-[15px] font-bold leading-[52px]" style={{ background: 'var(--navy)', color: '#fff' }}>
              Acompanhar a proposta
            </Link>
            <button onClick={() => window.location.reload()} className="h-[48px] rounded-[12px] text-[14px] font-semibold" style={{ background: 'var(--surface)', border: '1.5px solid var(--border)' }}>
              Iniciar novo atendimento
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-[12px]">
            <div>
              <span className={rotuloCls} style={{ color: 'var(--text-muted)' }}>Parecer do operador (opcional)</span>
              <textarea
                value={parecerTexto}
                onChange={(e) => setParecerTexto(e.target.value)}
                rows={4}
                placeholder="Algo que a análise deva saber sobre o cliente ou a negociação…"
                className="w-full rounded-[12px] px-[14px] py-[10px] text-[15px]"
                style={inputStyle}
              />
            </div>
            <button onClick={enviarParaAnalise} disabled={ocupado} className="h-[54px] rounded-[12px] text-[16px] font-bold disabled:opacity-40" style={{ background: 'var(--navy)', color: '#fff' }}>
              {ocupado ? 'Enviando…' : 'Enviar para análise'}
            </button>
          </div>
        )
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
