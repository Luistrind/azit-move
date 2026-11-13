import { DURACAO_BLOQUEIO_SENHA_MS, FALHAS_PARA_BLOQUEIO_SENHA } from '@azit/utils';

// Bloqueio temporário por usuário na entrada por SENHA (doc 06 §2.5, §11.3):
// 10 falhas seguidas → 15 minutos, sem revelar nada na resposta. A entrada
// pelo Google não passa por aqui (o Google já protege a conta).
//
// Contador em MEMÓRIA do processo: o backend roda com uma réplica no Swarm e o
// limite é proteção contra força bruta, não estado de negócio — reiniciar o
// serviço zera as contagens, o que é aceitável. Se o backend ganhar réplicas,
// trocar por Redis (já existe no ambiente) mantendo esta mesma interface.
// `agora` é injetável para os testes andarem o relógio sem esperar 15 min.
export class ControleBloqueioSenha {
  private readonly falhas = new Map<string, { seguidas: number; bloqueadoAte: number | null }>();

  constructor(
    private readonly agora: () => number = () => Date.now(),
    private readonly limite = FALHAS_PARA_BLOQUEIO_SENHA,
    private readonly duracaoMs = DURACAO_BLOQUEIO_SENHA_MS,
  ) {}

  // Está bloqueado neste instante? (bloqueio vencido é esquecido na consulta)
  bloqueado(chave: string): boolean {
    const r = this.falhas.get(chave);
    if (!r?.bloqueadoAte) return false;
    if (r.bloqueadoAte > this.agora()) return true;
    this.falhas.delete(chave);
    return false;
  }

  // Registra uma falha; devolve true se ESTA falha disparou o bloqueio.
  registrarFalha(chave: string): boolean {
    const r = this.falhas.get(chave) ?? { seguidas: 0, bloqueadoAte: null };
    r.seguidas += 1;
    if (r.seguidas >= this.limite) {
      r.bloqueadoAte = this.agora() + this.duracaoMs;
      r.seguidas = 0;
      this.falhas.set(chave, r);
      return true;
    }
    this.falhas.set(chave, r);
    return false;
  }

  // Sucesso zera a contagem (as falhas precisam ser SEGUIDAS).
  limpar(chave: string) {
    this.falhas.delete(chave);
  }
}
