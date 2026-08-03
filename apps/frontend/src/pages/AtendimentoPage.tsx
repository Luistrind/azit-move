import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  originacaoService,
  OfertaSimulada,
  SimulacaoResultado,
} from '../services/originacao.service';
import { mascararCpf, mascararTelefone, mascararDinheiro, dinheiroParaCentavos, somenteDigitos } from '../lib/mascaras';
import { mensagemErro } from '../lib/permissoes';

// UX-2 — Modo balcão (proposta UX §4.1): atendimento + simulação mobile-primeiro,
// para usar NA FRENTE do cliente. Passos em tela cheia, cards grandes, sem tabela.
// O modo apresentação esconde os controles internos e mostra só o que o cliente vê.

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

function reais(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function porPeriodo(frequencia: string): string {
  return FREQUENCIAS.find((f) => f.v === frequencia)?.por ?? '';
}
function rotuloOferta(o: OfertaSimulada, i: number): string {
  if (o.tipo === 'personalizada') return 'Personalizada';
  if (o.tipo === 'oferta_fixa') return 'Oferta especial';
  return `Condição ${i + 1}`;
}

// Campos grandes (44px+ de toque, fonte 16px+ para o iPhone não dar zoom).
const inputCls = 'h-[52px] w-full rounded-[12px] px-[14px] text-[16px]';
const inputStyle = { background: 'var(--surface)', border: '1.5px solid var(--border)' } as const;
const rotuloCls = 'mb-[6px] block text-[13px] font-semibold';

export function AtendimentoPage() {
  const navigate = useNavigate();
  const [passo, setPasso] = useState<1 | 2 | 3>(1);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // Passo 1 — cliente
  const [nome, setNome] = useState('');
  const [cpf, setCpf] = useState('');
  const [telefone, setTelefone] = useState('');
  const [canal, setCanal] = useState('operador_interno');
  const [leadId, setLeadId] = useState<string | null>(null);

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

  const clienteOk = nome.trim().length >= 3 && somenteDigitos(cpf).length === 11 && somenteDigitos(telefone).length >= 10;

  async function avancarCliente() {
    setErro(null);
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

  async function escolherVeiculo(ativoId: string) {
    setErro(null);
    setOcupado(true);
    try {
      const s = await originacaoService.simular({ ativoId, leadId: leadId ?? undefined });
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
      const p = await originacaoService.criarProposta({
        simulacaoId: simulacao.id,
        comprador: { nome: nome.trim(), cpfCnpj: somenteDigitos(cpf), whatsapp: somenteDigitos(telefone) },
      });
      navigate(`/propostas/${p.id}`);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  const selecionada = useMemo(() => simulacao?.ofertas.find((o) => o.selecionada) ?? null, [simulacao]);

  return (
    <div className="mx-auto flex w-full max-w-[520px] flex-col gap-[16px] p-[16px] pb-[40px]">
      {/* Cabeçalho do fluxo */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-[20px] font-bold">Atendimento</h1>
          <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
            {passo === 1 ? 'Quem é o cliente' : passo === 2 ? 'Qual veículo' : 'Condições de pagamento'}
          </div>
        </div>
        <div className="flex items-center gap-[6px]">
          {[1, 2, 3].map((n) => (
            <span
              key={n}
              className="h-[10px] w-[10px] rounded-full"
              style={{ background: n <= passo ? 'var(--navy)' : 'var(--border)' }}
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

      {/* Passo 1 — cliente */}
      {passo === 1 && (
        <div className="flex flex-col gap-[14px]">
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
          <button
            onClick={avancarCliente}
            disabled={!clienteOk || ocupado}
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

      {/* Passo 2 — veículo */}
      {passo === 2 && (
        <div className="flex flex-col gap-[10px]">
          {ativos.isLoading ? (
            <div className="text-[14px]" style={{ color: 'var(--text-muted)' }}>Carregando a vitrine…</div>
          ) : (ativos.data ?? []).length === 0 ? (
            <div className="rounded-[12px] p-[16px] text-[14px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              Nenhum veículo disponível para venda agora.
            </div>
          ) : (
            (ativos.data ?? []).map((a) => (
              <button
                key={a.id}
                onClick={() => escolherVeiculo(a.id)}
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
        </div>
      )}

      {/* Passo 3 — condições */}
      {passo === 3 && simulacao && (
        <div className="flex flex-col gap-[14px]">
          <div className="rounded-[12px] p-[12px] text-[14px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <b>{simulacao.ativo?.descricao ?? 'Veículo'}</b>
            <span style={{ color: 'var(--text-muted)' }}> · à vista {reais(simulacao.valorAvista)}</span>
          </div>

          {simulacao.ofertas.map((o, i) => (
            <CartaoOferta
              key={o.id}
              oferta={o}
              titulo={rotuloOferta(o, i)}
              onSelecionar={() => selecionar(o)}
            />
          ))}

          {/* Personalizada */}
          <div className="flex flex-col gap-[10px] rounded-[14px] p-[16px]" style={{ background: 'var(--surface)', border: '1.5px dashed var(--border)' }}>
            <div className="text-[15px] font-bold">Montar condição personalizada</div>
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
                        ? { background: 'var(--navy)', color: '#fff' }
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
              style={{ background: 'var(--surface-input)', border: '1.5px solid var(--navy)', color: 'var(--navy)' }}
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
            {selecionada ? 'Converter em proposta' : 'Selecione uma condição para converter'}
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

            {simulacao.ofertas.map((o, i) => (
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
                  {rotuloOferta(o, i)}{o.selecionada ? ' · escolhida' : ''}
                </div>
                <div className="font-display text-[30px] font-extrabold leading-tight">
                  {reais(o.valorParcela)}
                  <span className="ml-[6px] text-[15px] font-semibold">{porPeriodo(o.frequencia)}</span>
                </div>
                <div className="mt-[4px] text-[14px]">
                  Entrada de {reais(o.valorEntrada)} · {o.numeroParcelas} parcelas
                </div>
              </button>
            ))}

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
        border: oferta.selecionada ? '2px solid var(--navy)' : '1.5px solid var(--border)',
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
            <span className="rounded-full px-[10px] py-[2px] text-[11.5px] font-bold" style={{ background: 'var(--navy)', color: '#fff' }}>
              Escolhida
            </span>
          )}
        </span>
      </div>
      <div className="font-display text-[26px] font-extrabold" style={{ color: 'var(--navy)' }}>
        {reais(oferta.valorParcela)}
        <span className="ml-[6px] text-[14px] font-semibold" style={{ color: 'var(--text-muted)' }}>
          {porPeriodo(oferta.frequencia)}
        </span>
      </div>
      <div className="text-[13.5px]" style={{ color: 'var(--text-muted)' }}>
        Entrada de {reais(oferta.valorEntrada)}{oferta.entradaParcelada ? ' (parcelada)' : ''} · {oferta.numeroParcelas} parcelas
      </div>
    </button>
  );
}
