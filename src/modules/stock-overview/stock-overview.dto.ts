import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";

export class StockOverviewLoadDtoIn {
  @ApiPropertyOptional({
    example: "PRD-001",
    description: "Optional productId filter to inspect a single product"
  })
  @IsOptional()
  @IsString()
  productId?: string;
}

export class WeighingPointOverviewItemDto {
  @ApiProperty({ example: "VM-001" })
  weighingPointId: string;

  @ApiProperty({ example: "Regál A, pozice 1" })
  weighingPointName: string;

  @ApiProperty({ example: 30, nullable: true })
  stockEstimate: number | null;

  @ApiProperty({ example: "current" })
  measurementStatus: string;

  @ApiProperty({ example: "2026-10-25T10:00:00.000Z", nullable: true })
  measuredAt: string | null;
}

export class ProductOverviewItemDto {
  @ApiProperty({ example: "PRD-001" })
  productId: string;

  @ApiProperty({ example: "Šroub M6 × 20 mm" })
  productName: string;

  @ApiProperty({ example: 6.0, nullable: true })
  unitWeight: number | null;

  @ApiProperty({ example: 40, nullable: true })
  stockEstimate: number | null;

  @ApiProperty({ example: 50, nullable: true })
  minimumStock: number | null;

  @ApiProperty({
    example: "completeAndCurrent",
    enum: ["completeAndCurrent", "incomplete", "stale", "unknown"]
  })
  measurementStatus: string;

  @ApiProperty({ example: "2026-10-25T10:00:00.000Z", nullable: true })
  measuredAt: string | null;

  @ApiProperty({
    example: "belowMinimum",
    enum: ["belowMinimum", "ok", "unverifiable", "notSet"]
  })
  minimumStockStatus: string;

  @ApiProperty({ type: [WeighingPointOverviewItemDto] })
  weighingPointList: WeighingPointOverviewItemDto[];
}

export class StockOverviewLoadDtoOut {
  @ApiProperty({ type: [ProductOverviewItemDto] })
  productList: ProductOverviewItemDto[];

  @ApiProperty({ example: {} })
  uuAppErrorMap: Record<string, unknown>;
}
