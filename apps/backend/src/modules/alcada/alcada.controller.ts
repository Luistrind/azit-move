import { Controller, Get } from '@nestjs/common';
import { AlcadaService } from './alcada.service';

@Controller('alcadas')
export class AlcadaController {
  constructor(private readonly alcada: AlcadaService) {}

  // Transparência da configuração de alçadas (valores são placeholder/seed).
  @Get()
  listar() {
    return this.alcada.listar();
  }
}
