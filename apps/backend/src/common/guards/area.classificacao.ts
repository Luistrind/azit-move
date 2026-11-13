import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AreaSistema } from '@prisma/client';
import { AREA_KEY, AREA_LIVRE_KEY } from '../decorators/area.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

// Leitura da classificação de área de uma rota (doc 06 §7.5), compartilhada pelo
// AreaGuard, pela verificação de boot e pelo teste que varre os controllers.
// Precedência: método > classe. @Public dispensa tudo (não há usuário).

export type Classificacao =
  | { tipo: 'publica' }
  | { tipo: 'livre'; justificativa: string }
  | { tipo: 'area'; areas: AreaSistema[] }
  | null;

type Alvo = object;
export type ClasseController = { prototype: object; name: string };

function classificarNivel(alvo: Alvo): Classificacao {
  if (Reflect.getMetadata(IS_PUBLIC_KEY, alvo) === true) return { tipo: 'publica' };
  const livre = Reflect.getMetadata(AREA_LIVRE_KEY, alvo) as string | undefined;
  if (typeof livre === 'string') return { tipo: 'livre', justificativa: livre };
  const areas = Reflect.getMetadata(AREA_KEY, alvo) as AreaSistema[] | undefined;
  if (Array.isArray(areas) && areas.length > 0) return { tipo: 'area', areas };
  return null;
}

export function classificarRota(handler: Alvo | undefined, classe: Alvo): Classificacao {
  return (handler ? classificarNivel(handler) : null) ?? classificarNivel(classe);
}

// Métodos do controller que são rotas HTTP (têm @Get/@Post/...).
export function rotasDoController(classe: ClasseController): string[] {
  const proto = classe.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(proto).filter((nome) => {
    if (nome === 'constructor') return false;
    const fn = proto[nome];
    return typeof fn === 'function' && Reflect.getMetadata(METHOD_METADATA, fn) !== undefined;
  });
}

export function ehController(classe: unknown): classe is ClasseController {
  return typeof classe === 'function' && Reflect.getMetadata(PATH_METADATA, classe) !== undefined;
}

// Lista "Controller.metodo" de toda rota sem @Area/@AreaLivre/@Public.
// Vazia = tudo classificado. Usada no boot (derruba) e no jest (falha).
export function rotasSemClassificacao(controllers: ClasseController[]): string[] {
  const faltantes: string[] = [];
  for (const classe of controllers) {
    const proto = classe.prototype as Record<string, Alvo>;
    for (const metodo of rotasDoController(classe)) {
      if (classificarRota(proto[metodo], classe) === null) faltantes.push(`${classe.name}.${metodo}`);
    }
  }
  return faltantes;
}
