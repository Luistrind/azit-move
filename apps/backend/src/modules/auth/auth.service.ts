import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { FormaAcesso, RoleUsuario } from '@prisma/client';
import {
  DIA_MS,
  LIMITE_ACESSOS_LISTADOS,
  MENSAGEM_FALHA_ENTRADA,
  ehDominioWorkspace,
  partesEmail,
  variantesEmailWorkspace,
} from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { JwtPayload } from './strategies/jwt.strategy';
import { ContextoRequisicao } from '../../common/http/contexto-requisicao';
import { ControleBloqueioSenha } from './bloqueio-senha';
import { IdentidadeGoogle, VERIFICADOR_GOOGLE, VerificadorGoogle } from './google-verificador';

export interface TokensResponse {
  accessToken: string;
  refreshToken: string;
  usuario: { id: string; nome: string; email: string; roles: RoleUsuario[] };
}

// Motivos INTERNOS de falha (doc 06 §9): vão só para o registro de acessos,
// nunca para a resposta HTTP, que é sempre a mesma (§2.4, §11.3).
export type MotivoFalhaAcesso =
  | 'token_invalido'
  | 'email_nao_verificado'
  | 'dominio_invalido'
  | 'usuario_inexistente'
  | 'usuario_inativo'
  | 'sub_divergente'
  | 'senha_desligada'
  | 'bloqueado'
  | 'senha_invalida'
  | 'refresh_invalido';

const SEM_CONTEXTO: ContextoRequisicao = { ip: null, agente: null };

type UsuarioComRoles = {
  id: string;
  nome: string;
  email: string;
  ativo: boolean;
  senhaHash: string | null;
  permiteSenha: boolean;
  googleSub: string | null;
  roles: { role: RoleUsuario }[];
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  readonly bloqueioSenha: ControleBloqueioSenha;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(VERIFICADOR_GOOGLE) private readonly google: VerificadorGoogle,
    bloqueio?: ControleBloqueioSenha,
  ) {
    this.bloqueioSenha = bloqueio ?? new ControleBloqueioSenha();
  }

  // O que a tela de login precisa saber antes de qualquer credencial: se há
  // client id do Google neste ambiente (o id é público — doc 06 §2.2).
  // `senhaDisponivel` (feedback Luís, 13/11, homolog): a tela só oferece "entrar
  // com senha" se EXISTE alguém ativo com a senha liberada. Antes de se
  // identificar ninguém sabe quem é o usuário, e perguntar o e-mail para decidir
  // entregaria quais contas aceitam senha (§11.3) — por isso a regra é global:
  // ninguém pode → a opção não aparece; alguém pode → aparece para todos, e a
  // falha continua genérica.
  async configPublica(): Promise<{ googleClientId: string | null; senhaDisponivel: boolean }> {
    const comSenha = await this.prisma.db.usuario.count({ where: { permiteSenha: true, ativo: true } });
    return { googleClientId: this.google.clientId(), senhaDisponivel: comSenha > 0 };
  }

  // Falha de entrada: SEMPRE o mesmo 401 (doc 06 §2.4, §11.3).
  private falhaGenerica(): UnauthorizedException {
    return new UnauthorizedException({ erro: 'credenciais_invalidas', mensagem: MENSAGEM_FALHA_ENTRADA });
  }

  // Entrar com Google (doc 06 §2.2, §10.1) — caminho normal desde a v1.1.
  async loginGoogle(credential: string, ctx: ContextoRequisicao = SEM_CONTEXTO): Promise<TokensResponse> {
    if (!this.google.configurado()) {
      throw new ServiceUnavailableException({
        erro: 'google_nao_configurado',
        mensagem: 'Entrada pelo Google não configurada neste ambiente',
      });
    }
    const falhar = async (motivo: MotivoFalhaAcesso, emailTentado: string | null, usuarioId: string | null = null) => {
      await this.registrarAcesso({ usuarioId, emailTentado, forma: FormaAcesso.GOOGLE, sucesso: false, motivo, ctx });
      return this.falhaGenerica();
    };

    // 4. assinatura, aud, iss, exp — pela biblioteca oficial
    let identidade: IdentidadeGoogle;
    try {
      identidade = await this.google.verificar(credential);
    } catch (e) {
      this.logger.warn(`ID token do Google recusado: ${(e as Error).message}`);
      throw await falhar('token_invalido', null);
    }
    const email = identidade.email.trim().toLowerCase();
    if (!identidade.emailVerificado) throw await falhar('email_nao_verificado', email);

    // 5. hd E domínio do e-mail no Workspace — conta pessoal ou de outro Workspace é recusada
    const partes = partesEmail(email);
    if (!partes || !ehDominioWorkspace(partes.dominio) || !identidade.hd || !ehDominioWorkspace(identidade.hd)) {
      throw await falhar('dominio_invalido', email);
    }

    // 6. Usuario pela parte local do e-mail (os dois domínios são a mesma caixa)
    const usuario = await this.localizarPorEmail(email);
    if (!usuario) throw await falhar('usuario_inexistente', email);
    if (!usuario.ativo) throw await falhar('usuario_inativo', email, usuario.id);

    // googleSub: grava no 1º acesso; depois exige igualdade (e-mail reaproveitado não herda acesso)
    if (!usuario.googleSub) {
      await this.prisma.db.usuario.update({ where: { id: usuario.id }, data: { googleSub: identidade.sub } });
    } else if (usuario.googleSub !== identidade.sub) {
      throw await falhar('sub_divergente', email, usuario.id);
    }

    // 7–8. Os MESMOS tokens do login por senha; registra o acesso.
    const tokens = await this.emitirTokens(this.identidade(usuario));
    await this.registrarAcesso({ usuarioId: usuario.id, emailTentado: email, forma: FormaAcesso.GOOGLE, sucesso: true, ctx });
    return tokens;
  }

  // Entrar por senha — reserva, só com permiteSenha (doc 06 §2.3, §10.1-A).
  async login(email: string, senha: string, ctx: ContextoRequisicao = SEM_CONTEXTO): Promise<TokensResponse> {
    const emailNormalizado = email.trim().toLowerCase();
    const falhar = async (motivo: MotivoFalhaAcesso, usuario: UsuarioComRoles | null) => {
      await this.registrarAcesso({
        usuarioId: usuario?.id ?? null, emailTentado: emailNormalizado, forma: FormaAcesso.SENHA, sucesso: false, motivo, ctx,
      });
      return this.falhaGenerica();
    };

    const usuario = await this.localizarPorEmail(emailNormalizado);
    if (!usuario) throw await falhar('usuario_inexistente', null);
    if (!usuario.ativo) throw await falhar('usuario_inativo', usuario);
    // Bloqueio temporário por usuário (10 falhas seguidas → 15 min), nunca revelado.
    if (this.bloqueioSenha.bloqueado(usuario.id)) throw await falhar('bloqueado', usuario);
    if (!usuario.permiteSenha || !usuario.senhaHash) throw await falhar('senha_desligada', usuario);

    const senhaOk = await bcrypt.compare(senha, usuario.senhaHash);
    if (!senhaOk) {
      const disparou = this.bloqueioSenha.registrarFalha(usuario.id);
      throw await falhar(disparou ? 'bloqueado' : 'senha_invalida', usuario);
    }
    this.bloqueioSenha.limpar(usuario.id);

    const tokens = await this.emitirTokens(this.identidade(usuario));
    await this.registrarAcesso({ usuarioId: usuario.id, emailTentado: emailNormalizado, forma: FormaAcesso.SENHA, sucesso: true, ctx });
    return tokens;
  }

  // Identidade do usuário logado (GET /auth/me) — mesmo formato de `usuario` do login.
  async me(id: string): Promise<TokensResponse['usuario']> {
    const usuario = await this.prisma.db.usuario.findFirst({ where: { id, ativo: true }, include: { roles: true } });
    if (!usuario) throw new UnauthorizedException({ erro: 'nao_autenticado', mensagem: 'Sessão inválida' });
    return this.identidade(usuario);
  }

  // Renovação com rotação (Doc 6 §3.3): valida o refresh, revoga-o e emite um novo par.
  // Registra forma REFRESH SÓ EM FALHA (doc 06 §10.3): cada renovação bem-sucedida
  // a cada 15 min poluiria o histórico sem dizer nada sobre a entrada da pessoa.
  async refresh(refreshToken: string, ctx: ContextoRequisicao = SEM_CONTEXTO): Promise<TokensResponse> {
    const registro = await this.prisma.db.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { usuario: { include: { roles: true } } },
    });

    if (
      !registro ||
      registro.revogado ||
      registro.expiraEm < new Date() ||
      !registro.usuario.ativo
    ) {
      await this.registrarAcesso({
        usuarioId: registro?.usuarioId ?? null,
        emailTentado: registro?.usuario.email ?? null,
        forma: FormaAcesso.REFRESH,
        sucesso: false,
        motivo: 'refresh_invalido',
        ctx,
      });
      throw new UnauthorizedException({
        erro: 'refresh_invalido',
        mensagem: 'Sessão expirada. Faça login novamente.',
      });
    }

    // Rotação: revoga o refresh usado.
    await this.prisma.db.refreshToken.update({
      where: { id: registro.id },
      data: { revogado: true },
    });

    return this.emitirTokens(this.identidade(registro.usuario));
  }

  // Logout (Doc 6 §3.4): revoga o refresh atual. O access segue válido até expirar (≤15min).
  async logout(refreshToken: string): Promise<void> {
    await this.prisma.db.refreshToken.updateMany({
      where: { token: refreshToken, revogado: false },
      data: { revogado: true },
    });
  }

  // "Encerrar todas as sessões" (doc 06 §2.5, §11.4): revoga TODOS os refresh
  // tokens do usuário; em até 15 min o acesso cai em todos os dispositivos.
  // Devolve quantas sessões foram encerradas (a tela mostra).
  async encerrarSessoes(usuarioId: string): Promise<number> {
    const r = await this.prisma.db.refreshToken.updateMany({
      where: { usuarioId, revogado: false },
      data: { revogado: true },
    });
    return r.count;
  }

  // Últimos acessos de um usuário (doc 06 §2.5): forma, resultado, motivo, IP, agente, quando.
  async acessosDoUsuario(usuarioId: string) {
    const linhas = await this.prisma.db.acessoUsuario.findMany({
      where: { usuarioId },
      orderBy: { em: 'desc' },
      take: LIMITE_ACESSOS_LISTADOS,
    });
    return linhas.map((a) => ({
      id: a.id,
      forma: a.forma,
      sucesso: a.sucesso,
      motivo: a.motivo,
      ip: a.ip,
      agente: a.agente,
      em: a.em.toISOString(),
    }));
  }

  // Quantas sessões (refresh tokens) ainda valem para o usuário — a tela "Minha conta" mostra.
  async sessoesAtivas(usuarioId: string): Promise<number> {
    return this.prisma.db.refreshToken.count({ where: { usuarioId, revogado: false, expiraEm: { gt: new Date() } } });
  }

  // --- internos ---

  // Usuario não excluído pelo e-mail: no Workspace, pela PARTE LOCAL (qualquer um
  // dos dois domínios — doc 06 §2.1); fora dele, pelo e-mail exato normalizado.
  // Única função de localização, usada pelo Google e pela senha.
  private async localizarPorEmail(email: string): Promise<UsuarioComRoles | null> {
    const variantes = variantesEmailWorkspace(email);
    return this.prisma.db.usuario.findFirst({
      where: { email: { in: variantes }, deletedAt: null },
      include: { roles: true },
    });
  }

  private identidade(u: { id: string; nome: string; email: string; roles: { role: RoleUsuario }[] }): TokensResponse['usuario'] {
    return { id: u.id, nome: u.nome, email: u.email, roles: u.roles.map((r) => r.role) };
  }

  // Registro de acessos (doc 06 §2.5, §9). Falha ao gravar NUNCA derruba a
  // entrada — vira aviso no log do servidor.
  private async registrarAcesso(dados: {
    usuarioId: string | null;
    emailTentado: string | null;
    forma: FormaAcesso;
    sucesso: boolean;
    motivo?: MotivoFalhaAcesso;
    ctx: ContextoRequisicao;
  }): Promise<void> {
    try {
      await this.prisma.db.acessoUsuario.create({
        data: {
          usuarioId: dados.usuarioId,
          emailTentado: dados.emailTentado,
          forma: dados.forma,
          sucesso: dados.sucesso,
          motivo: dados.motivo ?? null,
          ip: dados.ctx.ip,
          agente: dados.ctx.agente,
        },
      });
    } catch (e) {
      this.logger.warn(`Não gravou o registro de acesso (${dados.forma}/${dados.motivo ?? 'ok'}): ${(e as Error).message}`);
    }
  }

  // Gera access token (JWT assinado) + refresh token (opaco, persistido e revogável).
  // ÚNICO emissor: Google, senha e refresh passam por aqui (doc 06 §2.2 passo 7).
  private async emitirTokens(usuario: TokensResponse['usuario']): Promise<TokensResponse> {
    const payload: JwtPayload = { sub: usuario.id, roles: usuario.roles };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get<string>('jwt.secret'),
      expiresIn: this.config.get<string>('jwt.accessExpiresIn'),
    });

    const refreshToken = randomBytes(48).toString('hex');
    const dias = this.config.get<number>('jwt.refreshExpiresInDays') ?? 7;
    const expiraEm = new Date(Date.now() + dias * DIA_MS);

    await this.prisma.db.refreshToken.create({
      data: { usuarioId: usuario.id, token: refreshToken, expiraEm },
    });

    return { accessToken, refreshToken, usuario };
  }
}
