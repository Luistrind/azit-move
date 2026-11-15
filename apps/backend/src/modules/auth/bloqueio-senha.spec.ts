import { DURACAO_BLOQUEIO_SENHA_MS, FALHAS_PARA_BLOQUEIO_SENHA } from '@azit/utils';
import { ControleBloqueioSenha } from './bloqueio-senha';

// Bloqueio temporário por usuário na entrada por senha (doc 06 §2.5): 10 falhas
// SEGUIDAS → 15 min; sucesso zera; bloqueio vence sozinho; chaves independentes.
describe('ControleBloqueioSenha', () => {
  it('bloqueia na 10ª falha seguida e solta depois de 15 minutos', () => {
    let agora = 0;
    const c = new ControleBloqueioSenha(() => agora);
    for (let i = 1; i < FALHAS_PARA_BLOQUEIO_SENHA; i++) {
      expect(c.registrarFalha('u1')).toBe(false);
      expect(c.bloqueado('u1')).toBe(false);
    }
    expect(c.registrarFalha('u1')).toBe(true);
    expect(c.bloqueado('u1')).toBe(true);
    agora = DURACAO_BLOQUEIO_SENHA_MS - 1;
    expect(c.bloqueado('u1')).toBe(true);
    agora = DURACAO_BLOQUEIO_SENHA_MS;
    expect(c.bloqueado('u1')).toBe(false);
  });

  it('um acerto no meio zera a contagem (as falhas precisam ser seguidas)', () => {
    const c = new ControleBloqueioSenha(() => 0);
    for (let i = 0; i < FALHAS_PARA_BLOQUEIO_SENHA - 1; i++) c.registrarFalha('u1');
    c.limpar('u1');
    for (let i = 0; i < FALHAS_PARA_BLOQUEIO_SENHA - 1; i++) expect(c.registrarFalha('u1')).toBe(false);
    expect(c.bloqueado('u1')).toBe(false);
  });

  it('usuários diferentes não compartilham contagem', () => {
    const c = new ControleBloqueioSenha(() => 0);
    for (let i = 0; i < FALHAS_PARA_BLOQUEIO_SENHA; i++) c.registrarFalha('u1');
    expect(c.bloqueado('u1')).toBe(true);
    expect(c.bloqueado('u2')).toBe(false);
  });
});
