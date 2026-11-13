import { Controller, Get, Query, Req } from "@nestjs/common";
import {
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags
} from "@nestjs/swagger";
import { Request } from "express";
import { Profiles } from "../../common/decorators/profiles.decorator";
import { StockEvaluationService } from "./stock-evaluation.service";
import {
  StockOverviewLoadDtoIn,
  StockOverviewLoadDtoOut
} from "./stock-overview.dto";

@ApiTags("5. Stock Overview (BUC-13, BUC-14)")
@ApiHeader({
  name: "x-uu-profile",
  required: false,
  description: "Application Profile: Authorities | Readers (default: Readers)"
})
@Controller("stockOverview")
export class StockOverviewController {
  constructor(
    private readonly stockEvaluationService: StockEvaluationService
  ) {}

  @Get("load")
  @Profiles("Authorities", "Readers")
  @ApiOperation({
    summary:
      "10. stockOverview/load (BUC-13, BUC-14) – Načte přehled zásob, aktuálnost a stav minima",
    description:
      "Vrátí přehled zásob všech evidovaných produktů včetně souhrnného odhadu kusů, rozpisu jednotlivých vážicích míst, stavu aktuálnosti/úplnosti měření a vyhodnocení minimální zásoby."
  })
  @ApiOkResponse({ type: StockOverviewLoadDtoOut })
  async load(
    @Query() dtoIn: StockOverviewLoadDtoIn,
    @Req() req: Request
  ): Promise<StockOverviewLoadDtoOut> {
    return this.stockEvaluationService.loadStockOverview(dtoIn, req.query);
  }
}
