import { AuthService } from './auth.service';
import type { VerificadorGoogle } from './google-verificador';

// GET /auth/config (doc 06 §2.2, §2.4): o que a tela de login sabe antes de
// qualquer credencial. `senhaDisponivel` só é true quando existe usuário ATIVO
// com `permiteSenha` — regra "se ninguém pode, a opção não aparece" (Luís, 13/11).
function montar(comSenha: number, clientId: string | null) {
  const count = jest.fn().mockResolvedValue(comSenha);
  const prisma = { db: { usuario: { count } } };
  const verificador: VerificadorGoogle = {
    configurado: () => clientId !== null,
    clientId: () => clientId,
    verificar: jest.fn(),
  };
  const service = new AuthService(prisma as never, {} as never, { get: () => undefined } as never, verificador);
  return { service, count };
}

describe('AuthService.configPublica', () => {
  it('sem ninguém com senha liberada: senhaDisponivel=false (a tela esconde "entrar com senha")', async () => {
    const { service, count } = montar(0, 'client-id');
    await expect(service.configPublica()).resolves.toEqual({ googleClientId: 'client-id', senhaDisponivel: false });
    expect(count).toHaveBeenCalledWith({ where: { permiteSenha: true, ativo: true } });
  });

  it('com ao menos um usuário ativo com senha: senhaDisponivel=true', async () => {
    const { service } = montar(3, 'client-id');
    await expect(service.configPublica()).resolves.toEqual({ googleClientId: 'client-id', senhaDisponivel: true });
  });

  it('sem GOOGLE_CLIENT_ID: googleClientId=null, independente da senha', async () => {
    const { service } = montar(1, null);
    await expect(service.configPublica()).resolves.toEqual({ googleClientId: null, senhaDisponivel: true });
  });
});
