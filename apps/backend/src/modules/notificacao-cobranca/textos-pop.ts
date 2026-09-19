// Modelos de notificação do POP-COB-001 v1.0 (28/08/2026), Anexos I–VI —
// transcritos do documento da operação. Os campos entre colchetes do POP viram
// variáveis {{...}} preenchidas pelo sistema (doc 02 §23 item 6). Editáveis
// em Configurações > Notificações de cobrança; este é o PADRÃO restaurável.
//
// Formato: linhas simples = parágrafos; linhas iniciadas por "- " = itens.

export interface TextoNotificacao {
  subtitulo: string;
  assunto: string;
  texto: string;
}

// Variáveis disponíveis (a tela lista para quem edita).
export const VARIAVEIS_NOTIFICACAO: { chave: string; descricao: string }[] = [
  { chave: 'nome', descricao: 'Nome do comprador (titular)' },
  { chave: 'veiculo', descricao: 'Marca/modelo do veículo' },
  { chave: 'placa', descricao: 'Placa do veículo' },
  { chave: 'contrato', descricao: 'Número do contrato' },
  { chave: 'dataContrato', descricao: 'Data de assinatura do contrato' },
  { chave: 'vencimento', descricao: 'Vencimento da parcela mais antiga em aberto' },
  { chave: 'valorParcela', descricao: 'Valor da parcela mais antiga em aberto' },
  { chave: 'vencimento1', descricao: 'Vencimento mais antigo em aberto' },
  { chave: 'vencimento2', descricao: 'Vencimento em aberto mais recente' },
  { chave: 'vencimentos', descricao: 'Todos os vencimentos em aberto (lista)' },
  { chave: 'quantidadeParcelas', descricao: 'Quantidade de parcelas vencidas' },
  { chave: 'valorAtualizado', descricao: 'Débito atualizado (parcelas + multa + juros pro rata)' },
  { chave: 'n1Data', descricao: 'Data de envio da 1ª notificação' },
  { chave: 'n1Hora', descricao: 'Horário de envio da 1ª notificação' },
  { chave: 'n2Data', descricao: 'Data de envio da 2ª notificação' },
  { chave: 'n2Hora', descricao: 'Horário de envio da 2ª notificação' },
  { chave: 'n3Data', descricao: 'Data de envio da 3ª notificação' },
  { chave: 'n3Hora', descricao: 'Horário de envio da 3ª notificação' },
  { chave: 'n4Data', descricao: 'Data de envio da 4ª notificação' },
  { chave: 'n4Hora', descricao: 'Horário de envio da 4ª notificação' },
  { chave: 'n5Data', descricao: 'Data de envio da 5ª notificação' },
  { chave: 'n5Hora', descricao: 'Horário de envio da 5ª notificação' },
  { chave: 'dataRetomada', descricao: 'Data da retomada do veículo' },
  { chave: 'dataComunicacao', descricao: 'Data desta comunicação' },
];

const RASTREADOR =
  'é expressamente vedada a retirada, desativação, violação ou qualquer interferência no funcionamento do rastreador, bloqueador ou demais dispositivos de monitoramento e controle instalados no veículo. A eventual retirada ou interferência nesses dispositivos será interpretada como impedimento ao monitoramento, localização ou retomada do veículo, de forma a ensejar na caracterização do ilícito penal de apropriação indébita, nos termos do art. 168 do Código Penal, sujeitando o responsável às consequências penais aplicáveis';

const ASSINATURA = `Atenciosamente,
AZIT Comércio de Veículos Ltda
Data desta comunicação: {{dataComunicacao}}`;

export const TEXTOS_POP: Record<number, TextoNotificacao> = {
  1: {
    subtitulo: 'Notificação de primeiro inadimplemento',
    assunto: 'Parcela em aberto – Contrato de Compra e Venda de Veículo',
    texto: `Prezado(a) {{nome}},
Identificamos que a parcela do veículo {{veiculo}}, placa {{placa}}, com vencimento em {{vencimento}}, no valor de {{valorParcela}}, ainda não foi paga.
Informamos que:
- sobre o valor em atraso incidem os encargos previstos no contrato (multa e juros moratórios), estando o débito atualizado em {{valorAtualizado}} nesta data;
- ${RASTREADOR};
- nos termos da Cláusula 8.3 do contrato firmado entre as partes, a NOTIFICANTE já está autorizada a adotar as medidas de bloqueio e retomada do veículo em razão do inadimplemento;
- para evitar o prosseguimento dessas medidas, disponibilizamos o prazo de 48 (quarenta e oito) horas, a contar do envio desta mensagem, para a regularização do débito.
Para efetuar o pagamento ou tratar sobre a sua situação, entre em contato conosco pelos canais informados no seu contrato.
${ASSINATURA}`,
  },
  2: {
    subtitulo: 'Reiteração da cobrança e convite para negociação',
    assunto: 'Reiteração – Parcela em aberto',
    texto: `Prezado(a) {{nome}},
Retomamos contato em razão da parcela do veículo {{veiculo}}, placa {{placa}}, com vencimento em {{vencimento}}, que permanece em aberto. O valor atualizado do débito, incluindo os encargos contratuais, é de {{valorAtualizado}}.
Registra-se que a 1ª notificação acerca do inadimplemento foi enviada em {{n1Data}}, às {{n1Hora}}, ocasião em que foi informado o vencimento da parcela e concedido prazo para a regularização da pendência. Até o momento, contudo, o débito permanece sem regularização.
Reforçamos a necessidade de regularização o quanto antes. Caso não seja possível efetuar o pagamento neste momento, pedimos que entre em contato conosco para a avaliação de uma forma de negociação.
Reiteramos que ${RASTREADOR}.
Por fim, estamos à disposição pelos canais de contato informados no seu contrato.
${ASSINATURA}`,
  },
  3: {
    subtitulo: 'Notificação de escalonamento da cobrança',
    assunto: 'Duas parcelas em aberto – Prazo para regularização',
    texto: `Prezado(a) {{nome}},
Verificamos que, além da parcela com vencimento em {{vencimento1}}, outra parcela do veículo {{veiculo}}, placa {{placa}}, venceu em {{vencimento2}} e também permanece em aberto. O valor atualizado do débito total, incluindo os encargos contratuais, é de {{valorAtualizado}}.
Registra-se que, anteriormente, foram realizadas as seguintes comunicações acerca do inadimplemento:
- 1ª notificação: enviada em {{n1Data}}, às {{n1Hora}};
- 2ª notificação: enviada em {{n2Data}}, às {{n2Hora}}.
Diante da permanência do inadimplemento, concedemos o prazo de 48 (quarenta e oito) horas, a contar do envio desta comunicação, para a quitação integral do débito.
Caso a regularização não ocorra nesse prazo, informamos que o veículo poderá ser bloqueado e retomado pela AZIT, nos termos da Cláusula 8.3 do contrato firmado entre as partes.
Por oportuno, reitera-se a vedação expressa de retirada, desativação, violação ou qualquer interferência no funcionamento do rastreador, bloqueador ou demais dispositivos de monitoramento e controle instalados no veículo. A eventual retirada ou interferência nesses dispositivos será interpretada como impedimento ao monitoramento, localização ou retomada do veículo, de forma a ensejar na caracterização do ilícito penal de apropriação indébita, nos termos do art. 168 do Código Penal, sujeitando o responsável às consequências penais aplicáveis.
Para efetuar o pagamento ou tratar sobre a sua situação, entre em contato conosco pelos canais informados no seu contrato.
${ASSINATURA}`,
  },
  4: {
    subtitulo: 'Comunicação de possível bloqueio iminente',
    assunto: 'Aviso importante – Possível bloqueio do veículo',
    texto: `Prezado(a) {{nome}},
O débito referente ao veículo {{veiculo}}, placa {{placa}}, no valor atualizado de {{valorAtualizado}}, permanece em aberto, apesar das comunicações anteriormente realizadas e das oportunidades concedidas para sua regularização.
Até o momento, foram encaminhadas as seguintes notificações acerca do inadimplemento:
- 1ª notificação: enviada em {{n1Data}}, às {{n1Hora}};
- 2ª notificação: enviada em {{n2Data}}, às {{n2Hora}};
- 3ª notificação: enviada em {{n3Data}}, às {{n3Hora}}.
Considerando a permanência do inadimplemento, informamos que o veículo poderá ser bloqueado a qualquer momento, nos termos da Cláusula 8.3 do contrato. Para evitar acidentes ou imprevistos decorrentes de eventual bloqueio, o veículo não deverá ser utilizado até a regularização da situação.
Reiteramos que ${RASTREADOR}.
Por fim, pedimos que a situação seja regularizada imediatamente. Para efetuar o pagamento ou tratar sobre o assunto, entre em contato conosco pelos canais informados no seu contrato.
${ASSINATURA}`,
  },
  5: {
    subtitulo: 'Comunicação da retomada do veículo, sem rescisão automática',
    assunto: 'Retomada do veículo – Contrato nº {{contrato}}',
    texto: `Prezado(a) {{nome}},
Em razão do inadimplemento das obrigações assumidas no Contrato nº {{contrato}}, referente ao veículo {{veiculo}}, placa {{placa}}, e após as tentativas de contato e as notificações anteriores, a NOTIFICANTE procedeu à retomada do veículo em {{dataRetomada}}.
Registra-se que, previamente à adoção da medida, foram realizadas diversas comunicações acerca do inadimplemento:
- 1ª notificação: enviada em {{n1Data}} às {{n1Hora}};
- 2ª notificação: enviada em {{n2Data}} às {{n2Hora}};
- 3ª notificação: enviada em {{n3Data}} às {{n3Hora}};
- 4ª notificação: enviada em {{n4Data}} às {{n4Hora}}.
Apesar das notificações e das oportunidades concedidas para regularização da pendência, o(a) NOTIFICADO(A) permaneceu inadimplente em suas obrigações, ensejando no exercício do direito previsto na Cláusula 8.3 do Contrato.
Contudo, o contrato ainda não está sendo tratado como rescindido. Caso tenha interesse em regularizar a situação, entre em contato conosco: a eventual regularização dependerá de negociação e das condições definidas pela NOTIFICANTE.
Caso a inadimplência não seja regularizada, serão adotadas as providências necessárias para a rescisão do contrato.
Permanecemos à disposição pelos canais de contato informados no seu contrato.
${ASSINATURA}`,
  },
  6: {
    subtitulo: 'Comunicação da rescisão contratual quando o inadimplemento ultrapassa 30 dias',
    assunto: 'Notificação de Rescisão Contratual – Inadimplemento',
    texto: `Prezado(a) {{nome}},
Considerando que em {{dataContrato}} foi firmado Contrato de Promessa de Compra e Venda de Veículo Automotor nº {{contrato}}.
Considerando que V. S.ª encontra-se em atraso há mais de 30 (trinta) dias no pagamento das parcelas pactuadas na Cláusula 3.2 do Contrato, totalizando débito atualizado no valor de {{valorAtualizado}}.
Considerando que tal conduta caracteriza inadimplência nos termos da Cláusula 8 do Contrato, e que, diante do inadimplemento por período superior a 30 (trinta) dias, a NOTIFICANTE poderá considerar antecipadamente vencidas todas as parcelas futuras, exigindo o pagamento integral do saldo devedor.
Considerando que, apesar das reiteradas comunicações e das oportunidades concedidas para a regularização da pendência, o inadimplemento permanece sem regularização e já ultrapassou 30 (trinta) dias, bem como a realização das seguintes notificações acerca do inadimplemento:
- 1ª notificação: enviada em {{n1Data}} às {{n1Hora}};
- 2ª notificação: enviada em {{n2Data}} às {{n2Hora}};
- 3ª notificação: enviada em {{n3Data}} às {{n3Hora}};
- 4ª notificação: enviada em {{n4Data}} às {{n4Hora}};
- 5ª notificação: enviada em {{n5Data}} às {{n5Hora}}.
Fica V. S.ª formalmente notificado(a) da rescisão do Contrato de Promessa de Compra e Venda de Veículo Automotor nº {{contrato}}, celebrado em {{dataContrato}}, referente ao veículo {{veiculo}}, placa {{placa}}.
Além disso, fica V. S.ª formalmente notificado(a) de que a rescisão contratual não afasta a responsabilidade pelo adimplemento das obrigações financeiras já constituídas, permanecendo o(a) NOTIFICADO(A) responsável pelo pagamento dos valores devidos, acrescidos dos encargos contratuais aplicáveis, bem como por eventuais perdas e danos, custas processuais e honorários advocatícios, sem prejuízo da adoção das demais medidas cabíveis para a satisfação do crédito, incluindo a inscrição do nome do(a) NOTIFICADO(A) nos cadastros de proteção ao crédito (SPC/SERASA) e o protesto dos títulos em aberto, nos termos das Cláusulas 8.6, 8.7 e 8.8.
O demonstrativo atualizado dos valores eventualmente pendentes poderá ser obtido junto à AZIT pelos canais oficiais de comunicação do contrato.
Para esclarecimentos acerca da presente notificação e das providências decorrentes da rescisão, entre em contato conosco pelos canais oficiais.
${ASSINATURA}`,
  },
};

// Preenche {{chave}}. Variável sem valor vira "[chave não disponível]" —
// visível na revisão, nunca um buraco silencioso.
export function preencher(modelo: string, vars: Record<string, string>): string {
  return modelo.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? `[${k} não disponível]`);
}
