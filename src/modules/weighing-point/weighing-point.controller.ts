import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import {
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags
} from "@nestjs/swagger";
import { Request } from "express";
import { Profiles } from "../../common/decorators/profiles.decorator";
import { WeighingPointService } from "./weighing-point.service";
import {
  WeighingPointAssignProductDtoIn,
  WeighingPointAssignProductDtoOut,
  WeighingPointConfirmTareDtoIn,
  WeighingPointConfirmTareDtoOut,
  WeighingPointSaveDtoIn,
  WeighingPointSaveDtoOut
} from "./weighing-point.dto";

@ApiTags("2. Weighing Points (BUC-03, BUC-04, BUC-05)")
@ApiHeader({
  name: "x-uu-profile",
  required: false,
  description: "Application Profile: Authorities (default: Authorities)"
})
@Controller("weighingPoint")
export class WeighingPointController {
  constructor(private readonly weighingPointService: WeighingPointService) {}

  @Post("save")
  @HttpCode(200)
  @Profiles("Authorities")
  @ApiOperation({
    summary: "3. weighingPoint/save (BUC-03) – Založí nebo upraví vážicí místo",
    description:
      "Založí nové nebo upraví existující pevné vážicí místo a naváže na něj jednoznačný zdroj měření sourceId."
  })
  @ApiOkResponse({ type: WeighingPointSaveDtoOut })
  async save(
    @Body() dtoIn: WeighingPointSaveDtoIn,
    @Req() req: Request
  ): Promise<WeighingPointSaveDtoOut> {
    return this.weighingPointService.save(dtoIn, req.body);
  }

  @Post("assignProduct")
  @HttpCode(200)
  @Profiles("Authorities")
  @ApiOperation({
    summary:
      "4. weighingPoint/assignProduct (BUC-04) – Přiřadí nebo změní produkt na vážicím místě",
    description:
      "Přiřadí nebo změní produkt (productId) na vážicím místě (weighingPointId) a oddělí stará měření od nového obsahu."
  })
  @ApiOkResponse({ type: WeighingPointAssignProductDtoOut })
  async assignProduct(
    @Body() dtoIn: WeighingPointAssignProductDtoIn,
    @Req() req: Request
  ): Promise<WeighingPointAssignProductDtoOut> {
    return this.weighingPointService.assignProduct(dtoIn, req.body);
  }

  @Post("confirmTare")
  @HttpCode(200)
  @Profiles("Authorities")
  @ApiOperation({
    summary:
      "5. weighingPoint/confirmTare (BUC-05) – Potvrdí táru prázdné krabičky",
    description:
      "Ověří a uloží nezápornou táru aktuální prázdné krabičky na vážicím místě z platného, stabilního a aktuálního měření."
  })
  @ApiOkResponse({ type: WeighingPointConfirmTareDtoOut })
  async confirmTare(
    @Body() dtoIn: WeighingPointConfirmTareDtoIn,
    @Req() req: Request
  ): Promise<WeighingPointConfirmTareDtoOut> {
    return this.weighingPointService.confirmTare(dtoIn, req.body);
  }
}
