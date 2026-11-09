import { Injectable } from "@nestjs/common";
import { ProductDao } from "../../persistence/dao/product.dao";
import { WeighingPointDao } from "../../persistence/dao/weighing-point.dao";
import { MeasurementDao } from "../../persistence/dao/measurement.dao";
import { StockEvaluationService } from "../stock-overview/stock-evaluation.service";
import {
  checkUnsupportedKeys,
  CommandError
} from "../../common/utils/uu-app-error";
import {
  ProductCalibrateUnitWeightDtoIn,
  ProductCalibrateUnitWeightDtoOut,
  ProductCreateDtoIn,
  ProductCreateDtoOut,
  ProductUpdateDtoIn,
  ProductUpdateDtoOut
} from "./product.dto";

@Injectable()
export class ProductService {
  constructor(
    private readonly productDao: ProductDao,
    private readonly weighingPointDao: WeighingPointDao,
    private readonly measurementDao: MeasurementDao,
    private readonly stockEvaluationService: StockEvaluationService
  ) {}

  /**
   * 1. Command: product/create (BUC-01)
   */
  async create(
    dtoIn: ProductCreateDtoIn,
    rawBody: unknown
  ): Promise<ProductCreateDtoOut> {
    // Step 1: Standardní validace dtoIn (unsupportedKeys, povinný productName -> invalidDtoIn)
    const uuAppErrorMap = checkUnsupportedKeys(
      rawBody,
      ["productName"],
      "product/create"
    );

    // Step 2.1 & 2.2: Vygeneruje unikátní productId (PRD-xxx), inicializuje unitWeight = null, minimumStock = null a uloží
    let created;
    try {
      created = await this.productDao.create({
        productName: dtoIn.productName.trim()
      });
    } catch (cause) {
      throw new CommandError(
        "product/create",
        "productDaoCreateFailed",
        "Creating product in database failed.",
        { cause: String(cause) },
        500
      );
    }

    // Step 3: Vrátí dtoOut s vytvořeným produktem
    return {
      id: created.id,
      awid: created.awid,
      productId: created.productId,
      productName: created.productName,
      unitWeight: created.unitWeight,
      minimumStock: created.minimumStock,
      uuAppErrorMap
    };
  }

  /**
   * 2. Command: product/update (BUC-02, BUC-14)
   */
  async update(
    dtoIn: ProductUpdateDtoIn,
    rawBody: unknown
  ): Promise<ProductUpdateDtoOut> {
    // Step 1: Standardní validace dtoIn
    const uuAppErrorMap = checkUnsupportedKeys(
      rawBody,
      ["productId", "productName", "minimumStock"],
      "product/update"
    );

    // Step 2.1: Načte produkt podle productId -> jinak Error productNotFound
    const existing = await this.productDao.get({ productId: dtoIn.productId });
    if (!existing) {
      throw new CommandError(
        "product/update",
        "productNotFound",
        "Product with given productId does not exist.",
        { productId: dtoIn.productId },
        404
      );
    }

    // Step 2.2: Uloží nový productName a minimumStock; unitWeight a přiřazení míst zůstanou zachovány
    const updated = await this.productDao.update(existing.id, {
      productName: dtoIn.productName.trim(),
      minimumStock:
        dtoIn.minimumStock !== undefined ? dtoIn.minimumStock : existing.minimumStock
    });

    // Step 2.3: Přehodnotí stav minima (BUC-14)
    const evaluated = await this.stockEvaluationService.evaluateProduct(
      updated ?? existing
    );

    // Step 3: Vrátí dtoOut s uloženými údaji a výsledkem vyhodnocení
    return {
      id: (updated ?? existing).id,
      productId: evaluated.productId,
      productName: evaluated.productName,
      unitWeight: evaluated.unitWeight,
      minimumStock: evaluated.minimumStock,
      stockEstimate: evaluated.stockEstimate,
      measurementStatus: evaluated.measurementStatus,
      minimumStockStatus: evaluated.minimumStockStatus,
      uuAppErrorMap
    };
  }

  /**
   * 6. Command: product/calibrateUnitWeight (BUC-06, BUC-12, BUC-14)
   */
  async calibrateUnitWeight(
    dtoIn: ProductCalibrateUnitWeightDtoIn,
    rawBody: unknown
  ): Promise<ProductCalibrateUnitWeightDtoOut> {
    // Step 1: Standardní validace dtoIn
    const uuAppErrorMap = checkUnsupportedKeys(
      rawBody,
      ["weighingPointId", "sampleCount"],
      "product/calibrateUnitWeight"
    );

    // Step 2.1: Ověří, že vážicí místo má přiřazený productId a ověřenou tareWeight -> jinak Error weighingPointNotReadyForCalibration
    const point = await this.weighingPointDao.get({
      weighingPointId: dtoIn.weighingPointId
    });
    if (!point || !point.productId || point.tareWeight === null) {
      throw new CommandError(
        "product/calibrateUnitWeight",
        "weighingPointNotReadyForCalibration",
        "Weighing point does not have an assigned product or verified tareWeight.",
        { weighingPointId: dtoIn.weighingPointId },
        400
      );
    }

    const product = await this.productDao.get({ productId: point.productId });
    if (!product) {
      throw new CommandError(
        "product/calibrateUnitWeight",
        "weighingPointNotReadyForCalibration",
        "Weighing point does not have an assigned product or verified tareWeight.",
        { weighingPointId: dtoIn.weighingPointId },
        400
      );
    }

    // Step 2.2: Ověří poslední měření (validAndStable, measuredAt >= configurationValidFrom) a kladnou čistou hmotnost
    const latest = await this.measurementDao.getLatestBySourceId(point.sourceId);
    const isAfterConfig =
      latest &&
      new Date(latest.measuredAt).getTime() >=
        new Date(point.configurationValidFrom).getTime();

    if (
      !latest ||
      !isAfterConfig ||
      this.stockEvaluationService.isStale(latest.measuredAt) ||
      latest.measurementQuality !== "validAndStable" ||
      latest.measuredWeight - point.tareWeight <= 0
    ) {
      throw new CommandError(
        "product/calibrateUnitWeight",
        "invalidCalibrationMeasurement",
        "Measurement is missing, stale, unstable, or net weight is not positive.",
        {
          measuredWeight: latest?.measuredWeight ?? 0,
          tareWeight: point.tareWeight
        },
        400
      );
    }

    // Step 2.3: Vypočítá a uloží k produktu unitWeight = (measuredWeight - tareWeight) / sampleCount
    const unitWeight =
      Math.round(
        ((latest.measuredWeight - point.tareWeight) / dtoIn.sampleCount) * 1000
      ) / 1000;

    const updatedProduct = await this.productDao.update(product.id, { unitWeight });

    // Step 2.4: Přepočítá odhady a stav minima všech vážicích míst tohoto produktu (BUC-12, BUC-14)
    const { itemList: productPoints } =
      await this.weighingPointDao.listByProductId(product.productId);
    for (const pt of productPoints) {
      await this.stockEvaluationService.recalculateWeighingPoint(
        pt,
        updatedProduct ?? product
      );
    }

    // Step 3: Vrátí dtoOut s vypočtenou hmotností kusu
    return {
      productId: product.productId,
      productName: product.productName,
      weighingPointId: point.weighingPointId,
      weighingPointName: point.weighingPointName,
      sampleCount: dtoIn.sampleCount,
      measuredWeight: latest.measuredWeight,
      tareWeight: point.tareWeight,
      measuredAt: latest.measuredAt,
      measurementQuality: latest.measurementQuality,
      unitWeight,
      uuAppErrorMap
    };
  }
}
