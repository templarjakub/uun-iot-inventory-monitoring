import { Injectable } from "@nestjs/common";
import { env } from "../../common/config/env";
import { ProductDao } from "../../persistence/dao/product.dao";
import { WeighingPointDao } from "../../persistence/dao/weighing-point.dao";
import { MeasurementDao } from "../../persistence/dao/measurement.dao";
import { Product } from "../../persistence/schemas/product.schema";
import {
  WeighingPoint,
  WeighingPointMeasurementStatus
} from "../../persistence/schemas/weighing-point.schema";
import { checkUnsupportedKeys } from "../../common/utils/uu-app-error";
import {
  ProductOverviewItemDto,
  StockOverviewLoadDtoIn,
  StockOverviewLoadDtoOut
} from "./stock-overview.dto";

export type ProductSummaryMeasurementStatus =
  | "completeAndCurrent"
  | "incomplete"
  | "stale"
  | "unknown";

export type MinimumStockStatus = "belowMinimum" | "ok" | "unverifiable" | "notSet";

@Injectable()
export class StockEvaluationService {
  constructor(
    private readonly productDao: ProductDao,
    private readonly weighingPointDao: WeighingPointDao,
    private readonly measurementDao: MeasurementDao
  ) {}

  isStale(measuredAt: string | null): boolean {
    if (!measuredAt) return true;
    const ageMs = Date.now() - new Date(measuredAt).getTime();
    return ageMs > env.STALE_THRESHOLD_MINUTES * 60 * 1000;
  }

  /**
   * BUC-12: Recalculates stock estimate on a single weighing point.
   */
  async recalculateWeighingPoint(
    point: WeighingPoint,
    product?: Product | null
  ): Promise<WeighingPoint> {
    const resolvedProduct =
      product !== undefined
        ? product
        : point.productId
          ? await this.productDao.get({ productId: point.productId })
          : null;

    if (
      !point.productId ||
      point.tareWeight === null ||
      !resolvedProduct ||
      resolvedProduct.unitWeight === null ||
      resolvedProduct.unitWeight <= 0
    ) {
      const updated = await this.weighingPointDao.update(point.id, {
        measurementStatus:
          point.productId &&
          (point.tareWeight === null || !resolvedProduct?.unitWeight)
            ? "incompleteConfig"
            : "waitingForMeasurement"
      });
      return updated ?? point;
    }

    const latest = await this.measurementDao.getLatestBySourceId(point.sourceId);
    if (!latest) {
      return point;
    }

    const isAfterConfig =
      new Date(latest.measuredAt).getTime() >=
      new Date(point.configurationValidFrom).getTime();

    if (
      isAfterConfig &&
      latest.measurementQuality === "validAndStable" &&
      latest.measuredWeight >= point.tareWeight
    ) {
      const pieces = Math.round(
        (latest.measuredWeight - point.tareWeight) / resolvedProduct.unitWeight
      );
      const status: WeighingPointMeasurementStatus = this.isStale(latest.measuredAt)
        ? "stale"
        : "current";
      const updated = await this.weighingPointDao.update(point.id, {
        lastValidStockEstimate: pieces,
        lastValidMeasuredAt: latest.measuredAt,
        measurementStatus: status
      });
      return updated ?? point;
    }

    // Never replace stock with zero on invalid/unstable reading
    const fallbackStatus: WeighingPointMeasurementStatus =
      point.lastValidStockEstimate !== null ? "stale" : "waitingForMeasurement";
    const updated = await this.weighingPointDao.update(point.id, {
      measurementStatus: fallbackStatus
    });
    return updated ?? point;
  }

  /**
   * BUC-12, BUC-13, BUC-14: Evaluates total product stock, freshness, and minimumStockStatus.
   */
  async evaluateProduct(product: Product): Promise<ProductOverviewItemDto> {
    const { itemList: points } = await this.weighingPointDao.listByProductId(
      product.productId
    );

    const evaluatedPoints: ProductOverviewItemDto["weighingPointList"] = [];
    for (const pt of points) {
      let status = pt.measurementStatus;
      if (status === "current" && this.isStale(pt.lastValidMeasuredAt)) {
        status = "stale";
        await this.weighingPointDao.update(pt.id, { measurementStatus: "stale" });
      }
      evaluatedPoints.push({
        weighingPointId: pt.weighingPointId,
        weighingPointName: pt.weighingPointName,
        stockEstimate: pt.lastValidStockEstimate,
        measurementStatus: status,
        measuredAt: pt.lastValidMeasuredAt
      });
    }

    let measurementStatus: ProductSummaryMeasurementStatus = "unknown";
    let stockEstimate: number | null = null;
    let newestMeasuredAt: string | null = null;

    if (evaluatedPoints.length === 0) {
      measurementStatus = "unknown";
      stockEstimate = null;
    } else {
      const pointsWithEstimate = evaluatedPoints.filter(
        (p) => p.stockEstimate !== null
      );
      if (pointsWithEstimate.length > 0) {
        stockEstimate = pointsWithEstimate.reduce(
          (sum, p) => sum + (p.stockEstimate ?? 0),
          0
        );
        newestMeasuredAt =
          pointsWithEstimate
            .map((p) => p.measuredAt)
            .filter((t): t is string => Boolean(t))
            .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
      }

      const allCurrent = evaluatedPoints.every(
        (p) => p.measurementStatus === "current" && p.stockEstimate !== null
      );
      const anyMissingEstimate = evaluatedPoints.some((p) => p.stockEstimate === null);
      const anyStale = evaluatedPoints.some((p) => p.measurementStatus === "stale");

      if (allCurrent) {
        measurementStatus = "completeAndCurrent";
      } else if (pointsWithEstimate.length === 0) {
        measurementStatus = "unknown";
      } else if (anyMissingEstimate) {
        measurementStatus = "incomplete";
      } else if (anyStale) {
        measurementStatus = "stale";
      } else {
        measurementStatus = "incomplete";
      }
    }

    // BUC-14: Evaluate minimumStockStatus
    let minimumStockStatus: MinimumStockStatus;
    if (product.minimumStock === null || product.minimumStock === undefined) {
      minimumStockStatus = "notSet";
    } else if (measurementStatus !== "completeAndCurrent" || stockEstimate === null) {
      minimumStockStatus = "unverifiable";
    } else if (stockEstimate < product.minimumStock) {
      minimumStockStatus = "belowMinimum";
    } else {
      minimumStockStatus = "ok";
    }

    return {
      productId: product.productId,
      productName: product.productName,
      unitWeight: product.unitWeight,
      stockEstimate,
      minimumStock: product.minimumStock,
      measurementStatus,
      measuredAt: newestMeasuredAt,
      minimumStockStatus,
      weighingPointList: evaluatedPoints
    };
  }

  /**
   * 10. Command: stockOverview/load (BUC-13, BUC-14)
   */
  async loadStockOverview(
    dtoIn: StockOverviewLoadDtoIn,
    rawQuery: unknown
  ): Promise<StockOverviewLoadDtoOut> {
    // Step 1: Standardní validace dtoIn (unsupportedKeys, invalidDtoIn)
    const uuAppErrorMap = checkUnsupportedKeys(
      rawQuery,
      ["productId"],
      "stockOverview/load"
    );

    // Step 2.1, 2.2, 2.3: Načte produkty a vážicí místa, sečte odhady a vyhodnotí minimum
    const { itemList: allProducts } = await this.productDao.list();
    const filteredProducts = dtoIn.productId
      ? allProducts.filter((p) => p.productId === dtoIn.productId)
      : allProducts;

    const productList: ProductOverviewItemDto[] = [];
    for (const product of filteredProducts) {
      const evaluated = await this.evaluateProduct(product);
      productList.push(evaluated);
    }

    // Step 3: Vrátí dtoOut s přehledem produktů a jejich vážicích míst
    return {
      productList,
      uuAppErrorMap
    };
  }
}
