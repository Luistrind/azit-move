// Leitura do payload PIX (BR Code / EMV-MPM) — só o que a Fatura Azit precisa:
// o VALOR que o QR cobra (campo 54). O formato é TLV plano: id (2 dígitos),
// tamanho (2 dígitos), valor. Não é fórmula de negócio; é leitura de formato.
export function valorDoPayloadPix(payload: string): number | null {
  let i = 0;
  while (i + 4 <= payload.length) {
    const id = payload.slice(i, i + 2);
    const tam = Number(payload.slice(i + 2, i + 4));
    if (!Number.isFinite(tam)) return null;
    const valor = payload.slice(i + 4, i + 4 + tam);
    if (id === '54') {
      const reais = Number(valor);
      return Number.isFinite(reais) ? Math.round(reais * 100) : null;
    }
    i += 4 + tam;
  }
  return null;
}

// Payload de ambiente SIMULADO (sem Asaas): tem o mesmo campo 54 para a
// página e o leitor acima funcionarem; o app do banco não reconhece — e a
// página avisa que é simulado.
export function payloadPixSimulado(referencia: string, valorCentavos: number): string {
  const valor = (valorCentavos / 100).toFixed(2);
  const ref = `SIMULADO-${referencia}`.slice(0, 99);
  const tlv = (id: string, v: string) => `${id}${String(v.length).padStart(2, '0')}${v}`;
  return tlv('00', '01') + tlv('26', tlv('00', 'br.gov.bcb.pix') + tlv('25', ref)) + tlv('52', '0000') + tlv('53', '986') + tlv('54', valor) + tlv('58', 'BR') + tlv('59', 'AZIT MOVE (SIMULADO)') + tlv('60', 'VITORIA');
}
