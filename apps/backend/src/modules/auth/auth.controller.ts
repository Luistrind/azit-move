import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UsePipes,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  CurrentUser,
  UsuarioAutenticado,
} from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { loginSchema, LoginDto } from './dto/login.dto';
import { refreshSchema, RefreshDto } from './dto/refresh.dto';
import { RoleUsuario } from '@prisma/client';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(loginSchema))
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.senha);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(refreshSchema))
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(refreshSchema))
  async logout(@Body() dto: RefreshDto) {
    await this.authService.logout(dto.refreshToken);
    return { ok: true };
  }

  // Rota autenticada simples — confirma o token e devolve a identidade (request.user).
  @Get('me')
  me(@CurrentUser() user: UsuarioAutenticado) {
    return user;
  }

  // Rota protegida por role — usada para validar o RolesGuard (item 1.5).
  @Roles(RoleUsuario.ADMIN)
  @Get('admin-check')
  adminCheck(@CurrentUser() user: UsuarioAutenticado) {
    return { ok: true, mensagem: 'Acesso de ADMIN concedido', userId: user.id };
  }
}
