// @azit/types — tipos e enums compartilhados entre backend e frontend.
// Sem lógica: apenas tipos. Fonte da verdade de status e enums (Regra 9 do CLAUDE.md).

// Enums
export * from './enums/status-parcela';
export * from './enums/status-fatura';
export * from './enums/status-contrato-credito';
export * from './enums/status-contrato-investimento';
export * from './enums/status-acordo';
export * from './enums/status-novacao';
export * from './enums/originacao';
export * from './enums/modelo-investimento';
export * from './enums/origem-capital';
export * from './enums/origem-item-contratado';
export * from './enums/titular';
export * from './enums/ativo';
export * from './enums/contrato-credito';
export * from './enums/role-usuario';

// Entidades
export * from './entities/titular';
export * from './entities/conta';
export * from './entities/ativo';
export * from './entities/origem-capital';
export * from './entities/contrato-investimento';
export * from './entities/contrato-credito';
export * from './entities/item-contratado';
export * from './entities/parcela';
export * from './entities/fatura';
export * from './entities/recebivel';
export * from './entities/acordo';
