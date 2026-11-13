import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { formatCurrency, type AcertoRescisao } from '@azit/utils';
import { operacoesService, type Rescisao } from '../services/operacoes.service';
import { Modal } from '../components/Modal';
import { Botao } from '../components/Botao';
import { Bloco } from '../components/Bloco';
import { Metrica } from '../components/Metrica';
import { Tabela } from '../components/Tabela';
import { toast } from '../components/Toast';
import { mensagemErro } from '../lib/permissoes';
import { dataBR, hojeBrasilISO } from '../lib/datas';
import { BotaoArea } from './BotaoArea';
import { AreaSistema } from '@azit/types';

// Rescisão por inadimplência (doc 02 §29, decisão Luís 04/11/2026). Componentes
// genéricos configurados por props; a CONTA do acerto é do backend (@azit/utils):
// aqui só se exibe a memória — base dos 20% = principal pago (entrada +
// parcelas), o crédito quita as parcelas vencidas até a data-base, o resto é a
// devolver ou saldo remanescente; parcelas futuras não são cobradas.

const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' } as const;

function MemoriaAcerto({ a }: { a: AcertoRescisao }) {
  const resultado = a.valorADevolver > 0
    ? { label: 'A devolver ao cliente', valor: formatCurrency(a.valorADevolver), cor: 'var(--ok-fg)' }
    : a.saldoRemanescente > 0
      ? { label: 'Saldo remanescente (cliente fica devendo)', valor: formatCurrency(a.saldoRemanescente), cor: 'var(--danger-fg)' }
      : { label: 'Resultado', valor: 'Crédito e dívida se anulam', cor: undefined };
  return (
    <div className="flex flex-col gap-[10px]">
      <div className="grid grid-cols-1 gap-[8px] sm:grid-cols-2 lg:grid-cols-3">
        <Metrica tom="claro" label="Principal pago" valor={formatCurrency(a.principalPago)} detalhe={`entrada ${formatCurrency(a.entradaPaga)} + ${a.parcelasPagas} parcela(s) ${formatCurrency(a.principalParcelas)}`} />
        <Metrica tom="claro" label={`Crédito do cliente (${a.percentualCredito}%)`} valor={formatCurrency(a.valorCredito)} detalhe="só sobre o principal: sem proteção, taxas ou encargos" />
        <Metrica tom="claro" label="Dívida vencida na data-base" valor={formatCurrency(a.dividaTotal)} detalhe={`${a.vencidas.length} parcela(s) ${formatCurrency(a.dividaVencida)} + encargos ${formatCurrency(a.encargosVencidos)}`} />
        <Metrica tom="claro" label="Compensado com o crédito" valor={formatCurrency(a.valorCompensado)} />
        <Metrica tom="claro" label={resultado.label} valor={<span style={{ color: resultado.cor }}>{resultado.valor}</span>} />
        <Metrica tom="claro" label="Parcelas futuras não cobradas" valor={String(a.futuras.quantidade)} detalhe={formatCurrency(a.futuras.valorNominal)} />
      </div>
      {a.vencidas.length > 0 && (
        <Tabela
          colunas={[
            { chave: 'parcela', titulo: 'Parcela', celular: 'titulo', render: (v) => v.display },
            { chave: 'venc', titulo: 'Vencimento', celular: 'subtitulo', classe: 'tabular-nums', render: (v) => dataBR(v.dataVencimento) },
            { chave: 'dias', titulo: 'Dias', alinhar: 'right', celular: 'campo', classe: 'tabular-nums', render: (v) => String(v.diasAtraso) },
            { chave: 'valor', titulo: 'Valor', alinhar: 'right', celular: 'campo', classe: 'tabular-nums', render: (v) => formatCurrency(v.valorNominal) },
            { chave: 'encargo', titulo: 'Encargo', alinhar: 'right', celular: 'campo', classe: 'tabular-nums', render: (v) => formatCurrency(v.encargo) },
            { chave: 'total', titulo: 'Total', alinhar: 'right', celular: 'destaque', classe: 'tabular-nums', render: (v) => formatCurrency(v.total) },
          ]}
          linhas={a.vencidas}
          chave={(v) => v.id}
          larguraMinima={520}
        />
      )}
    </div>
  );
}

// Modal: data-base (retomada) + observação → prévia → pede aprovação.
export function ModalRescisao({ contratoId, onClose, onSolicitado }: { contratoId: string; onClose: () => void; onSolicitado: () => Promise<void> | void }) {
  const [dataBase, setDataBase] = useState(hojeBrasilISO());
  const [observacao, setObservacao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const previa = useQuery({
    queryKey: ['rescisao-previa', contratoId, dataBase],
    queryFn: () => operacoesService.previaRescisao(contratoId, dataBase),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(dataBase),
  });
  useEffect(() => {
    if (previa.isError) toast.erro(mensagemErro(previa.error));
  }, [previa.isError, previa.error]);

  async function confirmar() {
    setEnviando(true);
    try {
      await operacoesService.solicitarRescisao(contratoId, { dataBase, observacao: observacao.trim() || undefined });
      toast.sucesso('Rescisão proposta — segue para a Central de Aprovações (1 aprovação).');
      await onSolicitado();
      onClose();
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  const p = previa.data;
  return (
    <Modal open onClose={onClose} title="Rescindir contrato por inadimplência" largura={760}>
      <div className="flex flex-col gap-[12px] text-[12.5px]">
        <p style={{ color: 'var(--text-secondary)' }}>
          O contrato se resolve com a retomada do veículo (cláusula 8.4.1). O cliente tem direito a <b>20% do principal pago</b> (entrada + parcelas); esse crédito quita as parcelas vencidas até a data-base e o que sobrar volta ao cliente — o que faltar fica como saldo remanescente. Parcelas futuras não são cobradas. A efetivação depende de <b>uma aprovação</b> na Central.
        </p>
        <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-[200px_1fr]">
          <label className="flex flex-col gap-[4px] text-[12px]">
            <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Data da retomada (data-base)</span>
            <input type="date" value={dataBase} max={hojeBrasilISO()} onChange={(e) => setDataBase(e.target.value)} className="h-[34px] rounded-[10px] px-[10px] text-[13px]" style={inputStyle} />
          </label>
          <label className="flex flex-col gap-[4px] text-[12px]">
            <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Observação para quem aprova</span>
            <input value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="ex: veículo retomado no pátio em 03/11, cliente sem contato desde outubro" className="h-[34px] rounded-[10px] px-[10px] text-[13px]" style={inputStyle} />
          </label>
        </div>
        {previa.isLoading && <div style={{ color: 'var(--text-muted)' }}>Calculando o acerto…</div>}
        {p && (
          <>
            {!p.elegivel && (
              <div className="rounded-[10px] px-[12px] py-[8px]" style={{ background: 'var(--warn-bg)', color: 'var(--warn-fg)' }}>{p.motivoInelegivel}</div>
            )}
            <div className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
              {p.contrato.numero}{p.contrato.ativo ? ` · ${p.contrato.ativo.descricao}${p.contrato.ativo.placa ? ` · ${p.contrato.ativo.placa}` : ''}` : ''} · {p.contrato.diasAtraso} dia(s) de atraso hoje · {formatCurrency(p.contrato.saldoEmAberto)} em aberto no cronograma
            </div>
            <MemoriaAcerto a={p.acerto} />
          </>
        )}
        <div className="flex flex-wrap justify-end gap-[8px]">
          <Botao variante="secundaria" tamanho="sm" onClick={onClose}>Voltar</Botao>
          <Botao variante="perigo" tamanho="sm" onClick={() => void confirmar()} disabled={enviando || !p?.elegivel}>Pedir rescisão</Botao>
        </div>
      </div>
    </Modal>
  );
}

// Bloco da ficha: rescisão pendente (link ao dossiê) ou acerto efetivado, com a
// devolução ao cliente pendente/feita e o saldo remanescente.
export function BlocoRescisao({ contratoId, encerradoPorRescisao, podeOperar }: { contratoId: string; encerradoPorRescisao: boolean; podeOperar: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['contrato', contratoId, 'rescisoes'], queryFn: () => operacoesService.rescisoes(contratoId) });
  const [devolvendo, setDevolvendo] = useState<Rescisao | null>(null);
  const [dataDevolucao, setDataDevolucao] = useState(hojeBrasilISO());
  const [obsDevolucao, setObsDevolucao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const lista = q.data ?? [];
  const pendente = lista.find((r) => r.status === 'pendente');
  const efetivada = lista.find((r) => r.status === 'efetivada');

  async function registrarDevolucao() {
    if (!devolvendo) return;
    setEnviando(true);
    try {
      await operacoesService.registrarDevolucaoRescisao(devolvendo.id, { data: dataDevolucao, observacao: obsDevolucao.trim() || undefined });
      toast.sucesso('Devolução registrada.');
      setDevolvendo(null);
      await queryClient.invalidateQueries({ queryKey: ['contrato', contratoId, 'rescisoes'] });
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  if (pendente) {
    return (
      <div className="flex flex-wrap items-center gap-[10px] rounded-card px-[16px] py-[12px] text-[12.5px]" style={{ background: 'var(--warn-bg)', color: 'var(--warn-fg)', border: '1px solid var(--border)' }}>
        <span>Rescisão por inadimplência <b>aguardando aprovação</b> na Central (data-base {dataBR(pendente.dataBase)}; crédito {formatCurrency(pendente.acerto.valorCredito)}; {pendente.acerto.valorADevolver > 0 ? `a devolver ${formatCurrency(pendente.acerto.valorADevolver)}` : `saldo remanescente ${formatCurrency(pendente.acerto.saldoRemanescente)}`}).</span>
        {pendente.aprovacaoId && (
          <BotaoArea area={AreaSistema.APROVACOES} variante="secundaria" tamanho="sm" onClick={() => navigate(`/aprovacoes/${pendente.aprovacaoId}`)}>Ver dossiê →</BotaoArea>
        )}
      </div>
    );
  }
  if (!encerradoPorRescisao || !efetivada) return null;
  const a = efetivada.acerto;
  return (
    <Bloco
      titulo="Acerto da rescisão"
      tag={`data-base ${dataBR(efetivada.dataBase)}`}
      leitura={
        <>
          Crédito de <b>{formatCurrency(a.valorCredito)}</b> ({a.percentualCredito}% do principal pago) compensou <b>{formatCurrency(a.valorCompensado)}</b> de {a.vencidas.length} parcela(s) vencida(s)
          {a.valorADevolver > 0 ? <> · <b>{formatCurrency(a.valorADevolver)}</b> a devolver ao cliente{efetivada.devolvidoEm ? <> (devolvido em <b>{dataBR(efetivada.devolvidoEm)}</b>)</> : ' — pendente'}</> : null}
          {a.saldoRemanescente > 0 ? <> · o cliente fica devendo <b>{formatCurrency(a.saldoRemanescente)}</b> (cobrança fora do cronograma: acordo ou judicial)</> : null}.
        </>
      }
      acao={
        podeOperar && a.valorADevolver > 0 && !efetivada.devolvidoEm ? (
          <Botao variante="primaria" tamanho="sm" onClick={() => setDevolvendo(efetivada)}>Registrar devolução feita</Botao>
        ) : undefined
      }
    >
      <MemoriaAcerto a={a} />
      {efetivada.observacao && <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>Observação do pedido: {efetivada.observacao}</div>}
      {efetivada.devolucaoObservacao && <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>Devolução: {efetivada.devolucaoObservacao}</div>}
      {efetivada.avisos.length > 0 && (
        <ul className="flex flex-col gap-[4px] text-[12px]" style={{ color: 'var(--warn-fg)' }}>
          {efetivada.avisos.map((v) => <li key={v}>⚠ {v}</li>)}
        </ul>
      )}
      {devolvendo && (
        <Modal open onClose={() => setDevolvendo(null)} title="Registrar devolução ao cliente">
          <div className="flex flex-col gap-[10px] text-[12.5px]">
            <p>Registra que os <b>{formatCurrency(devolvendo.acerto.valorADevolver)}</b> foram devolvidos ao cliente. O pagamento em si é feito fora do sistema (placeholder — gerar título em Contas a Pagar é decisão futura).</p>
            <label className="flex flex-col gap-[4px] text-[12px]">
              <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Data da devolução</span>
              <input type="date" value={dataDevolucao} max={hojeBrasilISO()} onChange={(e) => setDataDevolucao(e.target.value)} className="h-[34px] rounded-[10px] px-[10px] text-[13px]" style={inputStyle} />
            </label>
            <label className="flex flex-col gap-[4px] text-[12px]">
              <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Observação (opcional)</span>
              <input value={obsDevolucao} onChange={(e) => setObsDevolucao(e.target.value)} placeholder="ex: PIX para a conta informada pelo cliente" className="h-[34px] rounded-[10px] px-[10px] text-[13px]" style={inputStyle} />
            </label>
            <div className="flex flex-wrap justify-end gap-[8px]">
              <Botao variante="secundaria" tamanho="sm" onClick={() => setDevolvendo(null)}>Voltar</Botao>
              <Botao variante="primaria" tamanho="sm" onClick={() => void registrarDevolucao()} disabled={enviando}>Registrar devolução</Botao>
            </div>
          </div>
        </Modal>
      )}
    </Bloco>
  );
}
