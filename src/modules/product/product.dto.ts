import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength
} from "class-validator";

/**
 * 1. Command: product/create (BUC-01)
 */
export class ProductCreateDtoIn {
  @ApiProperty({
    example: "Šroub M6 × 20 mm",
    description: "Required readable name of the material"
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(200)
  productName: string;
}

export class ProductCreateDtoOut {
  @ApiProperty({ example: "671b5e9a1c2d3e4f5a6b7c8d" })
  id: string;

  @ApiProperty({ example: "0123456789abcdef0123456789abcdef" })
  awid: string;

  @ApiProperty({ example: "PRD-001" })
  productId: string;

  @ApiProperty({ example: "Šroub M6 × 20 mm" })
  productName: string;

  @ApiProperty({ example: null, nullable: true })
  unitWeight: number | null;

  @ApiProperty({ example: null, nullable: true })
  minimumStock: number | null;

  @ApiProperty({ example: {} })
  uuAppErrorMap: Record<string, unknown>;
}

/**
 * 2. Command: product/update (BUC-02, BUC-14)
 */
export class ProductUpdateDtoIn {
  @ApiProperty({ example: "PRD-001" })
  @IsString()
  @IsNotEmpty()
  productId: string;

  @ApiProperty({ example: "Šroub M6 × 20 mm" })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(200)
  productName: string;

  @ApiPropertyOptional({
    example: 50,
    nullable: true,
    description: "Non-negative integer minimum stock in pieces for the whole product"
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  minimumStock?: number | null;
}

export class ProductUpdateDtoOut {
  @ApiProperty({ example: "671b5e9a1c2d3e4f5a6b7c8d" })
  id: string;

  @ApiProperty({ example: "PRD-001" })
  productId: string;

  @ApiProperty({ example: "Šroub M6 × 20 mm" })
  productName: string;

  @ApiProperty({ example: 6.0, nullable: true })
  unitWeight: number | null;

  @ApiProperty({ example: 50, nullable: true })
  minimumStock: number | null;

  @ApiProperty({ example: 40, nullable: true })
  stockEstimate: number | null;

  @ApiProperty({ example: "completeAndCurrent" })
  measurementStatus: string;

  @ApiProperty({ example: "belowMinimum" })
  minimumStockStatus: string;

  @ApiProperty({ example: {} })
  uuAppErrorMap: Record<string, unknown>;
}

/**
 * 6. Command: product/calibrateUnitWeight (BUC-06, BUC-12, BUC-14)
 */
export class ProductCalibrateUnitWeightDtoIn {
  @ApiProperty({ example: "VM-001" })
  @IsString()
  @IsNotEmpty()
  weighingPointId: string;

  @ApiProperty({
    example: 10,
    description: "Known positive integer count of pieces in the calibration sample"
  })
  @IsInt()
  @Min(1)
  sampleCount: number;
}

export class ProductCalibrateUnitWeightDtoOut {
  @ApiProperty({ example: "PRD-001" })
  productId: string;

  @ApiProperty({ example: "Šroub M6 × 20 mm" })
  productName: string;

  @ApiProperty({ example: "VM-001" })
  weighingPointId: string;

  @ApiProperty({ example: "Regál A, pozice 1" })
  weighingPointName: string;

  @ApiProperty({ example: 10 })
  sampleCount: number;

  @ApiProperty({ example: 160.0 })
  measuredWeight: number;

  @ApiProperty({ example: 100.0 })
  tareWeight: number;

  @ApiProperty({ example: "2026-10-25T10:00:00.000Z" })
  measuredAt: string;

  @ApiProperty({ example: "validAndStable" })
  measurementQuality: string;

  @ApiProperty({ example: 6.0 })
  unitWeight: number;

  @ApiProperty({ example: {} })
  uuAppErrorMap: Record<string, unknown>;
}
