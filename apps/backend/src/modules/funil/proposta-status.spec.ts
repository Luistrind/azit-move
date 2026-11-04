import { derivarStatusProposta, FatosProposta } from './proposta-status';

// Status da proposta derivado dos fatos (04/11/2026). Sem banco.
const base: FatosProposta = { statusGravado: 'PENDENTE', contratoGeradoId: null, analise: null, parecer: null };

describe('derivarStatusProposta', () => {
  it('caso Arlindo: análise de cadastro aberta → EM_ANALISE, mesmo gravada PENDENTE', () => {
    expect(derivarStatusProposta({ ...base, analise: { status: 'CADASTRO_EM_PREENCHIMENTO' } })).toBe('EM_ANALISE');
    expect(derivarStatusProposta({ ...base, analise: { status: 'AGUARDANDO_COCAD' } })).toBe('EM_ANALISE');
  });
  it('análise liberada → APROVADA; não aprovada → REPROVADA; encerrada → CANCELADA', () => {
    expect(derivarStatusProposta({ ...base, analise: { status: 'LIBERADO_PARA_FORMALIZACAO' } })).toBe('APROVADA');
    expect(derivarStatusProposta({ ...base, analise: { status: 'NAO_APROVADO' } })).toBe('REPROVADA');
    expect(derivarStatusProposta({ ...base, analise: { status: 'PROPOSTA_ENCERRADA' } })).toBe('CANCELADA');
  });
  it('contrato gerado → CONVERTIDA, acima da análise', () => {
    expect(derivarStatusProposta({ ...base, contratoGeradoId: 'c1', analise: { status: 'LIBERADO_PARA_FORMALIZACAO' } })).toBe('CONVERTIDA');
  });
  it('contrato cancelado para reformalizar: EM_FORMALIZACAO gravado fica quando os fatos dizem aprovada', () => {
    expect(derivarStatusProposta({ ...base, statusGravado: 'EM_FORMALIZACAO', analise: { status: 'LIBERADO_PARA_FORMALIZACAO' } })).toBe('EM_FORMALIZACAO');
    expect(derivarStatusProposta({ ...base, statusGravado: 'EM_FORMALIZACAO', parecer: { resultado: 'APROVADO' } })).toBe('EM_FORMALIZACAO');
  });
  it('cancelada é evento: nenhum fato desfaz', () => {
    expect(derivarStatusProposta({ ...base, statusGravado: 'CANCELADA', analise: { status: 'CADASTRO_EM_PREENCHIMENTO' } })).toBe('CANCELADA');
    expect(derivarStatusProposta({ ...base, statusGravado: 'CANCELADA', contratoGeradoId: 'c1' })).toBe('CANCELADA');
  });
  it('parecer legado sem análise: aprovado/com ressalvas → APROVADA, reprovado → REPROVADA', () => {
    expect(derivarStatusProposta({ ...base, parecer: { resultado: 'APROVADO' } })).toBe('APROVADA');
    expect(derivarStatusProposta({ ...base, parecer: { resultado: 'APROVADO_COM_RESSALVAS' } })).toBe('APROVADA');
    expect(derivarStatusProposta({ ...base, parecer: { resultado: 'REPROVADO' } })).toBe('REPROVADA');
  });
  it('sem fato que decida, o gravado fica (Camada 1 reprovada, kanban, legado)', () => {
    expect(derivarStatusProposta({ ...base, statusGravado: 'REPROVADA' })).toBe('REPROVADA');
    expect(derivarStatusProposta({ ...base, statusGravado: 'EM_ANALISE' })).toBe('EM_ANALISE');
    expect(derivarStatusProposta(base)).toBe('PENDENTE');
  });
});
