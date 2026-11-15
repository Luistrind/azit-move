import { Module } from '@nestjs/common';
import { UsuariosController } from './usuarios.controller';
import { AuthModule } from '../auth/auth.module';

// Gestão de Usuários e Permissões por Área (doc 02 §16) — domínio Plataforma.
// Importa o AuthModule para "encerrar sessões" e "últimos acessos" (doc 06 v1.1 §2.5)
// usarem a MESMA função do AuthService, sem duplicar consulta de tokens/acessos.
@Module({
  imports: [AuthModule],
  controllers: [UsuariosController],
})
export class UsuariosModule {}
