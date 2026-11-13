import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from '../../common/decorators/public.decorator';
import {
  CurrentUser,
  UsuarioAutenticado,
} from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { loginSchema, LoginDto } from './dto/login.dto';
import { refreshSchema, RefreshDto } from './dto/refresh.dto';
import { googleSchema, GoogleDto } from './dto/google.dto';
import { AreaLivre } from '../../common/decorators/area.decorator';
import { contextoRequisicao, RequisicaoComOrigem } from '../../common/http/contexto-requisicao';
import { LoginThrottlerGuard } from './login-throttler.guard';

@AreaLivre('sessão do próprio usuário (login, refresh, logout, me) — doc 06 §5.4 item 6')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // O que a tela de login precisa antes de qualquer credencial (doc 06 §2.2):
  // o client id do Google deste ambiente (público) ou null = botão não aparece.
  @Public()
  @Get('config')
  config() {
    return this.authService.configPublica();
  }

  // Entrar com Google (doc 06 §2.2, §10.1) — caminho normal. Limite por IP (§2.5).
  @Public()
  @UseGuards(LoginThrottlerGuard)
  @Post('google')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(googleSchema))
  google(@Body() dto: GoogleDto, @Req() req: RequisicaoComOrigem) {
    return this.authService.loginGoogle(dto.credential, contextoRequisicao(req));
  }

  // Entrar por senha — reserva, só com permiteSenha (doc 06 §2.3, §10.1-A). Limite por IP.
  @Public()
  @UseGuards(LoginThrottlerGuard)
  @Post('login')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(loginSchema))
  login(@Body() dto: LoginDto, @Req() req: RequisicaoComOrigem) {
    return this.authService.login(dto.email, dto.senha, contextoRequisicao(req));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(refreshSchema))
  refresh(@Body() dto: RefreshDto, @Req() req: RequisicaoComOrigem) {
    return this.authService.refresh(dto.refreshToken, contextoRequisicao(req));
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(refreshSchema))
  async logout(@Body() dto: RefreshDto) {
    await this.authService.logout(dto.refreshToken);
    return { ok: true };
  }

  // Identidade completa do usuário logado (04/11): a tela usa para re-hidratar a
  // sessão quando só o token está guardado no navegador — sem isso a sidebar
  // caía no fallback e TODA permissão de tela dava falso (botões sumiam).
  @Get('me')
  me(@CurrentUser() user: UsuarioAutenticado) {
    return this.authService.me(user.id);
  }

  // GET /auth/admin-check REMOVIDO (auditoria 15/09, P0-5): era andaime de
  // teste do RolesGuard (item 1.5) e ficou vivo em produção.
}
