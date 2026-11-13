import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { FormaAcesso, RoleUsuario } from '@prisma/client';
import { FALHAS_PARA_BLOQUEIO_SENHA, MENSAGEM_FALHA_ENTRADA } from '@azit/utils';
import { AuthService } from './auth.service';
import { ControleBloqueioSenha } from './bloqueio-senha';
import { IdentidadeGoogle, VerificadorGoogle } from './google-verificador';

// AuthService (doc 06 v1.1 §2, §10.1, §10.1-A) com dublês: nada de banco, JWT real
// ou rede do Google. O que se garante aqui:
//  - Google: token inválido, e-mail não verificado, domínio de fora, e-mail sem
//    usuário, usuário inativo, 1º acesso grava o sub, sub divergente, sucesso,
//    sem GOOGLE_CLIENT_ID → 503;
//  - senha: permiteSenha desligado, bloqueio após 10 falhas, sucesso;
//  - toda falha responde o MESMO 401 e grava o motivo SÓ no registro de acessos.

const HASH = bcrypt.hashSync('senha-de-reserva', 4);

function usuario(extra: Partial<{
  id: string; email: string; ativo: boolean; senhaHash: string | null; permiteSenha: boolean; googleSub: string | null;
}> = {}) {
  return {
    id: 'u1', nome: 'João', email: 'joao@azit.com.br', ativo: true,
    senhaHash: HASH, permiteSenha: true, googleSub: null,
    roles: [{ role: RoleUsuario.OPERADOR }],
    ...extra,
  };
}

function montar(opts: { usuario?: ReturnType<typeof usuario> | null; identidade?: Partial<IdentidadeGoogle> | Error; configurado?: boolean; bloqueio?: ControleBloqueioSenha } = {}) {
  const findFirst = jest.fn().mockResolvedValue(opts.usuario === undefined ? usuario() : opts.usuario);
  const update = jest.fn().mockResolvedValue({});
  const acessoCreate = jest.fn().mockResolvedValue({});
  const prisma = {
    db: {
      usuario: { findFirst, update, count: jest.fn().mockResolvedValue(1) },
      refreshToken: { create: jest.fn().mockResolvedValue({}), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 2 }), findUnique: jest.fn(), count: jest.fn() },
      acessoUsuario: { create: acessoCreate, findMany: jest.fn().mockResolvedValue([]) },
    },
  };
  const jwt = { signAsync: jest.fn().mockResolvedValue('access-token') };
  const config = { get: (k: string) => ({ 'jwt.secret': 's', 'jwt.accessExpiresIn': '15m', 'jwt.refreshExpiresInDays': 7 })[k] };
  const identidade: IdentidadeGoogle = {
    sub: 'google-sub-1', email: 'joao@azitmove.com.br', emailVerificado: true, hd: 'azitmove.com.br', nome: 'João',
    ...(opts.identidade instanceof Error ? {} : opts.identidade),
  };
  const verificador: VerificadorGoogle = {
    configurado: () => opts.configurado ?? true,
    clientId: () => (opts.configurado ?? true ? 'client-id' : null),
    verificar: jest.fn(async () => {
      if (opts.identidade instanceof Error) throw opts.identidade;
      return identidade;
    }),
  };
  const service = new AuthService(prisma as never, jwt as never, config as never, verificador, opts.bloqueio);
  const ctx = { ip: '10.0.0.1', agente: 'jest' };
  const ultimoAcesso = () => acessoCreate.mock.calls.at(-1)?.[0]?.data as { usuarioId: string | null; emailTentado: string | null; forma: FormaAcesso; sucesso: boolean; motivo: string | null; ip: string | null };
  return { service, prisma, findFirst, update, acessoCreate, ultimoAcesso, ctx };
}

async function esperarFalhaGenerica(p: Promise<unknown>) {
  await expect(p).rejects.toBeInstanceOf(UnauthorizedException);
  try {
    await p;
  } catch (e) {
    const corpo = (e as UnauthorizedException).getResponse() as { erro: string; mensagem: string };
    expect(corpo).toEqual({ erro: 'credenciais_invalidas', mensagem: MENSAGEM_FALHA_ENTRADA });
  }
}

describe('AuthService — entrar com Google (doc 06 §2.2)', () => {
  it('sem GOOGLE_CLIENT_ID responde 503 google_nao_configurado e não grava acesso', async () => {
    const m = montar({ configurado: false });
    await expect(m.service.loginGoogle('tok', m.ctx)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(m.acessoCreate).not.toHaveBeenCalled();
    await expect(m.service.configPublica()).resolves.toEqual({ googleClientId: null, senhaDisponivel: true });
  });

  it('token inválido → 401 genérico, motivo token_invalido no registro, sem e-mail', async () => {
    const m = montar({ identidade: new Error('Wrong recipient, payload audience != requiredAudience') });
    await esperarFalhaGenerica(m.service.loginGoogle('tok', m.ctx));
    expect(m.ultimoAcesso()).toMatchObject({ forma: FormaAcesso.GOOGLE, sucesso: false, motivo: 'token_invalido', usuarioId: null, emailTentado: null, ip: '10.0.0.1' });
    expect(m.findFirst).not.toHaveBeenCalled();
  });

  it('e-mail não verificado é recusado antes de olhar o cadastro', async () => {
    const m = montar({ identidade: { emailVerificado: false } });
    await esperarFalhaGenerica(m.service.loginGoogle('tok', m.ctx));
    expect(m.ultimoAcesso().motivo).toBe('email_nao_verificado');
    expect(m.findFirst).not.toHaveBeenCalled();
  });

  it('conta @gmail.com (sem hd) e conta de outro Workspace são dominio_invalido', async () => {
    const pessoal = montar({ identidade: { email: 'joao@gmail.com', hd: undefined } });
    await esperarFalhaGenerica(pessoal.service.loginGoogle('tok', pessoal.ctx));
    expect(pessoal.ultimoAcesso().motivo).toBe('dominio_invalido');

    const outro = montar({ identidade: { email: 'joao@outra.com.br', hd: 'outra.com.br' } });
    await esperarFalhaGenerica(outro.service.loginGoogle('tok', outro.ctx));
    expect(outro.ultimoAcesso().motivo).toBe('dominio_invalido');

    // hd de fora com e-mail "do domínio" no claim também cai
    const hdErrado = montar({ identidade: { email: 'joao@azit.com.br', hd: 'outra.com.br' } });
    await esperarFalhaGenerica(hdErrado.service.loginGoogle('tok', hdErrado.ctx));
    expect(hdErrado.ultimoAcesso().motivo).toBe('dominio_invalido');
    expect(hdErrado.findFirst).not.toHaveBeenCalled();
  });

  it('conta válida do domínio sem Usuario → usuario_inexistente (nenhuma conta nasce no login)', async () => {
    const m = montar({ usuario: null });
    await esperarFalhaGenerica(m.service.loginGoogle('tok', m.ctx));
    expect(m.ultimoAcesso()).toMatchObject({ motivo: 'usuario_inexistente', usuarioId: null, emailTentado: 'joao@azitmove.com.br' });
    expect(m.update).not.toHaveBeenCalled();
  });

  it('procura o usuário pela PARTE LOCAL nos dois domínios (azit ≡ azitmove)', async () => {
    const m = montar();
    await m.service.loginGoogle('tok', m.ctx);
    const where = m.findFirst.mock.calls[0][0].where as { email: { in: string[] }; deletedAt: null };
    expect(where.email.in.sort()).toEqual(['joao@azit.com.br', 'joao@azitmove.com.br']);
    expect(where.deletedAt).toBeNull();
  });

  it('usuário inativo → usuario_inativo, com o usuarioId no registro', async () => {
    const m = montar({ usuario: usuario({ ativo: false }) });
    await esperarFalhaGenerica(m.service.loginGoogle('tok', m.ctx));
    expect(m.ultimoAcesso()).toMatchObject({ motivo: 'usuario_inativo', usuarioId: 'u1' });
  });

  it('1º acesso grava o googleSub e entra', async () => {
    const m = montar({ usuario: usuario({ googleSub: null }) });
    const r = await m.service.loginGoogle('tok', m.ctx);
    expect(m.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { googleSub: 'google-sub-1' } });
    expect(r.accessToken).toBe('access-token');
    expect(r.refreshToken).toHaveLength(96);
    expect(r.usuario).toEqual({ id: 'u1', nome: 'João', email: 'joao@azit.com.br', roles: [RoleUsuario.OPERADOR] });
    expect(m.ultimoAcesso()).toMatchObject({ forma: FormaAcesso.GOOGLE, sucesso: true, usuarioId: 'u1', motivo: null });
  });

  it('sub divergente (e-mail recriado no Workspace) → sub_divergente, sem regravar', async () => {
    const m = montar({ usuario: usuario({ googleSub: 'sub-antigo' }) });
    await esperarFalhaGenerica(m.service.loginGoogle('tok', m.ctx));
    expect(m.ultimoAcesso()).toMatchObject({ motivo: 'sub_divergente', usuarioId: 'u1' });
    expect(m.update).not.toHaveBeenCalled();
    expect(m.prisma.db.refreshToken.create).not.toHaveBeenCalled();
  });

  it('sub igual nos acessos seguintes → entra sem tocar no cadastro', async () => {
    const m = montar({ usuario: usuario({ googleSub: 'google-sub-1' }) });
    await m.service.loginGoogle('tok', m.ctx);
    expect(m.update).not.toHaveBeenCalled();
    expect(m.prisma.db.refreshToken.create).toHaveBeenCalledTimes(1);
  });

  it('falha ao gravar o registro de acesso não derruba a entrada', async () => {
    const m = montar();
    m.acessoCreate.mockRejectedValue(new Error('tabela ainda não migrada'));
    await expect(m.service.loginGoogle('tok', m.ctx)).resolves.toMatchObject({ accessToken: 'access-token' });
  });
});

describe('AuthService — entrar por senha (doc 06 §2.3, §10.1-A)', () => {
  it('permiteSenha = false → o MESMO 401 genérico, motivo senha_desligada', async () => {
    const m = montar({ usuario: usuario({ permiteSenha: false }) });
    await esperarFalhaGenerica(m.service.login('joao@azit.com.br', 'senha-de-reserva', m.ctx));
    expect(m.ultimoAcesso()).toMatchObject({ forma: FormaAcesso.SENHA, sucesso: false, motivo: 'senha_desligada', usuarioId: 'u1' });
  });

  it('permiteSenha ligado mas sem hash (nunca definiu) → senha_desligada', async () => {
    const m = montar({ usuario: usuario({ senhaHash: null }) });
    await esperarFalhaGenerica(m.service.login('joao@azit.com.br', 'x', m.ctx));
    expect(m.ultimoAcesso().motivo).toBe('senha_desligada');
  });

  it('e-mail sem usuário → usuario_inexistente, com o e-mail tentado no registro', async () => {
    const m = montar({ usuario: null });
    await esperarFalhaGenerica(m.service.login('Ninguem@Azit.com.br', 'x', m.ctx));
    expect(m.ultimoAcesso()).toMatchObject({ motivo: 'usuario_inexistente', emailTentado: 'ninguem@azit.com.br', usuarioId: null });
  });

  it('senha errada → senha_invalida; a correta entra e emite os mesmos tokens do Google', async () => {
    const m = montar();
    await esperarFalhaGenerica(m.service.login('joao@azit.com.br', 'errada', m.ctx));
    expect(m.ultimoAcesso().motivo).toBe('senha_invalida');

    const r = await m.service.login('joao@azit.com.br', 'senha-de-reserva', m.ctx);
    expect(r.accessToken).toBe('access-token');
    expect(m.ultimoAcesso()).toMatchObject({ forma: FormaAcesso.SENHA, sucesso: true, usuarioId: 'u1' });
  });

  it('10 falhas seguidas bloqueiam por 15 min: a 11ª tentativa (mesmo com a senha certa) falha com motivo bloqueado', async () => {
    let agora = 1_000_000;
    const m = montar({ bloqueio: new ControleBloqueioSenha(() => agora) });
    for (let i = 0; i < FALHAS_PARA_BLOQUEIO_SENHA; i++) {
      await esperarFalhaGenerica(m.service.login('joao@azit.com.br', 'errada', m.ctx));
    }
    // a 10ª já registra como bloqueado (foi ela que disparou)
    expect(m.ultimoAcesso().motivo).toBe('bloqueado');
    await esperarFalhaGenerica(m.service.login('joao@azit.com.br', 'senha-de-reserva', m.ctx));
    expect(m.ultimoAcesso().motivo).toBe('bloqueado');
    expect(m.prisma.db.refreshToken.create).not.toHaveBeenCalled();

    // passados 15 min, volta a aceitar a senha certa
    agora += 15 * 60_000 + 1;
    await expect(m.service.login('joao@azit.com.br', 'senha-de-reserva', m.ctx)).resolves.toMatchObject({ accessToken: 'access-token' });
  });

  it('o bloqueio por senha NÃO atinge a entrada pelo Google do mesmo usuário', async () => {
    const m = montar({ bloqueio: new ControleBloqueioSenha(() => 0) });
    for (let i = 0; i < FALHAS_PARA_BLOQUEIO_SENHA; i++) {
      await esperarFalhaGenerica(m.service.login('joao@azit.com.br', 'errada', m.ctx));
    }
    await expect(m.service.loginGoogle('tok', m.ctx)).resolves.toMatchObject({ accessToken: 'access-token' });
  });
});

describe('AuthService — refresh e sessões', () => {
  it('refresh inválido registra forma REFRESH em falha; o bem-sucedido não registra nada', async () => {
    const m = montar();
    m.prisma.db.refreshToken.findUnique.mockResolvedValue(null);
    await expect(m.service.refresh('nao-existe', m.ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(m.ultimoAcesso()).toMatchObject({ forma: FormaAcesso.REFRESH, sucesso: false, motivo: 'refresh_invalido', emailTentado: null });

    m.acessoCreate.mockClear();
    m.prisma.db.refreshToken.findUnique.mockResolvedValue({
      id: 'rt1', usuarioId: 'u1', revogado: false, expiraEm: new Date(Date.now() + 60_000), usuario: usuario(),
    });
    await expect(m.service.refresh('valido', m.ctx)).resolves.toMatchObject({ accessToken: 'access-token' });
    expect(m.acessoCreate).not.toHaveBeenCalled();
  });

  it('encerrarSessoes revoga todos os refresh do usuário e devolve a contagem', async () => {
    const m = montar();
    await expect(m.service.encerrarSessoes('u1')).resolves.toBe(2);
    expect(m.prisma.db.refreshToken.updateMany).toHaveBeenCalledWith({ where: { usuarioId: 'u1', revogado: false }, data: { revogado: true } });
  });
});
