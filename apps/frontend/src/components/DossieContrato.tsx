import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { dossieService, type Dossie } from '../services/dossie.service';
import { Modal } from '../components/Modal';
import { Botao } from '../components/Botao';
import { Bloco } from '../components/Bloco';
import { Tabela } from '../components/Tabela';
import { toast } from '../components/Toast';
import { mensagemErro } from '../lib/permissoes';
import { instanteBR } from '../lib/datas';
import { BotaoArea } from './BotaoArea';
import { AreaSistema } from '@azit/types';

// Dossiê para cobrança judicial (doc 02 §30): o operador escolhe as capturas do
// WhatsApp (ordem pelo nome do arquivo) e, se tiver, a notificação extrajudicial
// e o relatório do Infleet em PDF. O resto (contrato assinado, histórico,
// contrato social) o sistema já tem. Componentes genéricos, só tokens.

const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' } as const;

function tamanhoHumano(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

function ordenarPorNome(arquivos: File[]): File[] {
  return [...arquivos].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }));
}

export function ModalDossie({ contratoId, numero, onClose, onGerado }: { contratoId: string; numero: string; onClose: () => void; onGerado: () => Promise<void> | void }) {
  const navigate = useNavigate();
  const [capturas, setCapturas] = useState<File[]>([]);
  const [notificacao, setNotificacao] = useState<File | null>(null);
  const [infleet, setInfleet] = useState<File | null>(null);
  const [infleetDescricao, setInfleetDescricao] = useState('');
  const [observacao, setObservacao] = useState('');
  const [etapa, setEtapa] = useState<string | null>(null);
  const [gerado, setGerado] = useState<Dossie | null>(null);
  const empresa = useQuery({ queryKey: ['empresa-parametros'], queryFn: () => dossieService.parametrosEmpresa() });
  const semContratoSocial = empresa.data ? !empresa.data.contratoSocial : false;

  function removerCaptura(i: number) {
    setCapturas((lista) => lista.filter((_, k) => k !== i));
  }
  function mover(i: number, delta: -1 | 1) {
    setCapturas((lista) => {
      const alvo = i + delta;
      if (alvo < 0 || alvo >= lista.length) return lista;
      const nova = [...lista];
      [nova[i], nova[alvo]] = [nova[alvo], nova[i]];
      return nova;
    });
  }

  async function gerar() {
    if (!capturas.length) { toast.erro('Escolha ao menos uma captura da conversa.'); return; }
    try {
      const ids: string[] = [];
      for (let i = 0; i < capturas.length; i++) {
        setEtapa(`Enviando captura ${i + 1} de ${capturas.length}…`);
        const r = await dossieService.enviarArquivo(contratoId, 'captura', capturas[i]);
        ids.push(r.id);
      }
      let notificacaoId: string | undefined;
      let infleetId: string | undefined;
      if (notificacao) { setEtapa('Enviando a notificação extrajudicial…'); notificacaoId = (await dossieService.enviarArquivo(contratoId, 'notificacao', notificacao)).id; }
      if (infleet) { setEtapa('Enviando o relatório do Infleet…'); infleetId = (await dossieService.enviarArquivo(contratoId, 'infleet', infleet)).id; }
      setEtapa('Montando o PDF (contrato, histórico, capturas e anexos)…');
      const d = await dossieService.gerar(contratoId, { capturas: ids, notificacaoId, infleetId, infleetDescricao: infleetDescricao.trim() || undefined, observacao: observacao.trim() || undefined });
      setGerado(d);
      toast.sucesso(`Dossiê gerado: ${d.paginas} páginas.`);
      await onGerado();
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setEtapa(null);
    }
  }

  if (gerado) {
    return (
      <Modal open onClose={onClose} title={`Dossiê do contrato ${numero} gerado`} largura={620}>
        <div className="flex flex-col gap-[10px] text-[12.5px]">
          <p><b>{gerado.paginas} páginas</b> · {gerado.capturas} capturas · {tamanhoHumano(gerado.tamanho)}</p>
          <ul className="flex flex-col gap-[3px]" style={{ color: 'var(--text-secondary)' }}>
            {gerado.secoes.map((s) => <li key={s.chave}>p. {s.paginaInicial}{s.paginas > 1 ? `–${s.paginaInicial + s.paginas - 1}` : ''} · {s.titulo}</li>)}
          </ul>
          {gerado.avisos.length > 0 && (
            <ul className="flex flex-col gap-[3px]" style={{ color: 'var(--warn-fg)' }}>
              {gerado.avisos.map((a) => <li key={a}>⚠ {a}</li>)}
            </ul>
          )}
          <div className="flex flex-wrap justify-end gap-[8px]">
            <Botao variante="secundaria" tamanho="sm" onClick={onClose}>Fechar</Botao>
            <Botao variante="primaria" tamanho="sm" onClick={() => void dossieService.abrirPdf(gerado.id)}>Abrir o PDF</Botao>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={() => { if (!etapa) onClose(); }} title={`Dossiê para cobrança judicial — contrato ${numero}`} largura={680}>
      <div className="flex flex-col gap-[12px] text-[12.5px]">
        <p style={{ color: 'var(--text-secondary)' }}>
          O sistema monta um PDF único com o <b>contrato assinado</b>, o <b>histórico de pagamentos</b>, as <b>capturas da conversa no WhatsApp</b> (duas por página, numeradas) e o <b>contrato social da Azit</b>. Você só precisa escolher as capturas; notificação extrajudicial e relatório do Infleet entram se você anexar.
        </p>
        {semContratoSocial && (
          <div className="flex flex-wrap items-center gap-[8px] rounded-[10px] px-[12px] py-[8px]" style={{ background: 'var(--warn-bg)', color: 'var(--warn-fg)' }}>
            <span>Contrato social da Azit ainda não anexado — o dossiê sairá sem essa seção.</span>
            <BotaoArea area={AreaSistema.CONFIGURACOES} variante="secundaria" tamanho="sm" onClick={() => navigate('/configuracoes/documentos-empresa')}>Anexar em Configuração</BotaoArea>
          </div>
        )}
        <label className="flex flex-col gap-[4px] text-[12px]">
          <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Capturas da conversa no WhatsApp (PNG ou JPG) — ordem pelo nome do arquivo; ajuste abaixo se precisar</span>
          <input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={!!etapa} onChange={(e) => { setCapturas((atual) => ordenarPorNome([...atual, ...Array.from(e.target.files ?? [])])); e.target.value = ''; }} className="text-[12px]" />
        </label>
        {capturas.length > 0 && (
          <div className="flex max-h-[180px] flex-col gap-[3px] overflow-auto rounded-[10px] p-[8px]" style={{ background: 'var(--surface-input)' }}>
            {capturas.map((f, i) => (
              <div key={`${f.name}-${i}`} className="flex items-center gap-[8px] text-[11.5px]">
                <span className="w-[28px] font-bold tabular-nums" style={{ color: 'var(--text-label)' }}>{i + 1}</span>
                <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--text-primary)' }}>{f.name}</span>
                <span style={{ color: 'var(--text-muted)' }}>{tamanhoHumano(f.size)}</span>
                <button type="button" onClick={() => mover(i, -1)} disabled={!!etapa || i === 0} className="px-[4px]" title="Subir">↑</button>
                <button type="button" onClick={() => mover(i, 1)} disabled={!!etapa || i === capturas.length - 1} className="px-[4px]" title="Descer">↓</button>
                <button type="button" onClick={() => removerCaptura(i)} disabled={!!etapa} className="px-[4px]" title="Remover" style={{ color: 'var(--danger-fg)' }}>×</button>
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-2">
          <label className="flex flex-col gap-[4px] text-[12px]">
            <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Notificação extrajudicial (PDF, opcional)</span>
            <input type="file" accept="application/pdf" disabled={!!etapa} onChange={(e) => setNotificacao(e.target.files?.[0] ?? null)} className="text-[12px]" />
          </label>
          <label className="flex flex-col gap-[4px] text-[12px]">
            <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Relatório do Infleet (PDF, opcional)</span>
            <input type="file" accept="application/pdf" disabled={!!etapa} onChange={(e) => setInfleet(e.target.files?.[0] ?? null)} className="text-[12px]" />
          </label>
        </div>
        {infleet && (
          <label className="flex flex-col gap-[4px] text-[12px]">
            <span className="font-semibold" style={{ color: 'var(--text-label)' }}>O que o relatório do Infleet mostra (vai na capa do anexo)</span>
            <input value={infleetDescricao} onChange={(e) => setInfleetDescricao(e.target.value)} placeholder='ex: relatório "Detalhes do roteiro" do dia 18/08/2026 — remoção do dispositivo às 19:55' className="h-[34px] rounded-[10px] px-[10px] text-[13px]" style={inputStyle} />
          </label>
        )}
        <label className="flex flex-col gap-[4px] text-[12px]">
          <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Observação interna (opcional, não entra no PDF)</span>
          <input value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="ex: enviado ao escritório Fulano em 05/11" className="h-[34px] rounded-[10px] px-[10px] text-[13px]" style={inputStyle} />
        </label>
        {etapa && <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>{etapa}</div>}
        <div className="flex flex-wrap justify-end gap-[8px]">
          <Botao variante="secundaria" tamanho="sm" onClick={onClose} disabled={!!etapa}>Voltar</Botao>
          <Botao variante="primaria" tamanho="sm" onClick={() => void gerar()} carregando={!!etapa} disabled={!capturas.length}>Gerar dossiê</Botao>
        </div>
      </div>
    </Modal>
  );
}

// Bloco da ficha: dossiês já gerados para este contrato.
export function BlocoDossies({ contratoId }: { contratoId: string }) {
  const q = useQuery({ queryKey: ['contrato', contratoId, 'dossies'], queryFn: () => dossieService.listar(contratoId) });
  const lista = q.data ?? [];
  if (!lista.length) return null;
  return (
    <Bloco titulo="Dossiês para cobrança judicial" tag={`${lista.length} gerado(s)`}>
      <Tabela
        colunas={[
          { chave: 'quando', titulo: 'Gerado em', celular: 'titulo', classe: 'tabular-nums', render: (d: Dossie) => instanteBR(d.geradoEm) },
          { chave: 'quem', titulo: 'Por', celular: 'subtitulo', render: (d: Dossie) => d.geradoPor ?? '—' },
          { chave: 'conteudo', titulo: 'Conteúdo', celular: 'campo', render: (d: Dossie) => `${d.paginas} páginas · ${d.capturas} capturas · ${d.secoes.filter((s) => s.chave !== 'capa').map((s) => s.titulo.replace(/^Anexo — /, '')).join(', ')}` },
          { chave: 'avisos', titulo: 'Avisos', celular: 'campo', render: (d: Dossie) => (d.avisos.length ? <span style={{ color: 'var(--warn-fg)' }}>{d.avisos.length}</span> : '—') },
        ]}
        linhas={lista}
        chave={(d) => d.id}
        larguraMinima={520}
        acoes={(d) => <Botao variante="secundaria" tamanho="sm" onClick={() => void dossieService.abrirPdf(d.id)}>Abrir PDF</Botao>}
      />
    </Bloco>
  );
}
