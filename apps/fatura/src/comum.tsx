import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { diaSemanaISO } from '@azit/utils';

// Peças comuns às duas telas da Fatura Azit (modelo antigo e modelo AZIT).

const DIAS_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
// Dia da semana por extenso de um 'YYYY-MM-DD' (o cálculo é o de @azit/utils).
export const diaSemana = (iso: string) => DIAS_SEMANA[diaSemanaISO(iso)];

export function Marca() {
  return (
    <div className="marca">
      <img src="/marca-icone.png" alt="" width={32} height={32} />
      <div className="wm">azit<b>move</b></div>
    </div>
  );
}

// QR Code desenhado a partir do copia-e-cola (o mesmo código que o botão copia).
export function QrPix({ payload, tamanho }: { payload: string; tamanho: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    void QRCode.toCanvas(ref.current, payload, { width: tamanho, margin: 1, color: { dark: '#001029', light: '#ffffff' } });
  }, [payload, tamanho]);
  return <canvas ref={ref} aria-label="QR Code Pix" />;
}

// Link do WhatsApp da Azit com a mensagem pronta.
export function linkWhatsapp(digitos: string, texto: string): string {
  return `https://wa.me/${digitos}?text=${encodeURIComponent(texto)}`;
}
