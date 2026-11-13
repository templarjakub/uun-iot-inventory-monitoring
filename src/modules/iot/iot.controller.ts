import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import {
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags
} from "@nestjs/swagger";
import { Request } from "express";
import { Profiles } from "../../common/decorators/profiles.decorator";
import { IotService } from "./iot.service";
import {
  GatewayRegisterDtoIn,
  GatewayRegisterDtoOut,
  IotNodeConnectDtoIn,
  IotNodeConnectDtoOut
} from "./iot.dto";

@ApiTags("3. IoT Infrastructure (BUC-07, BUC-08)")
@ApiHeader({
  name: "x-uu-profile",
  required: false,
  description: "Application Profile: Authorities (default: Authorities)"
})
@Controller()
export class IotController {
  constructor(private readonly iotService: IotService) {}

  @Post("gateway/register")
  @HttpCode(200)
  @Profiles("Authorities")
  @ApiOperation({
    summary:
      "7. gateway/register (BUC-07) – Zaregistruje a ověří komunikační bránu",
    description:
      "Zaregistruje novou komunikační bránu (gatewayId, gatewayName) a ověří její identitu a oprávnění pro přenos měření."
  })
  @ApiOkResponse({ type: GatewayRegisterDtoOut })
  async registerGateway(
    @Body() dtoIn: GatewayRegisterDtoIn,
    @Req() req: Request
  ): Promise<GatewayRegisterDtoOut> {
    return this.iotService.registerGateway(dtoIn, req.body);
  }

  @Post("iotNode/connect")
  @HttpCode(200)
  @Profiles("Authorities")
  @ApiOperation({
    summary:
      "8. iotNode/connect (BUC-08) – Připojí IoT uzel a identifikuje jeho zdroje měření",
    description:
      "Připojí IoT uzel (nodeId, nodeName) k registrované bráně (gatewayId) a jednoznačně zaregistruje jeho zdroje měření (sourceIds)."
  })
  @ApiOkResponse({ type: IotNodeConnectDtoOut })
  async connectNode(
    @Body() dtoIn: IotNodeConnectDtoIn,
    @Req() req: Request
  ): Promise<IotNodeConnectDtoOut> {
    return this.iotService.connectNode(dtoIn, req.body);
  }
}
