import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { RoleUsuario, StatusTituloPagar } from '@prisma/client';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, UsuarioAutenticado } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ContasPagarService } from './contas-pagar.service';

// Contas a Pagar (doc 02 §18). Papéis (Processo §8.2): solicitante = OPERADOR;
// validação/lotes/conciliação = FINANCEIRO; decisões na Central de Aprovações.

const OPERACAO = [RoleUsuario.ADMIN, RoleUsuario.DIRETOR, RoleUsuario.FINANCEIRO] as const;
const SOLICITANTES = [RoleUsuario.ADMIN, RoleUsuario.DIRETOR, RoleUsuario.FINANCEIRO, RoleUsuario.OPERADOR] as const;

const criarFornecedorSchema = z.object({
  cpfCnpj: z.string().min(11),
  nome: z.string().min(2),
  contato: z.string().optional(),
  email: z.string().email().optional(),
  banco: z.string().optional(),
  agencia: z.string().optional(),
  conta: z.string().optional(),
  chavePix: z.string().optional(),
});

const alterarBancarioSchema = z.object({
  banco: z.string().optional(),
  agencia: z.string().optional(),
  conta: z.string().optional(),
  chavePix: z.string().optional(),
  motivo: z.string().min(3),
});

const criarOrcamentoSchema = z.object({
  entidadeId: z.string().min(1),
  descricao: z.string().min(3),
  naturezaId: z.string().optional(),
  centroCustoAreaId: z.string().optional(),
  ativoId: z.string().optional(),
  urgencia: z.enum(['NORMAL', 'PRIORIDADE', 'EMERGENCIA']).optional(),
  justificativaDispensa: z.string().optional(),
  propostas: z
    .array(
      z.object({
        fornecedorId: z.string().optional(),
        nomeFornecedor: z.string().optional(),
        valor: z.coerce.number().int().min(1),
        prazo: z.string().optional(),
        garantia: z.string().optional(),
        condicao: z.string().optional(),
      }),
    )
    .min(1),
});

const criarTituloSchema = z.object({
  entidadeId: z.string().min(1),
  fornecedorId: z.string().min(1),
  descricao: z.string().min(3),
  valor: z.coerce.number().int().min(1),
  vencimento: z.string().min(8),
  competencia: z.string().optional(),
  naturezaId: z.string().min(1),
  centroCustoAreaId: z.string().min(1),
  responsavelEconomico: z.enum(['AZIT', 'INVESTIDOR', 'CLIENTE', 'OUTRA_ENTIDADE']).optional(),
  formaPagamento: z.string().optional(),
  ativoId: z.string().optional(),
  urgente: z.boolean().optional(),
  justificativaUrgencia: z.string().optional(),
  justificativaNatureza: z.string().optional(),
  documentoNome: z.string().optional(),
  documentoTipo: z.string().optional(),
  prazoPrestacaoContas: z.string().optional(),
});

const validarSchema = z.object({
  decisao: z.enum(['validar', 'devolver', 'bloquear']),
  motivo: z.string().optional(),
});

const criarLoteSchema = z.object({
  entidadeId: z.string().min(1),
  contaBancariaId: z.string().min(1),
  dataProgramada: z.string().optional(),
  tituloIds: z.array(z.string()).min(1),
  urgente: z.boolean().optional(),
});

const pagamentoSchema = z.object({
  dataEfetiva: z.string().min(8),
  valorEfetivo: z.coerce.number().int().min(1),
  identificador: z.string().optional(),
  comprovanteNome: z.string().min(1),
  divergencia: z.string().optional(),
});

const conciliarSchema = z.object({
  dataSaida: z.string().min(8),
  valorExtrato: z.coerce.number().int().min(1),
  observacao: z.string().optional(),
});

@Controller('financeiro')
export class ContasPagarController {
  constructor(private readonly service: ContasPagarService) {}

  // --- Configuração / cadastros estruturantes (FA-CP-00) ---
  @Roles(...SOLICITANTES)
  @Get('configuracao')
  configuracao() {
    return this.service.configuracao();
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
  @Post('entidades')
  @HttpCode(201)
  criarEntidade(
    @Body(new ZodValidationPipe(z.object({ razaoSocial: z.string().min(2), cnpj: z.string().optional(), unidadeNegocio: z.string().optional(), estruturaId: z.string().optional() })))
    dto: { razaoSocial: string; cnpj?: string; unidadeNegocio?: string; estruturaId?: string },
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.service.criarEntidade(dto, user.id);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
  @Post('entidades/:id/contas')
  @HttpCode(201)
  criarConta(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(z.object({ banco: z.string().min(2), agencia: z.string().optional(), conta: z.string().optional(), tipo: z.string().optional(), finalidade: z.string().optional() })))
    dto: { banco: string; agencia?: string; conta?: string; tipo?: string; finalidade?: string },
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.service.criarContaBancaria(id, dto, user.id);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
  @Post('naturezas')
  @HttpCode(201)
  criarNatureza(
    @Body(new ZodValidationPipe(z.object({ codigo: z.string().min(2), nome: z.string().min(2), exigeAtivo: z.boolean().optional(), exigeCotacao: z.boolean().optional(), especial: z.boolean().optional(), exigeJustificativa: z.boolean().optional() })))
    dto: { codigo: string; nome: string; exigeAtivo?: boolean; exigeCotacao?: boolean; especial?: boolean; exigeJustificativa?: boolean },
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.service.criarNatureza(dto, user.id);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
  @Post('centros')
  @HttpCode(201)
  criarCentro(
    @Body(new ZodValidationPipe(z.object({ codigo: z.string().min(2), nome: z.string().min(2), responsavelUsuarioId: z.string().optional() })))
    dto: { codigo: string; nome: string; responsavelUsuarioId?: string },
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.service.criarCentro(dto, user.id);
  }

  // --- Fornecedores (FA-CP-01) ---
  @Roles(...SOLICITANTES)
  @Get('fornecedores')
  fornecedores() {
    return this.service.listarFornecedores();
  }

  @Roles(...OPERACAO)
  @Post('fornecedores')
  @HttpCode(201)
  criarFornecedor(
    @Body(new ZodValidationPipe(criarFornecedorSchema)) dto: z.infer<typeof criarFornecedorSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.service.criarFornecedor(dto, user.id);
  }

  @Roles(...OPERACAO)
  @Post('fornecedores/:id/dados-bancarios')
  @HttpCode(201)
  alterarBancario(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(alterarBancarioSchema)) dto: z.infer<typeof alterarBancarioSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.service.alterarDadosBancarios(id, dto, user.id);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
  @Post('fornecedores/:id/status')
  @HttpCode(200)
  statusFornecedor(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(z.object({ status: z.enum(['BLOQUEADO', 'INATIVO', 'ATIVO']), motivo: z.string().optional() })))
    dto: { status: 'BLOQUEADO' | 'INATIVO' | 'ATIVO'; motivo?: string },
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.service.statusFornecedor(id, dto.status, dto.motivo, user.id);
  }

  // --- Orçamentos (FA-CP-02) ---
  @Roles(...SOLICITANTES)
  @Get('orcamentos')
  orcamentos() {
    return this.service.listarOrcamentos();
  }

  @Roles(...SOLICITANTES)
  @Post('orcamentos')
  @HttpCode(201)
  criarOrcamento(
    @Body(new ZodValidationPipe(criarOrcamentoSchema)) dto: z.infer<typeof criarOrcamentoSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.service.criarOrcamento(dto, user.id);
  }

  @Roles(...SOLICITANTES)
  @Post('orcamentos/:id/submeter')
  @HttpCode(200)
  submeterOrcamento(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(z.object({ propostaId: z.string().min(1), motivoSelecao: z.string().optional() })))
    dto: { propostaId: string; motivoSelecao?: string },
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.service.submeterOrcamento(id, dto.propostaId, dto.motivoSelecao, user.id);
  }

  @Roles(...OPERACAO)
  @Post('orcamentos/:id/converter')
  @HttpCode(201)
  converterOrcamento(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(z.object({ fornecedorId: z.string().min(1), vencimento: z.string().min(8), competencia: z.string().optional(), naturezaId: z.string().min(1), centroCustoAreaId: z.string().min(1), formaPagamento: z.string().optional() })))
    dto: { fornecedorId: string; vencimento: string; competencia?: string; naturezaId: string; centroCustoAreaId: string; formaPagamento?: string },
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.service.converterOrcamento(id, dto, user.id);
  }

  // --- Títulos (FA-CP-03/04/05/10) ---
  @Roles(...SOLICITANTES)
  @Get('titulos')
  titulos(@Query('status') status?: string, @Query('entidadeId') entidadeId?: string) {
    return this.service.listarTitulos({
      status: status ? (status.toUpperCase() as StatusTituloPagar) : undefined,
      entidadeId,
    });
  }

  @Roles(...SOLICITANTES)
  @Post('titulos')
  @HttpCode(201)
  criarTitulo(
    @Body(new ZodValidationPipe(criarTituloSchema)) dto: z.infer<typeof criarTituloSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.service.criarTitulo(dto, user.id);
  }

  @Roles(...OPERACAO)
  @Post('titulos/:id/validar')
  @HttpCode(200)
  validar(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(validarSchema)) dto: z.infer<typeof validarSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.service.validarTitulo(id, dto.decisao, dto.motivo, user.id);
  }

  @Roles(...SOLICITANTES)
  @Post('titulos/:id/reenviar')
  @HttpCode(200)
  reenviar(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(z.object({ descricao: z.string().optional(), valor: z.coerce.number().int().optional(), vencimento: z.string().optional(), competencia: z.string().optional(), documentoNome: z.string().optional() })))
    dto: { descricao?: string; valor?: number; vencimento?: string; competencia?: string; documentoNome?: string },
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.service.reenviarTitulo(id, dto, user.id);
  }

  @Roles(...OPERACAO)
  @Post('titulos/:id/cancelar')
  @HttpCode(200)
  cancelar(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(z.object({ motivo: z.string().min(3) }))) dto: { motivo: string },
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.service.cancelarTitulo(id, dto.motivo, user.id);
  }

  @Roles(...OPERACAO)
  @Post('titulos/:id/solicitar-reabertura')
  @HttpCode(201)
  solicitarReabertura(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(z.object({ motivo: z.string().min(3) }))) dto: { motivo: string },
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.service.solicitarReabertura(id, dto.motivo, user.id);
  }

  @Roles(...OPERACAO)
  @Post('titulos/:id/pagamento')
  @HttpCode(201)
  registrarPagamento(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(pagamentoSchema)) dto: z.infer<typeof pagamentoSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.service.registrarPagamento(id, dto, user.id);
  }

  @Roles(...OPERACAO)
  @Post('pagamentos/:id/conciliar')
  @HttpCode(201)
  conciliar(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(conciliarSchema)) dto: z.infer<typeof conciliarSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.service.conciliar(id, dto, user.id);
  }

  // --- Lotes (FA-CP-06/07/08) ---
  @Roles(...SOLICITANTES)
  @Get('lotes')
  lotes() {
    return this.service.listarLotes();
  }

  @Roles(...OPERACAO)
  @Post('lotes')
  @HttpCode(201)
  criarLote(
    @Body(new ZodValidationPipe(criarLoteSchema)) dto: z.infer<typeof criarLoteSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.service.criarLote(dto, user.id);
  }

  @Roles(...SOLICITANTES)
  @Get('lotes/:id/resumo')
  async resumoLote(@Param('id') id: string, @Res() res: { header: (k: string, v: string) => unknown; send: (b: string) => unknown }) {
    const { nomeArquivo, conteudo } = await this.service.resumoLote(id);
    res.header('Content-Type', 'text/csv; charset=utf-8');
    res.header('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
    res.send('﻿' + conteudo);
  }

  @Roles(...OPERACAO)
  @Post('lotes/:id/evento')
  @HttpCode(200)
  eventoLote(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(z.object({ evento: z.enum(['enviado_bpo', 'cadastrado_cora', 'aprovado_banco']) })))
    dto: { evento: 'enviado_bpo' | 'cadastrado_cora' | 'aprovado_banco' },
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.service.registrarEventoLote(id, dto.evento, user.id);
  }

  @Roles(...SOLICITANTES)
  @Get('painel')
  painel() {
    return this.service.painel();
  }
}
