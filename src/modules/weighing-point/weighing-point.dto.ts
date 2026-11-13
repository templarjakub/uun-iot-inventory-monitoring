import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength
} from "class-validator";

/**
 * 3. Command: weighingPoint/save (BUC-03)
 */
export class WeighingPointSaveDtoIn {
  @ApiPropertyOptional({
    example: "VM-001",
    description: "Optional when creating a new weighing point"
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  weighingPointId?: string;

  @ApiProperty({ example: "Regál A, pozice 1" })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(200)
  weighingPointName: string;

  @ApiProperty({ example: "UZ-001/V1" })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  sourceId: string;
}

export class WeighingPointSaveDtoOut {
  @ApiProperty({ example: "671b5f001c2d3e4f5a6b7c8e" })
  id: string;

  @ApiProperty({ example: "VM-001" })
  weighingPointId: string;

  @ApiProperty({ example: "Regál A, pozice 1" })
  weighingPointName: string;

  @ApiProperty({ example: "UZ-001/V1" })
  sourceId: string;

  @ApiProperty({ example: null, nullable: true })
  productId: string | null;

  @ApiProperty({ example: null, nullable: true })
  tareWeight: number | null;

  @ApiProperty({ example: "2026-10-25T09:50:00.000Z" })
  configurationValidFrom: string;

  @ApiProperty({ example: "waitingForMeasurement" })
  measurementStatus: string;

  @ApiProperty({ example: {} })
  uuAppErrorMap: Record<string, unknown>;
}

/**
 * 4. Command: weighingPoint/assignProduct (BUC-04, BUC-12, BUC-14)
 */
export class WeighingPointAssignProductDtoIn {
  @ApiProperty({ example: "VM-001" })
  @IsString()
  @IsNotEmpty()
  weighingPointId: string;

  @ApiProperty({ example: "PRD-001" })
  @IsString()
  @IsNotEmpty()
  productId: string;
}

export class WeighingPointAssignProductDtoOut {
  @ApiProperty({ example: "VM-001" })
  weighingPointId: string;

  @ApiProperty({ example: "Regál A, pozice 1" })
  weighingPointName: string;

  @ApiProperty({ example: "PRD-001" })
  productId: string;

  @ApiProperty({ example: 100.0, nullable: true })
  tareWeight: number | null;

  @ApiProperty({ example: 6.0, nullable: true })
  unitWeight: number | null;

  @ApiProperty({ example: "2026-10-25T09:55:00.000Z" })
  configurationValidFrom: string;

  @ApiProperty({ example: "waitingForMeasurement" })
  measurementStatus: string;

  @ApiProperty({ example: {} })
  uuAppErrorMap: Record<string, unknown>;
}

/**
 * 5. Command: weighingPoint/confirmTare (BUC-05)
 */
export class WeighingPointConfirmTareDtoIn {
  @ApiProperty({ example: "VM-001" })
  @IsString()
  @IsNotEmpty()
  weighingPointId: string;

  @ApiPropertyOptional({
    example: "M-20261025-0101",
    description:
      "Optional; if omitted, uses the latest measurement on the point's sourceId"
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  measurementId?: string;
}

export class WeighingPointConfirmTareDtoOut {
  @ApiProperty({ example: "VM-001" })
  weighingPointId: string;

  @ApiProperty({ example: "Regál A, pozice 1" })
  weighingPointName: string;

  @ApiProperty({ example: 100.0 })
  measuredWeight: number;

  @ApiProperty({ example: "2026-10-25T10:00:00.000Z" })
  measuredAt: string;

  @ApiProperty({ example: "validAndStable" })
  measurementQuality: string;

  @ApiProperty({ example: 100.0 })
  tareWeight: number;

  @ApiProperty({ example: "2026-10-25T10:00:00.000Z" })
  configurationValidFrom: string;

  @ApiProperty({ example: {} })
  uuAppErrorMap: Record<string, unknown>;
}
