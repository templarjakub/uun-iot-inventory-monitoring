import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsNotEmpty, IsNumber, IsString } from "class-validator";
import { MeasurementQuality } from "../../persistence/schemas/measurement.schema";

/**
 * 9. Command: measurement/ingest (BUC-11, BUC-12, BUC-14)
 */
export class MeasurementIngestDtoIn {
  @ApiProperty({ example: "BR-001" })
  @IsString()
  @IsNotEmpty()
  gatewayId: string;

  @ApiProperty({ example: "M-20261025-0199" })
  @IsString()
  @IsNotEmpty()
  measurementId: string;

  @ApiProperty({ example: "UZ-001/V1" })
  @IsString()
  @IsNotEmpty()
  sourceId: string;

  @ApiProperty({ example: 280.0 })
  @IsNumber()
  measuredWeight: number;

  @ApiProperty({ example: "2026-10-25T10:05:00.000Z" })
  @IsString()
  @IsNotEmpty()
  measuredAt: string;

  @ApiProperty({
    example: "validAndStable",
    enum: ["validAndStable", "unstable", "invalid"]
  })
  @IsString()
  @IsIn(["validAndStable", "unstable", "invalid"])
  measurementQuality: MeasurementQuality;
}

export class MeasurementIngestDtoOut {
  @ApiProperty({ example: "M-20261025-0199" })
  measurementId: string;

  @ApiProperty({ example: "BR-001" })
  gatewayId: string;

  @ApiProperty({ example: "UZ-001/V1" })
  sourceId: string;

  @ApiProperty({ example: "VM-001", nullable: true })
  weighingPointId: string | null;

  @ApiProperty({ example: "2026-10-25T10:05:00.000Z" })
  measuredAt: string;

  @ApiProperty({ example: "2026-10-25T10:05:01.000Z" })
  receivedAt: string;

  @ApiProperty({ example: "verified" })
  authorizationStatus: string;

  @ApiProperty({ example: "acknowledged" })
  deliveryState: string;

  @ApiProperty({ example: 30, nullable: true })
  stockEstimate: number | null;

  @ApiProperty({ example: "current" })
  measurementStatus: string;

  @ApiProperty({ example: {} })
  uuAppErrorMap: Record<string, unknown>;
}
