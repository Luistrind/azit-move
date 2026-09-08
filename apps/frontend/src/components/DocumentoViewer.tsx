import { useEffect, useState } from 'react';
import { api } from '../lib/api';

// Visualização INLINE de documentos anexados (feedback Luís 08/09, homologação):
// imagem e PDF abrem num modal, sem precisar baixar. O arquivo vem por blob do
// endpoint de download; o mime é derivado da extensão do nome (o endpoint não
// envia content-type). Formato sem visualização cai no fallback com download.

function mimeDe(nome: string): string {
  const ext = nome.toLowerCase().split('.').pop() ?? '';
  const mapa: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
    gif: 'image/gif', bmp: 'image/bmp', pdf: 'application/pdf',
  };
  return mapa[ext] ?? 'application/octet-stream';
}

export function useDocumentoViewer() {
  const [doc, setDoc] = useState<{ nome: string; url: string; mime: string } | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function abrir(docId: string, nome: string) {
    setCarregando(true);
    try {
      const resp = await api.get(`/api/v1/propostas/documentos/${docId}/download`, { responseType: 'blob' });
      const mime = mimeDe(nome);
      const url = URL.createObjectURL(new Blob([resp.data as Blob], { type: mime }));
      setDoc({ nome, url, mime });
    } finally {
      setCarregando(false);
    }
  }

  function fechar() {
    if (doc) URL.revokeObjectURL(doc.url);
    setDoc(null);
  }

  return { doc, abrir, fechar, carregando };
}

export function DocumentoViewer({ doc, onClose }: { doc: { nome: string; url: string; mime: string }; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const ehImagem = doc.mime.startsWith('image/');
  const ehPdf = doc.mime === 'application/pdf';

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-[20px]"
      style={{ background: 'rgba(0,16,41,.6)' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-[900px] max-w-full flex-col overflow-hidden rounded-[14px]"
        style={{ background: 'var(--surface)', boxShadow: '0 30px 80px rgba(0,16,41,.4)' }}
      >
        <div className="flex items-center justify-between px-[16px] py-[12px]" style={{ borderBottom: '1px solid var(--border)' }}>
          <span className="truncate text-[13px] font-bold">{doc.nome}</span>
          <div className="flex items-center gap-[12px]">
            <a href={doc.url} download={doc.nome} className="text-[12.5px] font-semibold" style={{ color: 'var(--navy)' }}>
              Baixar
            </a>
            <button onClick={onClose} className="text-[18px] leading-none" style={{ color: 'var(--text-muted)' }} aria-label="Fechar">×</button>
          </div>
        </div>
        <div className="flex min-h-[300px] flex-1 items-center justify-center overflow-auto p-[12px]" style={{ background: 'var(--surface-input)' }}>
          {ehImagem && <img src={doc.url} alt={doc.nome} className="max-h-[78vh] max-w-full rounded-[8px]" />}
          {ehPdf && <iframe src={doc.url} title={doc.nome} className="h-[78vh] w-full rounded-[8px]" style={{ border: 'none', background: '#fff' }} />}
          {!ehImagem && !ehPdf && (
            <div className="p-[24px] text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
              Este formato não tem visualização — use o botão Baixar acima.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
