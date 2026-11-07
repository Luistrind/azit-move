import { describe, expect, it } from 'vitest';
import {
  DIAS_VALIDADE_APROVACAO_ESPERA,
  aprovacaoExpirada,
  diasRestantesAprovacao,
  situacaoListaEspera,
  validadeAprovacaoEspera,
} from './lista-espera';
import { DIA_MS } from './datas';

// Doc 02 §31.3: validade 60 dias; situação calculada (Regra 7).
describe('lista de espera', () => {
  const agora = new Date('2026-11-03T15:00:00Z');
  const dias = (n: number) => new Date(agora.getTime() - n * DIA_MS);

  it('validade é aprovação + 60 dias', () => {
    expect(DIAS_VALIDADE_APROVACAO_ESPERA).toBe(60);
    expect(validadeAprovacaoEspera(dias(0)).getTime()).toBe(agora.getTime() + 60 * DIA_MS);
  });

  it('na fila enquanto vale; expirada depois de 60 dias', () => {
    expect(situacaoListaEspera({ aprovadaEm: dias(10), veiculoAtribuidoEm: null, veiculoConferidoEm: null }, agora)).toBe('na_fila');
    expect(situacaoListaEspera({ aprovadaEm: dias(59), veiculoAtribuidoEm: null, veiculoConferidoEm: null }, agora)).toBe('na_fila');
    expect(situacaoListaEspera({ aprovadaEm: dias(61), veiculoAtribuidoEm: null, veiculoConferidoEm: null }, agora)).toBe('expirada');
    expect(aprovacaoExpirada(dias(61), agora)).toBe(true);
    expect(aprovacaoExpirada(null, agora)).toBe(false);
  });

  it('veículo atribuído → em conferência; conferido → pronta (mesmo vencida)', () => {
    expect(situacaoListaEspera({ aprovadaEm: dias(5), veiculoAtribuidoEm: dias(1), veiculoConferidoEm: null }, agora)).toBe('em_conferencia');
    expect(situacaoListaEspera({ aprovadaEm: dias(70), veiculoAtribuidoEm: dias(1), veiculoConferidoEm: dias(0) }, agora)).toBe('pronta');
  });

  it('dias restantes', () => {
    expect(diasRestantesAprovacao(dias(10), agora)).toBe(50);
    expect(diasRestantesAprovacao(dias(65), agora)).toBe(-5);
    expect(diasRestantesAprovacao(null, agora)).toBeNull();
  });
});
