import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, Patch, Post, Put, UnprocessableEntityException } from '@nestjs/common';
import { AreaSistema, Prisma, RoleUsuario } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { z } from 'zod';
import { SENHA_MINIMO_CARACTERES, ehEmailWorkspace, variantesEmailWorkspace } from '@azit/utils';
import { CHAVE_PREFERENCIA_EMAIL_ALERTAS } from '@azit/types';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, UsuarioAutenticado } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../database/prisma.service';
import { PermissoesService, SemAdminComConfiguracoesError, UsuarioParaGuarda } from '../permissoes/permissoes.service';
import { Area, AreaLivre } from '../../common/decorators/area.decorator';
import { AuthService } from '../auth/auth.service';
import { NotificacaoService } from '../notificacao/notificacao.service';

// Gestão de Usuários e Permissões por Área (doc 02 §16).
// Papel carrega as áreas do seu domínio (matriz papel×área, editável);
// exceções por usuário concedem/revogam áreas específicas com motivo.
// A conta das áreas efetivas vive em PermissoesService (única — doc 06 §5.4);
// toda mutação aqui invalida o cache dela para a área valer na hora.
//
// Entrada do usuário (doc 06 v1.1 §2, bloco 2 — 13/11/2026): a porta normal é a
// conta Google do Workspace; a senha é reserva DESLIGADA por padrão. Aqui o
// Admin liga/desliga `permiteSenha` com motivo auditado, redefine a senha de
// reserva (mín. 10), "religa" a conta Google (zera o `googleSub`), encerra todas
// as sessões e vê os últimos acessos de cada usuário. O próprio usuário vê os
// seus em "Minha conta" (rotas /me, @AreaLivre).

// Custo do bcrypt (doc 06 §2.3: cost 12).
const CUSTO_BCRYPT = 12;

const preferenciasSchema = z.object({
  ordemInicio: z.array(z.string().max(60)).max(30).optional(),
  // "Receber alertas por e-mail" (doc 06 v1.1 §12.3 item 4) — ausente = ligado.
  [CHAVE_PREFERENCIA_EMAIL_ALERTAS]: z.boolean().optional(),
});

// Senha só é obrigatória quando o Admin liga "permite senha" na criação (§2.3).
const criarUsuarioSchema = z
  .object({
    nome: z.string().min(3),
    email: z.string().email(),
    permiteSenha: z.boolean().default(false),
    senha: z.string().min(SENHA_MINIMO_CARACTERES).optional(),
    papeis: z.array(z.nativeEnum(RoleUsuario)).min(1),
  })
  .refine((d) => !d.permiteSenha || !!d.senha, { message: 'Com "permite senha" ligado, informe a senha inicial', path: ['senha'] });

const atualizarUsuarioSchema = z.object({
  nome: z.string().min(3).optional(),
  ativo: z.boolean().optional(),
  papeis: z.array(z.nativeEnum(RoleUsuario)).min(1).optional(),
});

const senhaSchema = z.object({ senha: z.string().min(SENHA_MINIMO_CARACTERES) });

const permiteSenhaSchema = z.object({
  permiteSenha: z.boolean(),
  motivo: z.string().trim().min(5, 'Informe o motivo (mínimo 5 caracteres)').max(300),
});

const celulaMatrizSchema = z.object({
  papel: z.nativeEnum(RoleUsuario),
  area: z.nativeEnum(AreaSistema),
  permitido: z.boolean(),
});

const excecaoSchema = z.object({
  area: z.nativeEnum(AreaSistema),
  concedida: z.boolean().nullable(), // null remove a exceção (volta ao padrão do papel)
  motivo: z.string().optional(),
});

@Area(AreaSistema.CONFIGURACOES)
@Controller()
export class UsuariosController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissoes: PermissoesService,
    private readonly auth: AuthService,
    private readonly notificacao: NotificacaoService,
  ) {}

  // Áreas efetivas do usuário logado (frontend monta o menu com isto — UX-1).
  @AreaLivre('áreas do próprio usuário (monta o menu)')
  @Get('me/areas')
  async minhasAreas(@CurrentUser() user: UsuarioAutenticado) {
    return { areas: [...(await this.permissoes.areasEfetivas(user.id))] };
  }

  // Preferências de interface do PRÓPRIO usuário (16/09) — ordem dos cards
  // do Início. Merge raso: cada chave enviada substitui só ela.
  @AreaLivre('preferências do próprio usuário')
  @Get('me/preferencias')
  async minhasPreferencias(@CurrentUser() user: UsuarioAutenticado) {
    const u = await this.prisma.db.usuario.findFirst({ where: { id: user.id }, select: { preferencias: true } });
    return (u?.preferencias as Record<string, unknown> | null) ?? {};
  }

  @AreaLivre('preferências do próprio usuário')
  @Put('me/preferencias')
  @HttpCode(200)
  async salvarPreferencias(
    @CurrentUser() user: UsuarioAutenticado,
    @Body(new ZodValidationPipe(preferenciasSchema)) body: z.infer<typeof preferenciasSchema>,
  ) {
    const u = await this.prisma.db.usuario.findFirst({ where: { id: user.id }, select: { preferencias: true } });
    const atual = (u?.preferencias as Record<string, unknown> | null) ?? {};
    const novo = { ...atual, ...body };
    await this.prisma.db.usuario.update({
      where: { id: user.id },
      data: { preferencias: novo as Prisma.InputJsonValue },
    });
    return novo;
  }

  // "Minha conta" (doc 06 §2.5): meus últimos acessos, como entro no sistema e
  // quantas sessões ainda valem.
  @AreaLivre('acessos do próprio usuário (Minha conta)')
  @Get('me/acessos')
  async meusAcessos(@CurrentUser() user: UsuarioAutenticado) {
    const [acessos, sessoesAtivas, u] = await Promise.all([
      this.auth.acessosDoUsuario(user.id),
      this.auth.sessoesAtivas(user.id),
      this.prisma.db.usuario.findFirst({ where: { id: user.id }, select: { permiteSenha: true, googleSub: true, email: true } }),
    ]);
    return {
      acessos,
      sessoesAtivas,
      entrada: { permiteSenha: u?.permiteSenha ?? false, googleVinculado: !!u?.googleSub, email: u?.email ?? null },
    };
  }

  // "Encerrar todas as sessões" pelo próprio usuário (doc 06 §2.5): revoga todos
  // os refresh tokens; em até 15 min cai em todos os dispositivos — inclusive este.
  @AreaLivre('sessões do próprio usuário (Minha conta)')
  @Post('me/encerrar-sessoes')
  @HttpCode(200)
  async encerrarMinhasSessoes(@CurrentUser() user: UsuarioAutenticado) {
    const encerradas = await this.auth.encerrarSessoes(user.id);
    await this.auditar(user.id, 'usuario_sessoes_encerradas', user.id, undefined, { encerradas, por: 'proprio_usuario' });
    return { encerradas };
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
  @Get('usuarios')
  async listar() {
    const usuarios = await this.prisma.db.usuario.findMany({
      where: { deletedAt: null },
      include: { roles: true, permissoesArea: true },
      orderBy: { nome: 'asc' },
    });
    const [matriz, ultimos] = await Promise.all([
      this.prisma.db.permissaoPapelArea.findMany(),
      // Último acesso bem-sucedido de cada um (uma consulta para a lista toda).
      this.prisma.db.acessoUsuario.groupBy({ by: ['usuarioId'], where: { sucesso: true }, _max: { em: true } }),
    ]);
    const ultimoPor = new Map(ultimos.map((l) => [l.usuarioId, l._max.em?.toISOString() ?? null]));
    return usuarios.map((u) => ({
      id: u.id,
      nome: u.nome,
      email: u.email,
      ativo: u.ativo,
      papeis: u.roles.map((r) => r.role),
      excecoes: u.permissoesArea.map((p) => ({ area: p.area, concedida: p.concedida, motivo: p.motivo })),
      areasEfetivas: this.permissoes.resolver(u.roles.map((r) => r.role), u.permissoesArea, matriz),
      // Entrada (doc 06 v1.1 §2): como a pessoa entra e se a conta Google já foi vinculada.
      permiteSenha: u.permiteSenha,
      temSenha: !!u.senhaHash,
      googleVinculado: !!u.googleSub,
      ultimoAcessoEm: ultimoPor.get(u.id) ?? null,
    }));
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
  @Post('usuarios')
  @HttpCode(201)
  async criar(
    @Body(new ZodValidationPipe(criarUsuarioSchema)) dto: z.infer<typeof criarUsuarioSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    this.exigirAdminParaPapelAdmin(user, dto.papeis);
    // Só o Admin libera a entrada por senha (doc 06 §2.3) — na criação também.
    if (dto.permiteSenha && !user.roles.includes(RoleUsuario.ADMIN)) {
      throw new ForbiddenException({ erro: 'sem_alcada', mensagem: 'Só um administrador libera a entrada por senha' });
    }
    const email = dto.email.toLowerCase();
    // Os dois domínios do Workspace são a MESMA caixa (doc 06 §2.1): joao@azit.com.br
    // e joao@azitmove.com.br não podem ser dois usuários.
    const emailEmUso = await this.prisma.db.usuario.findFirst({
      where: { email: { in: variantesEmailWorkspace(email) } },
      select: { id: true, email: true },
    });
    if (emailEmUso) {
      throw new BadRequestException({
        erro: 'email_em_uso',
        mensagem: emailEmUso.email === email
          ? 'Já existe um usuário com este e-mail'
          : `Já existe um usuário com esta caixa do Workspace (${emailEmUso.email})`,
      });
    }
    const senhaHash = dto.permiteSenha && dto.senha ? await bcrypt.hash(dto.senha, CUSTO_BCRYPT) : null;
    const criado = await this.prisma.db.usuario.create({
      data: {
        nome: dto.nome,
        email,
        senhaHash,
        permiteSenha: dto.permiteSenha,
        roles: { create: dto.papeis.map((role) => ({ role })) },
      },
    });
    await this.auditar(user.id, 'usuario_criado', criado.id, undefined, {
      nome: dto.nome, email, papeis: dto.papeis, permiteSenha: dto.permiteSenha, entradaGoogle: ehEmailWorkspace(email),
    });
    return { id: criado.id };
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
  @Patch('usuarios/:id')
  async atualizar(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(atualizarUsuarioSchema)) dto: z.infer<typeof atualizarUsuarioSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    const antes = await this.prisma.db.usuario.findFirst({ where: { id, deletedAt: null }, include: { roles: true } });
    if (!antes) throw new NotFoundException({ erro: 'usuario_nao_encontrado', mensagem: 'Usuário não encontrado' });
    const eraAdmin = antes.roles.some((r) => r.role === RoleUsuario.ADMIN);
    const perdeAdmin = dto.papeis ? eraAdmin && !dto.papeis.includes(RoleUsuario.ADMIN) : false;
    const ganhaAdmin = dto.papeis ? !eraAdmin && dto.papeis.includes(RoleUsuario.ADMIN) : false;
    if (perdeAdmin || ganhaAdmin) this.exigirAdminParaPapelAdmin(user, [RoleUsuario.ADMIN]);
    if (id === user.id && (dto.ativo === false || perdeAdmin)) {
      throw new BadRequestException({ erro: 'auto_bloqueio', mensagem: 'Você não pode desativar a si mesmo nem retirar o seu próprio papel de administrador' });
    }
    if (eraAdmin && antes.ativo && (dto.ativo === false || perdeAdmin)) await this.exigirOutroAdmin(id);
    // Auto-bloqueio (doc 06 §13.3): desativar ou mudar papéis não pode deixar o
    // sistema sem administrador ativo com Configurações.
    if (dto.ativo !== undefined || dto.papeis) {
      await this.exigirAdminComConfiguracoes(({ usuarios }) => {
        const u = usuarios.find((x) => x.id === id);
        if (!u) return;
        if (dto.ativo !== undefined) u.ativo = dto.ativo;
        if (dto.papeis) u.papeis = dto.papeis;
      });
    }
    await this.prisma.db.usuario.update({ where: { id }, data: { nome: dto.nome, ativo: dto.ativo } });
    if (dto.papeis) {
      await this.prisma.db.usuarioRole.deleteMany({ where: { usuarioId: id } });
      await this.prisma.db.usuarioRole.createMany({ data: dto.papeis.map((role) => ({ usuarioId: id, role })) });
    }
    // Desativar corta o acesso na hora: as sessões abertas são encerradas junto.
    if (dto.ativo === false) await this.auth.encerrarSessoes(id);
    this.permissoes.invalidar(id);
    await this.auditar(user.id, 'usuario_alterado', id,
      { nome: antes?.nome, ativo: antes?.ativo, papeis: antes?.roles.map((r) => r.role) },
      { nome: dto.nome, ativo: dto.ativo, papeis: dto.papeis });
    return { resultado: 'ok' };
  }

  // Liga/desliga a entrada por senha (doc 06 §2.3): só ADMIN, motivo obrigatório,
  // auditado com antes/depois. Desligar não apaga o hash (religar não exige nova senha).
  @Roles(RoleUsuario.ADMIN)
  @Patch('usuarios/:id/permite-senha')
  async definirPermiteSenha(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(permiteSenhaSchema)) dto: z.infer<typeof permiteSenhaSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    const antes = await this.prisma.db.usuario.findFirst({ where: { id, deletedAt: null }, select: { permiteSenha: true, senhaHash: true } });
    if (!antes) throw new NotFoundException({ erro: 'usuario_nao_encontrado', mensagem: 'Usuário não encontrado' });
    await this.prisma.db.usuario.update({ where: { id }, data: { permiteSenha: dto.permiteSenha } });
    await this.auditar(user.id, 'usuario_permite_senha_alterado', id,
      { permiteSenha: antes.permiteSenha },
      { permiteSenha: dto.permiteSenha, motivo: dto.motivo });
    // Ligou sem hash: a tela avisa que falta definir a senha de reserva.
    return { resultado: 'ok', permiteSenha: dto.permiteSenha, temSenha: !!antes.senhaHash };
  }

  // Senha de reserva (doc 06 §2.3): só com permiteSenha ligado; mínimo 10; cost 12.
  @Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
  @Post('usuarios/:id/senha')
  @HttpCode(200)
  async redefinirSenha(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(senhaSchema)) dto: z.infer<typeof senhaSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    const alvo = await this.prisma.db.usuario.findFirst({ where: { id, deletedAt: null }, select: { permiteSenha: true } });
    if (!alvo) throw new NotFoundException({ erro: 'usuario_nao_encontrado', mensagem: 'Usuário não encontrado' });
    if (!alvo.permiteSenha) {
      throw new UnprocessableEntityException({
        erro: 'senha_desligada',
        mensagem: 'A entrada por senha está desligada para este usuário — um administrador precisa ligar "permite senha" antes',
      });
    }
    const senhaHash = await bcrypt.hash(dto.senha, CUSTO_BCRYPT);
    await this.prisma.db.usuario.update({ where: { id }, data: { senhaHash } });
    await this.auditar(user.id, 'usuario_senha_redefinida', id);
    return { resultado: 'ok' };
  }

  // "Religar conta Google" (doc 06 §2.1): zera o `googleSub` para o próximo acesso
  // gravar o da conta atual — caso de e-mail recriado no Workspace. Só ADMIN, auditado.
  @Roles(RoleUsuario.ADMIN)
  @Post('usuarios/:id/religar-google')
  @HttpCode(200)
  async religarGoogle(@Param('id') id: string, @CurrentUser() user: UsuarioAutenticado) {
    const alvo = await this.prisma.db.usuario.findFirst({ where: { id, deletedAt: null }, select: { googleSub: true } });
    if (!alvo) throw new NotFoundException({ erro: 'usuario_nao_encontrado', mensagem: 'Usuário não encontrado' });
    await this.prisma.db.usuario.update({ where: { id }, data: { googleSub: null } });
    // Sessões antigas podem ser do dono anterior do e-mail: caem junto.
    const encerradas = await this.auth.encerrarSessoes(id);
    await this.auditar(user.id, 'usuario_google_religado', id, { googleVinculado: !!alvo.googleSub }, { googleVinculado: false, sessoesEncerradas: encerradas });
    return { resultado: 'ok' };
  }

  // "Encerrar todas as sessões" pelo Admin (doc 06 §2.5, §11.4).
  @Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
  @Post('usuarios/:id/encerrar-sessoes')
  @HttpCode(200)
  async encerrarSessoes(@Param('id') id: string, @CurrentUser() user: UsuarioAutenticado) {
    const alvo = await this.prisma.db.usuario.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!alvo) throw new NotFoundException({ erro: 'usuario_nao_encontrado', mensagem: 'Usuário não encontrado' });
    const encerradas = await this.auth.encerrarSessoes(id);
    await this.auditar(user.id, 'usuario_sessoes_encerradas', id, undefined, { encerradas, por: 'administrador' });
    return { encerradas };
  }

  // Últimos acessos de um usuário (doc 06 §2.5) — forma, resultado, motivo interno, IP, agente.
  @Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
  @Get('usuarios/:id/acessos')
  async acessos(@Param('id') id: string) {
    const [acessos, sessoesAtivas] = await Promise.all([this.auth.acessosDoUsuario(id), this.auth.sessoesAtivas(id)]);
    return { acessos, sessoesAtivas };
  }

  // Alertas por e-mail de um usuário (doc 06 §12.4 — rastro visível na auditoria):
  // a preferência dele e as últimas notificações dirigidas com "e-mail enviado em"
  // ou o motivo de não ter saído.
  @Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
  @Get('usuarios/:id/alertas-email')
  alertasEmail(@Param('id') id: string) {
    return this.notificacao.alertasEmailDoUsuario(id);
  }

  // Exclusão (Luís, 07/11/2026: "fazer a limpa" nos usuários de produção, inclusive o
  // `admin`, concentrando o papel de administrador no perfil dele). Exclusão LÓGICA:
  // o registro fica para o histórico (aprovações, decisões, auditoria apontam para
  // ele), mas o acesso acaba na hora — sessões revogadas, e-mail liberado para reuso.
  // Só ADMIN exclui; ninguém exclui a si mesmo; o último administrador ativo fica.
  @Roles(RoleUsuario.ADMIN)
  @Delete('usuarios/:id')
  @HttpCode(200)
  async excluir(@Param('id') id: string, @CurrentUser() user: UsuarioAutenticado) {
    if (id === user.id) {
      throw new BadRequestException({ erro: 'auto_bloqueio', mensagem: 'Você não pode excluir o seu próprio usuário' });
    }
    const alvo = await this.prisma.db.usuario.findFirst({ where: { id, deletedAt: null }, include: { roles: true } });
    if (!alvo) throw new NotFoundException({ erro: 'usuario_nao_encontrado', mensagem: 'Usuário não encontrado' });
    const papeis = alvo.roles.map((r) => r.role);
    if (alvo.ativo && papeis.includes(RoleUsuario.ADMIN)) await this.exigirOutroAdmin(id);
    await this.exigirAdminComConfiguracoes(({ usuarios }) => {
      const u = usuarios.find((x) => x.id === id);
      if (u) u.deletedAt = new Date();
    });

    const agora = new Date();
    // Sufixo libera o e-mail (é único) para um cadastro novo; o original fica na auditoria.
    const emailLiberado = `${alvo.email}.excluido-${agora.getTime()}`;
    await this.prisma.$transaction(async (tx) => {
      await tx.usuario.update({ where: { id }, data: { ativo: false, deletedAt: agora, email: emailLiberado, googleSub: null } });
      await tx.refreshToken.updateMany({ where: { usuarioId: id, revogado: false }, data: { revogado: true } });
      await tx.permissaoUsuarioArea.deleteMany({ where: { usuarioId: id } });
    });
    this.permissoes.invalidar(id);
    await this.auditar(user.id, 'usuario_excluido', id, { nome: alvo.nome, email: alvo.email, ativo: alvo.ativo, papeis }, { deletedAt: agora.toISOString() });
    return { resultado: 'ok' };
  }

  // --- Matriz papel × área (padrões que o papel carrega) ---
  @Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
  @Get('permissoes/matriz')
  async matriz() {
    const linhas = await this.prisma.db.permissaoPapelArea.findMany();
    return {
      papeis: Object.values(RoleUsuario),
      areas: Object.values(AreaSistema),
      celulas: linhas.map((l) => ({ papel: l.papel, area: l.area, permitido: l.permitido })),
    };
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
  @Put('permissoes/matriz')
  async salvarCelula(
    @Body(new ZodValidationPipe(celulaMatrizSchema)) dto: z.infer<typeof celulaMatrizSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    const anterior = await this.prisma.db.permissaoPapelArea.findUnique({
      where: { papel_area: { papel: dto.papel, area: dto.area } },
    });
    // Auto-bloqueio (doc 06 §13.3): tirar CONFIGURACOES do papel ADMIN só passa se
    // algum administrador ativo continuar com a área por exceção.
    await this.exigirAdminComConfiguracoes(({ matriz }) => {
      const celula = matriz.find((c) => c.papel === dto.papel && c.area === dto.area);
      if (celula) celula.permitido = dto.permitido;
      else matriz.push({ papel: dto.papel, area: dto.area, permitido: dto.permitido });
    });
    await this.prisma.db.permissaoPapelArea.upsert({
      where: { papel_area: { papel: dto.papel, area: dto.area } },
      update: { permitido: dto.permitido },
      create: { papel: dto.papel, area: dto.area, permitido: dto.permitido },
    });
    this.permissoes.invalidar(); // matriz mudou: todo mundo recalcula
    await this.auditar(user.id, 'permissao_papel_area_alterada', `${dto.papel}:${dto.area}`,
      { permitido: anterior?.permitido ?? false }, { permitido: dto.permitido });
    return { resultado: 'ok' };
  }

  // --- Exceções por usuário (concede/revoga área específica) ---
  @Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
  @Get('usuarios/:id/permissoes')
  async permissoesUsuario(@Param('id') id: string) {
    const usuario = await this.prisma.db.usuario.findFirst({
      where: { id },
      include: { roles: true, permissoesArea: true },
    });
    if (!usuario) return { areasEfetivas: [], excecoes: [] };
    const matriz = await this.prisma.db.permissaoPapelArea.findMany();
    return {
      papeis: usuario.roles.map((r) => r.role),
      excecoes: usuario.permissoesArea.map((p) => ({ area: p.area, concedida: p.concedida, motivo: p.motivo })),
      areasDoPapel: this.permissoes.resolver(usuario.roles.map((r) => r.role), [], matriz),
      areasEfetivas: this.permissoes.resolver(usuario.roles.map((r) => r.role), usuario.permissoesArea, matriz),
    };
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
  @Put('usuarios/:id/permissoes')
  async definirExcecao(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(excecaoSchema)) dto: z.infer<typeof excecaoSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    // Auto-bloqueio (doc 06 §13.3): retirar CONFIGURACOES do único administrador por exceção.
    await this.exigirAdminComConfiguracoes(({ usuarios }) => {
      const u = usuarios.find((x) => x.id === id);
      if (!u) return;
      u.excecoes = u.excecoes.filter((e) => e.area !== dto.area);
      if (dto.concedida !== null) u.excecoes.push({ area: dto.area, concedida: dto.concedida });
    });
    if (dto.concedida === null) {
      await this.prisma.db.permissaoUsuarioArea.deleteMany({ where: { usuarioId: id, area: dto.area } });
      await this.auditar(user.id, 'permissao_usuario_excecao_removida', id, undefined, { area: dto.area });
    } else {
      await this.prisma.db.permissaoUsuarioArea.upsert({
        where: { usuarioId_area: { usuarioId: id, area: dto.area } },
        update: { concedida: dto.concedida, motivo: dto.motivo },
        create: { usuarioId: id, area: dto.area, concedida: dto.concedida, motivo: dto.motivo },
      });
      await this.auditar(user.id, 'permissao_usuario_excecao_definida', id, undefined,
        { area: dto.area, concedida: dto.concedida, motivo: dto.motivo });
    }
    this.permissoes.invalidar(id);
    return { areasEfetivas: [...(await this.permissoes.areasEfetivas(id))] };
  }

  // --- internos ---

  // Papel de administrador só é dado ou tirado por quem é administrador (07/11:
  // o papel fica concentrado; DIRETOR gerencia os demais papéis).
  private exigirAdminParaPapelAdmin(user: UsuarioAutenticado, papeis: RoleUsuario[]) {
    if (papeis.includes(RoleUsuario.ADMIN) && !user.roles.includes(RoleUsuario.ADMIN)) {
      throw new ForbiddenException({ erro: 'sem_alcada', mensagem: 'Só um administrador pode conceder ou retirar o papel de administrador' });
    }
  }

  // O sistema nunca fica sem administrador ativo.
  private async exigirOutroAdmin(exceto: string) {
    const outros = await this.prisma.db.usuario.count({
      where: { id: { not: exceto }, deletedAt: null, ativo: true, roles: { some: { role: RoleUsuario.ADMIN } } },
    });
    if (outros === 0) {
      throw new BadRequestException({ erro: 'ultimo_admin', mensagem: 'Este é o único administrador ativo — conceda o papel a outro usuário antes' });
    }
  }

  // ...e nunca sem administrador ativo COM a área Configurações (doc 06 §13.3) — 422.
  private async exigirAdminComConfiguracoes(
    simular: (estado: { usuarios: UsuarioParaGuarda[]; matriz: { papel: RoleUsuario; area: AreaSistema; permitido: boolean }[] }) => void,
  ) {
    try {
      await this.permissoes.exigirAdminComConfiguracoes(simular);
    } catch (e) {
      if (e instanceof SemAdminComConfiguracoesError) {
        throw new UnprocessableEntityException({ erro: 'sem_admin_configuracoes', mensagem: e.message });
      }
      throw e;
    }
  }

  private async auditar(usuarioId: string, acao: string, entidadeId: string, antes?: unknown, depois?: unknown) {
    await this.prisma.db.logAuditoria.create({
      data: {
        usuarioId,
        acao,
        entidade: 'usuario',
        entidadeId,
        antes: antes ? (JSON.parse(JSON.stringify(antes)) as Prisma.InputJsonValue) : undefined,
        depois: depois ? (JSON.parse(JSON.stringify(depois)) as Prisma.InputJsonValue) : undefined,
      },
    });
  }
}
