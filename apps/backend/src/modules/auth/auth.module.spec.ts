import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth.module';
import { AuthService } from './auth.service';
import { DatabaseModule } from '../../database/database.module';
import { PrismaService } from '../../database/prisma.service';

// Regressão do 1º deploy do bloco 2 (homolog, 13/11/2026): o AuthService passou a
// depender de ControleBloqueioSenha, que não estava registrado no módulo. Os
// testes unitários instanciam o service à mão e não viram; o backend não subia.
// Este teste compila o AuthModule de verdade (DI do Nest), com banco dublado e
// configuração mínima, sem abrir conexão nem porta.
describe('AuthModule (injeção de dependências)', () => {
  it('compila e resolve o AuthService com todas as dependências', async () => {
    const modulo = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ jwt: { secret: 'segredo-de-teste', accessExpiresIn: '15m', refreshExpiresInDays: 7 } })],
        }),
        DatabaseModule,
        AuthModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({ db: {} })
      .compile();

    expect(modulo.get(AuthService)).toBeInstanceOf(AuthService);
    await modulo.close();
  });
});
