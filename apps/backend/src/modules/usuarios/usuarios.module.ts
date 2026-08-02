import { Module } from '@nestjs/common';
import { UsuariosController } from './usuarios.controller';

// Gestão de Usuários e Permissões por Área (doc 02 §16) — domínio Plataforma.
@Module({
  controllers: [UsuariosController],
})
export class UsuariosModule {}
