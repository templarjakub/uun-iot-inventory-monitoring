import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import {
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags
} from "@nestjs/swagger";
import { Request } from "express";
import { Profiles } from "../../common/decorators/profiles.decorator";
import { MeasurementService } from "./measurement.service";
import {
  MeasurementIngestDtoIn,
  MeasurementIngestDtoOut
} from "./measurement.dto";

@ApiTags("4. Measurements & Ingestion (BUC-11, BUC-12)")
@ApiHeader({
  name: "x-uu-profile",
  required: false,
  description: "Application Profile: Gateways (default: Gateways)"
})
@Controller("measurement")
export class MeasurementController {
  constructor(private readonly measurementService: MeasurementService) {}

  @Post("ingest")
  @HttpCode(200)
  @Profiles("Gateways")
  @ApiOperation({
    summary:
      "9. measurement/ingest (BUC-11, BUC-12, BUC-14) – Přijme měření z brány a přepočítá zásobu",
    description:
      "Přijme záznam měření z registrované a ověřené komunikační brány, zajistí idempotenci (measurementId), uloží měření a přepočítá odhad zásoby (BUC-12, BUC-14)."
  })
  @ApiOkResponse({ type: MeasurementIngestDtoOut })
  async ingest(
    @Body() dtoIn: MeasurementIngestDtoIn,
    @Req() req: Request
  ): Promise<MeasurementIngestDtoOut> {
    return this.measurementService.ingest(dtoIn, req.body);
  }
}
