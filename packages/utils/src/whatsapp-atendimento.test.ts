import { describe, it, expect } from 'vitest';
import { EtiquetaContato, TipoMidiaSaidaWhatsapp } from '@azit/types';
import { etiquetaDoContato, ultimaAtividadeConversa, validarMidiaSaidaWhatsapp } from './whatsapp';

// Conversas como atendimento (doc 02 §34).
describe('etiquetaDoContato (§34.3)', () => {
  it('cliente quando há contrato ativo, mesmo com outros encerrados', () => {
    expect(etiquetaDoContato({ titular: { statusContratos: ['ENCERRADO', 'ATIVO'] }, temLead: false })).toBe(EtiquetaContato.CLIENTE);
  });
  it('ex-cliente quando todos os contratos estão encerrados', () => {
    expect(etiquetaDoContato({ titular: { statusContratos: ['ENCERRADO', 'ENCERRADO'] }, temLead: true })).toBe(EtiquetaContato.EX_CLIENTE);
  });
  it('lead quando o titular só tem contrato antes do dia zero ou nenhum contrato', () => {
    expect(etiquetaDoContato({ titular: { statusContratos: ['AGUARDANDO_ASSINATURA'] }, temLead: false })).toBe(EtiquetaContato.LEAD);
    expect(etiquetaDoContato({ titular: { statusContratos: ['ENCERRADO', 'AGUARDANDO_PAGAMENTO_INICIAL'] }, temLead: false })).toBe(EtiquetaContato.LEAD);
    expect(etiquetaDoContato({ titular: { statusContratos: [] }, temLead: false })).toBe(EtiquetaContato.LEAD);
  });
  it('lead do funil sem titular', () => {
    expect(etiquetaDoContato({ titular: null, temLead: true })).toBe(EtiquetaContato.LEAD);
  });
  it('não cadastrado quando não há titular nem lead', () => {
    expect(etiquetaDoContato({ titular: null, temLead: false })).toBe(EtiquetaContato.NAO_CADASTRADO);
  });
  it('aceita o status em qualquer caixa', () => {
    expect(etiquetaDoContato({ titular: { statusContratos: ['ativo'] }, temLead: false })).toBe(EtiquetaContato.CLIENTE);
  });
});

describe('validarMidiaSaidaWhatsapp (§34.6)', () => {
  it('aceita JPG até 5 MB e recusa acima', () => {
    expect(validarMidiaSaidaWhatsapp(TipoMidiaSaidaWhatsapp.IMAGEM, 'image/jpeg', 5 * 1024 * 1024)).toBeNull();
    expect(validarMidiaSaidaWhatsapp(TipoMidiaSaidaWhatsapp.IMAGEM, 'image/jpeg', 5 * 1024 * 1024 + 1)).toMatch(/5 MB/);
  });
  it('recusa imagem fora de JPG/PNG', () => {
    expect(validarMidiaSaidaWhatsapp(TipoMidiaSaidaWhatsapp.IMAGEM, 'image/gif', 10)).toMatch(/JPG ou PNG/);
  });
  it('aceita o áudio do navegador com codecs no tipo', () => {
    expect(validarMidiaSaidaWhatsapp(TipoMidiaSaidaWhatsapp.AUDIO, 'audio/webm;codecs=opus', 1000)).toBeNull();
  });
  it('documento PDF até 20 MB; arquivo vazio recusado', () => {
    expect(validarMidiaSaidaWhatsapp(TipoMidiaSaidaWhatsapp.DOCUMENTO, 'application/pdf', 20 * 1024 * 1024)).toBeNull();
    expect(validarMidiaSaidaWhatsapp(TipoMidiaSaidaWhatsapp.DOCUMENTO, 'application/pdf', 0)).toMatch(/vazio/);
    expect(validarMidiaSaidaWhatsapp(TipoMidiaSaidaWhatsapp.DOCUMENTO, 'application/zip', 10)).toMatch(/Formato/);
  });
});

describe('ultimaAtividadeConversa (§34.2)', () => {
  it('o lembrete mais novo que a última mensagem conta como atividade', () => {
    expect(ultimaAtividadeConversa('2026-11-22T14:00:00.000Z', '2026-11-25T12:00:00.000Z')).toEqual({ em: '2026-11-25T12:00:00.000Z', origem: 'lembrete' });
  });
  it('a mensagem mais nova vence', () => {
    expect(ultimaAtividadeConversa('2026-11-25T13:00:00.000Z', '2026-11-25T12:00:00.000Z')).toEqual({ em: '2026-11-25T13:00:00.000Z', origem: 'mensagem' });
  });
  it('só lembrete, ou nada', () => {
    expect(ultimaAtividadeConversa(null, '2026-11-25T12:00:00.000Z').origem).toBe('lembrete');
    expect(ultimaAtividadeConversa(null, null)).toEqual({ em: null, origem: null });
  });
});
