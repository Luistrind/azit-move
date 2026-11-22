import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AreaSistema, nomeMomentoLembrete, nomeSituacaoLembrete } from '@azit/types';
import { lembretesService, LembreteRegistrado, LembretesDoTitular } from '../services/lembretes.service';
import { LEMBRETE_SITUACAO_COLORS } from '../config/statusColors';
import { FERRAMENTAS_TESTE } from '../lib/ambiente';
import { dataBR, horaBR, instanteBR } from '../lib/datas';
import { mensagemErro, useTemArea } from '../lib/permissoes';
import { Botao } from './Botao';
import { LinkArea } from './LinkArea';
import { ModalConfirmacao } from './ModalConfirmacao';
import { Secao } from './Secao';
import { StatusBadge } from './StatusBadge';
import { Tabela } from './Tabela';
import { toast } from './Toast';

// Lembretes de pagamento pelo WhatsApp de UM titular (doc 02 §28.4): o estado
// do lembrete (nasce desligado; ligar é ato do operador), o aviso do próprio
// Asaas e os lembretes registrados por fatura, com a situação de cada um.
// Componente GENÉRICO por titular: serve à ficha e a qualquer tela que mostre
// faturas de um cliente. Quem não tem a área Carteira e cobrança só vê o estado.

const muted = { color: 'var(--text-muted)' } as const;
const quando = (iso: string | null) => (iso ? `${instanteBR(iso)} às ${horaBR(iso)}` : null);

type Acao = 'ligar' | 'desligar' | 'asaas-desligar' | 'asaas-religar';

function linhaDoTempo(l: LembreteRegistrado): string {
  // Lembrete simulado nunca saiu: carimbo que ele tiver veio da ferramenta de
  // teste e é dito como tal — não pode parecer entrega de verdade.
  const teste = l.situacao === 'SIMULADO';
  const partes = [
    l.enviadoEm ? `enviado ${quando(l.enviadoEm)}` : null,
    l.entregueEm ? `${teste ? 'entrega de teste' : 'entregue'} ${quando(l.entregueEm)}` : null,
    l.lidoEm ? `${teste ? 'leitura de teste' : 'lido'} ${quando(l.lidoEm)}` : null,
    l.falhaEm ? `falhou ${quando(l.falhaEm)}` : null,
  ].filter(Boolean);
  return partes.length > 0 ? partes.join(' · ') : `registrado ${quando(l.registradoEm)}`;
}

export function LembretesPagamento({ titularId }: { titularId: string }) {
  const qc = useQueryClient();
  const chave = ['lembretes-titular', titularId];
  const q = useQuery({ queryKey: chave, queryFn: () => lembretesService.doTitular(titularId), enabled: !!titularId });
  const podeAgir = useTemArea(AreaSistema.CARTEIRA_COBRANCA);
  const [acao, setAcao] = useState<Acao | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const d: LembretesDoTitular | undefined = q.data;

  async function executar() {
    if (!acao) return;
    setOcupado(true);
    try {
      const novo =
        acao === 'ligar' ? await lembretesService.ligar(titularId)
        : acao === 'desligar' ? await lembretesService.desligar(titularId)
        : await lembretesService.definirAvisoAsaas(titularId, acao === 'asaas-desligar');
      qc.setQueryData(chave, novo);
      toast.sucesso(
        acao === 'ligar' ? 'Lembrete pelo WhatsApp ligado para este titular.'
        : acao === 'desligar' ? 'Lembrete pelo WhatsApp desligado.'
        : acao === 'asaas-desligar' ? (novo.avisoAsaas.pendente ? 'Decisão registrada: o cliente nasce sem aviso quando for criado no Asaas.' : 'Aviso do Asaas desligado no cadastro do cliente.')
        : 'Aviso do Asaas religado.',
      );
      setAcao(null);
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function simular(id: string, status: 'delivered' | 'read') {
    try {
      await lembretesService.simularStatus(id, status);
      toast.sucesso('Situação simulada enviada pela fila do webhook.');
      setTimeout(() => void qc.invalidateQueries({ queryKey: chave }), 1500);
    } catch (e) {
      toast.erro(mensagemErro(e));
    }
  }

  if (!d) {
    return (
      <Secao titulo="Lembretes de pagamento pelo WhatsApp">
        <div className="text-[12px]" style={muted}>{q.isLoading ? 'Carregando…' : mensagemErro(q.error)}</div>
      </Secao>
    );
  }

  const { lembrete, avisoAsaas, canal } = d;
  const estadoLembrete = lembrete.ativo
    ? `Ligado${lembrete.ligadoPor ? ` por ${lembrete.ligadoPor}` : ''}${lembrete.ligadoEm ? ` em ${quando(lembrete.ligadoEm)}` : ''}.`
    : lembrete.desligadoEm
      ? `Desligado${lembrete.desligadoPor ? ` por ${lembrete.desligadoPor}` : ''} em ${quando(lembrete.desligadoEm)}.`
      : 'Desligado — nunca foi ligado para este titular.';
  const estadoAsaas = avisoAsaas.desligado
    ? `Desligado${avisoAsaas.alteradoPor ? ` por ${avisoAsaas.alteradoPor}` : ''}${avisoAsaas.alteradoEm ? ` em ${quando(avisoAsaas.alteradoEm)}` : ''}${avisoAsaas.pendente ? ' — vale quando o cliente for criado no Asaas' : ''}.`
    : avisoAsaas.alteradoEm
      ? `Ligado — religado${avisoAsaas.alteradoPor ? ` por ${avisoAsaas.alteradoPor}` : ''} em ${quando(avisoAsaas.alteradoEm)}.`
      : 'Ligado — o Asaas avisa este cliente como sempre.';

  // O que o operador precisa saber ANTES de contar com o lembrete.
  const avisos: { tom: 'danger' | 'warn' | 'info'; texto: React.ReactNode }[] = [];
  if (d.semAvisoNenhum) avisos.push({ tom: 'danger', texto: 'Ninguém avisa este cliente: o lembrete está desligado e o aviso do Asaas também. Ligue o lembrete ou religue o aviso do Asaas.' });
  if (!d.whatsappValido) avisos.push({ tom: 'danger', texto: 'O WhatsApp do cadastro deste titular não é um número válido. Corrija o cadastro para poder ligar o lembrete.' });
  if (lembrete.ativo && !canal.enviosAutomaticos) {
    avisos.push({
      tom: 'warn',
      texto: <>Os envios automáticos estão desligados para todos: nada sai até ligar em <LinkArea to="/configuracoes/whatsapp" area={AreaSistema.CONFIGURACOES} className="font-semibold underline">Configuração › WhatsApp</LinkArea>.</>,
    });
  }
  if (lembrete.ativo && d.whatsappValido && !canal.enviaDeVerdade && canal.motivo) {
    avisos.push({ tom: canal.producao ? 'danger' : 'info', texto: `${canal.producao ? 'Retido' : 'Simulado'} para ${d.whatsapp}: ${canal.motivo}.` });
  }
  if (lembrete.ativo && !avisoAsaas.desligado) avisos.push({ tom: 'info', texto: 'O Asaas continua avisando este cliente. Para ele não receber em dobro, desligue o aviso do Asaas.' });

  const confirmacao: Record<Acao, { titulo: string; confirmar: string; variante: 'primaria' | 'perigo'; texto: React.ReactNode }> = {
    ligar: {
      titulo: 'Ligar o lembrete pelo WhatsApp',
      confirmar: 'Ligar lembrete',
      variante: 'primaria',
      texto: <>O cliente passa a receber, no número <b>{d.whatsapp}</b>, o aviso da fatura 2 dias antes do vencimento e no dia do vencimento, com o link para pagar. Ligue só se ele aceitou receber avisos por WhatsApp. Fica registrado que você ligou.</>,
    },
    desligar: {
      titulo: 'Desligar o lembrete pelo WhatsApp',
      confirmar: 'Desligar lembrete',
      variante: 'perigo',
      texto: avisoAsaas.desligado
        ? <>O cliente deixa de receber os lembretes. <b>Atenção:</b> o aviso do Asaas também está desligado para ele — depois de desligar aqui, ninguém o avisa até você religar o aviso do Asaas.</>
        : <>O cliente deixa de receber os lembretes pelo WhatsApp. O Asaas continua avisando.</>,
    },
    'asaas-desligar': {
      titulo: 'Desligar o aviso do Asaas',
      confirmar: 'Desligar o aviso do Asaas',
      variante: 'perigo',
      texto: avisoAsaas.clienteNoAsaas
        ? <>Isto <b>altera o cadastro deste cliente no Asaas</b>: o Asaas deixa de enviar os avisos de cobrança dele (SMS e e-mail). Quem avisa passa a ser só o lembrete pelo WhatsApp.</>
        : <>Este cliente ainda não existe no Asaas. A decisão fica registrada e ele já nasce sem os avisos do Asaas quando for criado lá.</>,
    },
    'asaas-religar': {
      titulo: 'Religar o aviso do Asaas',
      confirmar: 'Religar o aviso do Asaas',
      variante: 'primaria',
      texto: avisoAsaas.clienteNoAsaas
        ? <>Isto <b>altera o cadastro deste cliente no Asaas</b>: o Asaas volta a enviar os avisos de cobrança dele.{lembrete.ativo ? ' Com o lembrete ligado, ele recebe os dois.' : ''}</>
        : <>A decisão de nascer sem aviso é desfeita: quando o cliente for criado no Asaas, recebe os avisos normalmente.</>,
    },
  };

  const tom = { danger: { background: 'var(--danger-bg)', color: 'var(--danger-fg)' }, warn: { background: 'var(--warn-bg)', color: 'var(--warn-fg)' }, info: { background: 'var(--info-bg)', color: 'var(--info-fg)' } } as const;

  return (
    <Secao
      titulo="Lembretes de pagamento pelo WhatsApp"
      tag={
        <span className="rounded-full px-[10px] py-[2px] text-[11px] font-bold" style={lembrete.ativo ? { background: 'var(--ok-bg)', color: 'var(--ok-fg)' } : { background: 'var(--surface-input)', color: 'var(--text-label)' }}>
          {lembrete.ativo ? 'LIGADO' : 'DESLIGADO'}
        </span>
      }
    >
      <div className="flex flex-col gap-[12px] rounded-card p-[16px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="grid grid-cols-1 gap-[12px] md:grid-cols-2">
          <div className="flex flex-col gap-[6px]">
            <div className="text-[12px] font-semibold" style={{ color: 'var(--text-label)' }}>Lembrete do sistema (2 dias antes e no dia do vencimento)</div>
            <div className="text-[12.5px]" style={{ color: 'var(--text-body)' }}>{estadoLembrete}</div>
            {d.whatsapp && <div className="text-[12px] tabular-nums" style={muted}>Vai para {d.whatsapp}, o WhatsApp do cadastro.</div>}
            {/* Atalho para a conversa (doc 02 §24) — só existe se o cliente já escreveu. */}
            {d.conversa.numero && d.conversa.mensagens > 0 && (
              <LinkArea to={`/conversas?numero=${d.conversa.numero}`} area={AreaSistema.CARTEIRA_COBRANCA} className="text-[12px] font-semibold underline" style={{ color: 'var(--accent)' }}>
                {d.conversa.naoLidas > 0 ? `Abrir a conversa no WhatsApp — ${d.conversa.naoLidas} mensagem(ns) não lida(s) →` : 'Abrir a conversa no WhatsApp →'}
              </LinkArea>
            )}
            {podeAgir && (
              <div>
                {lembrete.ativo ? (
                  <Botao tamanho="sm" variante="secundaria" onClick={() => setAcao('desligar')}>Desligar lembrete</Botao>
                ) : (
                  <Botao tamanho="sm" variante="primaria" disabled={!d.whatsappValido} title={d.whatsappValido ? undefined : 'O WhatsApp do cadastro não é um número válido'} onClick={() => setAcao('ligar')}>
                    Ligar lembrete
                  </Botao>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-[6px]">
            <div className="text-[12px] font-semibold" style={{ color: 'var(--text-label)' }}>Aviso do próprio Asaas (SMS e e-mail)</div>
            <div className="text-[12.5px]" style={{ color: 'var(--text-body)' }}>{estadoAsaas}</div>
            {/* Desligar só existe com o lembrete ligado (doc 02 §28.1): senão ninguém avisaria o cliente. */}
            {podeAgir && (avisoAsaas.desligado || lembrete.ativo) && (
              <div>
                {avisoAsaas.desligado ? (
                  <Botao tamanho="sm" variante="secundaria" onClick={() => setAcao('asaas-religar')}>Religar o aviso do Asaas</Botao>
                ) : (
                  <Botao tamanho="sm" variante="secundaria" onClick={() => setAcao('asaas-desligar')}>Desligar o aviso do Asaas</Botao>
                )}
              </div>
            )}
          </div>
        </div>

        {avisos.map((a, i) => (
          <div key={i} className="rounded-[10px] px-[12px] py-[8px] text-[12px]" style={tom[a.tom]}>{a.texto}</div>
        ))}

        <Tabela<LembreteRegistrado>
          colunas={[
            { chave: 'fatura', titulo: 'Fatura', celular: 'titulo', render: (l) => `#${l.faturaNumero}` },
            { chave: 'vencimento', titulo: 'Vencimento', celular: 'subtitulo', classe: 'tabular-nums', render: (l) => dataBR(l.vencimento) },
            { chave: 'momento', titulo: 'Lembrete', celular: 'campo', render: (l) => `${nomeMomentoLembrete(l.momento)}${l.comPix ? ' · com Pix' : ''}` },
            { chave: 'situacao', titulo: 'Situação', celular: 'destaque', render: (l) => <StatusBadge label={nomeSituacaoLembrete(l.situacao)} colors={LEMBRETE_SITUACAO_COLORS} /> },
            {
              chave: 'quando',
              titulo: 'O que aconteceu',
              celular: 'campo',
              render: (l) => (
                <div className="flex min-w-0 flex-col gap-[2px]">
                  <span className="tabular-nums">{linhaDoTempo(l)}</span>
                  {l.motivo && <span style={muted}>{l.motivo}</span>}
                  {aberto === l.id && (
                    <span className="mt-[4px] whitespace-pre-wrap rounded-[8px] px-[10px] py-[6px]" style={{ background: 'var(--surface-input)', color: 'var(--text-primary)' }}>
                      {l.texto}
                      <span className="mt-[4px] block text-[11px]" style={muted}>
                        Para {l.destino ?? 'número inválido'} · modelo {l.modelo} ·{' '}
                        {l.comPix ? 'cartão com o valor e o botão “Copiar código Pix”' : 'botão “Ver fatura” com o link da Fatura Azit'}
                      </span>
                    </span>
                  )}
                </div>
              ),
            },
          ]}
          linhas={d.lembretes}
          chave={(l) => l.id}
          larguraMinima={720}
          vazio={lembrete.ativo ? 'Nenhum lembrete registrado ainda. O primeiro sai 2 dias antes do próximo vencimento.' : 'Nenhum lembrete registrado para este titular.'}
          acoes={(l) => (
            <span className="inline-flex flex-wrap items-center gap-[6px]">
              <Botao variante="fantasma" tamanho="sm" onClick={() => setAberto(aberto === l.id ? null : l.id)}>{aberto === l.id ? 'Ocultar mensagem' : 'Ver mensagem'}</Botao>
              {/* Ferramenta de teste: depois da entrada em produção o homolog não recebe entrega nem leitura da Meta. */}
              {FERRAMENTAS_TESTE && (l.situacao === 'ENVIADO' || l.situacao === 'ENTREGUE' || l.situacao === 'SIMULADO') && (
                <>
                  {!l.entregueEm && <Botao variante="fantasma" tamanho="sm" onClick={() => void simular(l.id, 'delivered')}>Teste: entregue</Botao>}
                  {!l.lidoEm && <Botao variante="fantasma" tamanho="sm" onClick={() => void simular(l.id, 'read')}>Teste: lido</Botao>}
                </>
              )}
            </span>
          )}
        />
      </div>

      {acao && (
        <ModalConfirmacao
          open
          titulo={confirmacao[acao].titulo}
          confirmar={confirmacao[acao].confirmar}
          variante={confirmacao[acao].variante}
          carregando={ocupado}
          onConfirmar={() => void executar()}
          onCancelar={() => setAcao(null)}
        >
          {confirmacao[acao].texto}
        </ModalConfirmacao>
      )}
    </Secao>
  );
}
