import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, Patch, Post, Put } from '@nestjs/common';
import { AreaSistema, Prisma, RoleUsuario } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, UsuarioAutenticado } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../database/prisma.service';
import { PermissoesService } from '../permissoes/permissoes.service';
import { Area, AreaLivre } from '../../common/decorators/area.decorator';

// Gestão de Usuários e Permissões por Área (doc 02 §16).
// Papel carrega as áreas do seu domínio (matriz papel×área, editável);
// exceções por usuário concedem/revogam áreas específicas com motivo.
// A conta das áreas efetivas vive em PermissoesService (única — doc 06 §5.4);
// toda mutação aqui invalida o cache dela para a área valer na hora.

const preferenciasSchema = z.object({
  ordemInicio: z.array(z.string().max(60)).max(30).optional(),
});

const criarUsuarioSchema = z.object({
  nome: z.string().min(3),
  email: z.string().email(),
  senha: z.string().min(6),
  papeis: z.array(z.nativeEnum(RoleUsuario)).min(1),
});

const atualizarUsuarioSchema = z.object({
  nome: z.string().min(3).optional(),
  ativo: z.boolean().optional(),
  papeis: z.array(z.nativeEnum(RoleUsuario)).min(1).optional(),
});

const senhaSchema = z.object({ senha: z.string().min(6) });

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

  @Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
  @Get('usuarios')
  async listar() {
    const usuarios = await this.prisma.db.usuario.findMany({
      where: { deletedAt: null },
      include: { roles: true, permissoesArea: true },
      orderBy: { nome: 'asc' },
    });
    const matriz = await this.prisma.db.permissaoPapelArea.findMany();
    return Promise.all(
      usuarios.map(async (u) => ({
        id: u.id,
        nome: u.nome,
        email: u.email,
        ativo: u.ativo,
        papeis: u.roles.map((r) => r.role),
        excecoes: u.permissoesArea.map((p) => ({ area: p.area, concedida: p.concedida, motivo: p.motivo })),
        areasEfetivas: this.permissoes.resolver(u.roles.map((r) => r.role), u.permissoesArea, matriz),
      })),
    );
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
  @Post('usuarios')
  @HttpCode(201)
  async criar(
    @Body(new ZodValidationPipe(criarUsuarioSchema)) dto: z.infer<typeof criarUsuarioSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    this.exigirAdminParaPapelAdmin(user, dto.papeis);
    const emailEmUso = await this.prisma.db.usuario.findUnique({ where: { email: dto.email.toLowerCase() }, select: { id: true } });
    if (emailEmUso) throw new BadRequestException({ erro: 'email_em_uso', mensagem: 'Já existe um usuário com este e-mail' });
    const senhaHash = await bcrypt.hash(dto.senha, 10);
    const criado = await this.prisma.db.usuario.create({
      data: {
        nome: dto.nome,
        email: dto.email.toLowerCase(),
        senhaHash,
        roles: { create: dto.papeis.map((role) => ({ role })) },
      },
    });
    await this.auditar(user.id, 'usuario_criado', criado.id, undefined, { nome: dto.nome, email: dto.email, papeis: dto.papeis });
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
    await this.prisma.db.usuario.update({ where: { id }, data: { nome: dto.nome, ativo: dto.ativo } });
    if (dto.papeis) {
      await this.prisma.db.usuarioRole.deleteMany({ where: { usuarioId: id } });
      await this.prisma.db.usuarioRole.createMany({ data: dto.papeis.map((role) => ({ usuarioId: id, role })) });
    }
    this.permissoes.invalidar(id);
    await this.auditar(user.id, 'usuario_alterado', id,
      { nome: antes?.nome, ativo: antes?.ativo, papeis: antes?.roles.map((r) => r.role) },
      { nome: dto.nome, ativo: dto.ativo, papeis: dto.papeis });
    return { resultado: 'ok' };
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
  @Post('usuarios/:id/senha')
  @HttpCode(200)
  async redefinirSenha(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(senhaSchema)) dto: z.infer<typeof senhaSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    const senhaHash = await bcrypt.hash(dto.senha, 10);
    await this.prisma.db.usuario.update({ where: { id }, data: { senhaHash } });
    await this.auditar(user.id, 'usuario_senha_redefinida', id);
    return { resultado: 'ok' };
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

    const agora = new Date();
    // Sufixo libera o e-mail (é único) para um cadastro novo; o original fica na auditoria.
    const emailLiberado = `${alvo.email}.excluido-${agora.getTime()}`;
    await this.prisma.$transaction(async (tx) => {
      await tx.usuario.update({ where: { id }, data: { ativo: false, deletedAt: agora, email: emailLiberado } });
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
