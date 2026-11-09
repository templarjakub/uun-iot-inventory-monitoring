import { Injectable } from "@nestjs/common";
import { WeighingPointDao } from "../../persistence/dao/weighing-point.dao";
import { ProductDao } from "../../persistence/dao/product.dao";
import { IotNodeDao } from "../../persistence/dao/iot-node.dao";
import { MeasurementDao } from "../../persistence/dao/measurement.dao";
import { StockEvaluationService } from "../stock-overview/stock-evaluation.service";
import {
  addWarning,
  checkUnsupportedKeys,
  CommandError
} from "../../common/utils/uu-app-error";
import {
  WeighingPointAssignProductDtoIn,
  WeighingPointAssignProductDtoOut,
  WeighingPointConfirmTareDtoIn,
  WeighingPointConfirmTareDtoOut,
  WeighingPointSaveDtoIn,
  WeighingPointSaveDtoOut
} from "./weighing-point.dto";

@Injectable()
export class WeighingPointService {
  constructor(
    private readonly weighingPointDao: WeighingPointDao,
    private readonly productDao: ProductDao,
    private readonly iotNodeDao: IotNodeDao,
    private readonly measurementDao: MeasurementDao,
    private readonly stockEvaluationService: StockEvaluationService
  ) {}

  /**
   * 3. Command: weighingPoint/save (BUC-03)
   */
  async save(
    dtoIn: WeighingPointSaveDtoIn,
    rawBody: unknown
  ): Promise<WeighingPointSaveDtoOut> {
    // Step 1: Standardní validace dtoIn
    const uuAppErrorMap = checkUnsupportedKeys(
      rawBody,
      ["weighingPointId", "weighingPointName", "sourceId"],
      "weighingPoint/save"
    );

    // Step 2.1: Ověří, že sourceId existuje na evidovaném IoT uzlu -> jinak Error sourceNotFound
    const node = await this.iotNodeDao.get({ sourceId: dtoIn.sourceId });
    if (!node) {
      throw new CommandError(
        "weighingPoint/save",
        "sourceNotFound",
        "Measurement sourceId is not registered on any IoT node.",
        { sourceId: dtoIn.sourceId },
        400
      );
    }

    // Step 2.2: Ověří, že sourceId není přiřazen jinému vážicímu místu -> jinak Error sourceAlreadyAssigned
    const pointWithSource = await this.weighingPointDao.get({
      sourceId: dtoIn.sourceId
    });
    if (
      pointWithSource &&
      pointWithSource.weighingPointId !== dtoIn.weighingPointId
    ) {
      throw new CommandError(
        "weighingPoint/save",
        "sourceAlreadyAssigned",
        "Measurement sourceId is already assigned to another weighing point.",
        {
          sourceId: dtoIn.sourceId,
          existingWeighingPointId: pointWithSource.weighingPointId
        },
        400
      );
    }

    // Step 2.3: Vytvoří nebo upraví vážicí místo; při změně sourceId posune configurationValidFrom = now()
    const now = new Date().toISOString();
    const existing = dtoIn.weighingPointId
      ? await this.weighingPointDao.get({
          weighingPointId: dtoIn.weighingPointId
        })
      : null;

    let saved;
    if (existing) {
      const sourceChanged = existing.sourceId !== dtoIn.sourceId;
      saved = await this.weighingPointDao.update(existing.id, {
        weighingPointName: dtoIn.weighingPointName.trim(),
        sourceId: dtoIn.sourceId.trim(),
        configurationValidFrom: sourceChanged
          ? now
          : existing.configurationValidFrom,
        lastValidStockEstimate: sourceChanged
          ? null
          : existing.lastValidStockEstimate,
        measurementStatus: sourceChanged
          ? "waitingForMeasurement"
          : existing.measurementStatus
      });
    } else {
      saved = await this.weighingPointDao.create({
        weighingPointId: dtoIn.weighingPointId,
        weighingPointName: dtoIn.weighingPointName.trim(),
        sourceId: dtoIn.sourceId.trim(),
        configurationValidFrom: now
      });
    }

    const result = saved!;
    return {
      id: result.id,
      weighingPointId: result.weighingPointId,
      weighingPointName: result.weighingPointName,
      sourceId: result.sourceId,
      productId: result.productId,
      tareWeight: result.tareWeight,
      configurationValidFrom: result.configurationValidFrom,
      measurementStatus: result.measurementStatus,
      uuAppErrorMap
    };
  }

  /**
   * 4. Command: weighingPoint/assignProduct (BUC-04, BUC-12, BUC-14)
   */
  async assignProduct(
    dtoIn: WeighingPointAssignProductDtoIn,
    rawBody: unknown
  ): Promise<WeighingPointAssignProductDtoOut> {
    // Step 1: Standardní validace dtoIn
    const uuAppErrorMap = checkUnsupportedKeys(
      rawBody,
      ["weighingPointId", "productId"],
      "weighingPoint/assignProduct"
    );

    // Step 2.1: Ověří existenci vážicího místa a produktu -> jinak Error weighingPointNotFound / productNotFound
    const point = await this.weighingPointDao.get({
      weighingPointId: dtoIn.weighingPointId
    });
    if (!point) {
      throw new CommandError(
        "weighingPoint/assignProduct",
        "weighingPointNotFound",
        "Weighing point does not exist.",
        { weighingPointId: dtoIn.weighingPointId },
        404
      );
    }

    const product = await this.productDao.get({ productId: dtoIn.productId });
    if (!product) {
      throw new CommandError(
        "weighingPoint/assignProduct",
        "productNotFound",
        "Product does not exist.",
        { productId: dtoIn.productId },
        404
      );
    }

    // Step 2.2: Uloží productId, nastaví configurationValidFrom = now(), vynuluje lastValidStockEstimate a nastaví measurementStatus = "waitingForMeasurement"
    const now = new Date().toISOString();
    const updated = await this.weighingPointDao.update(point.id, {
      productId: product.productId,
      configurationValidFrom: now,
      lastValidStockEstimate: null,
      measurementStatus: "waitingForMeasurement"
    });

    // Step 2.3: Pokud chybí ověřená tareWeight nebo unitWeight, přidá Warning incompleteCalibrationOrTare
    const finalPoint = updated ?? point;
    if (finalPoint.tareWeight === null || product.unitWeight === null) {
      addWarning(
        uuAppErrorMap,
        "weighingPoint/assignProduct",
        "incompleteCalibrationOrTare",
        "Tare weight or product unitWeight is not verified yet.",
        {
          tareWeight: finalPoint.tareWeight,
          unitWeight: product.unitWeight
        }
      );
    }

    return {
      weighingPointId: finalPoint.weighingPointId,
      weighingPointName: finalPoint.weighingPointName,
      productId: product.productId,
      tareWeight: finalPoint.tareWeight,
      unitWeight: product.unitWeight,
      configurationValidFrom: finalPoint.configurationValidFrom,
      measurementStatus: finalPoint.measurementStatus,
      uuAppErrorMap
    };
  }

  /**
   * 5. Command: weighingPoint/confirmTare (BUC-05)
   */
  async confirmTare(
    dtoIn: WeighingPointConfirmTareDtoIn,
    rawBody: unknown
  ): Promise<WeighingPointConfirmTareDtoOut> {
    // Step 1: Standardní validace dtoIn
    const uuAppErrorMap = checkUnsupportedKeys(
      rawBody,
      ["weighingPointId", "measurementId"],
      "weighingPoint/confirmTare"
    );

    // Step 2.1: Ověří existenci vážicího místa -> jinak Error weighingPointNotFound
    const point = await this.weighingPointDao.get({
      weighingPointId: dtoIn.weighingPointId
    });
    if (!point) {
      throw new CommandError(
        "weighingPoint/confirmTare",
        "weighingPointNotFound",
        "Weighing point does not exist.",
        { weighingPointId: dtoIn.weighingPointId },
        404
      );
    }

    // Step 2.2: Načte poslední měření zdroje a ověří, že je aktuální, platné a stabilní (validAndStable) a má nezápornou hmotnost
    const measurement = dtoIn.measurementId
      ? await this.measurementDao.getByMeasurementId(dtoIn.measurementId)
      : await this.measurementDao.getLatestBySourceId(point.sourceId);

    if (
      !measurement ||
      measurement.sourceId !== point.sourceId ||
      this.stockEvaluationService.isStale(measurement.measuredAt) ||
      measurement.measurementQuality !== "validAndStable" ||
      measurement.measuredWeight < 0
    ) {
      throw new CommandError(
        "weighingPoint/confirmTare",
        "unusableTareMeasurement",
        "Measurement is missing, stale, invalid, unstable, or negative.",
        {
          measurementQuality: measurement?.measurementQuality ?? "missing",
          measuredWeight: measurement?.measuredWeight ?? 0
        },
        400
      );
    }

    // Step 2.3: Uloží tareWeight = measuredWeight a aktualizuje configurationValidFrom = measuredAt
    await this.weighingPointDao.update(point.id, {
      tareWeight: measurement.measuredWeight,
      configurationValidFrom: measurement.measuredAt,
      lastValidStockEstimate: null,
      measurementStatus: "waitingForMeasurement"
    });

    return {
      weighingPointId: point.weighingPointId,
      weighingPointName: point.weighingPointName,
      measuredWeight: measurement.measuredWeight,
      measuredAt: measurement.measuredAt,
      measurementQuality: measurement.measurementQuality,
      tareWeight: measurement.measuredWeight,
      configurationValidFrom: measurement.measuredAt,
      uuAppErrorMap
    };
  }
}
