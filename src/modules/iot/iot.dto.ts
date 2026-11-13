import { ApiProperty } from "@nestjs/swagger";
import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength
} from "class-validator";

/**
 * 7. Command: gateway/register (BUC-07)
 */
export class GatewayRegisterDtoIn {
  @ApiProperty({ example: "BR-002" })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  gatewayId: string;

  @ApiProperty({ example: "Brána skladu dílny 2" })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(200)
  gatewayName: string;
}

export class GatewayRegisterDtoOut {
  @ApiProperty({ example: "671b60101c2d3e4f5a6b7c90" })
  id: string;

  @ApiProperty({ example: "BR-002" })
  gatewayId: string;

  @ApiProperty({ example: "Brána skladu dílny 2" })
  gatewayName: string;

  @ApiProperty({ example: "verified" })
  authorizationStatus: string;

  @ApiProperty({ example: [] })
  nodeIds: string[];

  @ApiProperty({ example: {} })
  uuAppErrorMap: Record<string, unknown>;
}

/**
 * 8. Command: iotNode/connect (BUC-08)
 */
export class IotNodeConnectDtoIn {
  @ApiProperty({ example: "UZ-002" })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  nodeId: string;

  @ApiProperty({ example: "Vážicí uzel regálu B" })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(200)
  nodeName: string;

  @ApiProperty({ example: "BR-001" })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  gatewayId: string;

  @ApiProperty({ example: ["UZ-002/V1", "UZ-002/V2"] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  sourceIds: string[];
}

export class IotNodeConnectDtoOut {
  @ApiProperty({ example: "671b60501c2d3e4f5a6b7c91" })
  id: string;

  @ApiProperty({ example: "UZ-002" })
  nodeId: string;

  @ApiProperty({ example: "Vážicí uzel regálu B" })
  nodeName: string;

  @ApiProperty({ example: "BR-001" })
  gatewayId: string;

  @ApiProperty({ example: ["UZ-002/V1", "UZ-002/V2"] })
  sourceIds: string[];

  @ApiProperty({ example: "testReceived" })
  measurementStatus: string;

  @ApiProperty({ example: {} })
  uuAppErrorMap: Record<string, unknown>;
}
