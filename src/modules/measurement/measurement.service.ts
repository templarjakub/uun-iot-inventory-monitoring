import { Injectable } from "@nestjs/common";
import { IotGatewayDao } from "../../persistence/dao/iot-gateway.dao";
import { IotNodeDao } from "../../persistence/dao/iot-node.dao";
import { WeighingPointDao } from "../../persistence/dao/weighing-point.dao";
import { MeasurementDao } from "../../persistence/dao/measurement.dao";
import { StockEvaluationService } from "../stock-overview/stock-evaluation.service";
import {
  checkUnsupportedKeys,
  CommandError
} from "../../common/utils/uu-app-error";
import {
  MeasurementIngestDtoIn,
  MeasurementIngestDtoOut
} from "./measurement.dto";

@Injectable()
export class MeasurementService {
  constructor(
    private readonly iotGatewayDao: IotGatewayDao,
    private readonly iotNodeDao: IotNodeDao,
    private readonly weighingPointDao: WeighingPointDao,
    private readonly measurementDao: MeasurementDao,
    private readonly stockEvaluationService: StockEvaluationService
  ) {}

  /**
   * 9. Command: measurement/ingest (BUC-11, BUC-12, BUC-14)
   */
  async ingest(
    dtoIn: MeasurementIngestDtoIn,
    rawBody: unknown
  ): Promise<MeasurementIngestDtoOut> {
    // Step 1: Standardní validace dtoIn
    const uuAppErrorMap = checkUnsupportedKeys(
      rawBody,
      [
        "gatewayId",
        "measurementId",
        "sourceId",
        "measuredWeight",
        "measuredAt",
        "measurementQuality"
      ],
      "measurement/ingest"
    );

    // Step 2.1: Ověří identitu gatewayId a oprávnění ke zdroji sourceId -> jinak Error unauthorizedGatewayOrSource
    const gateway = await this.iotGatewayDao.get({
      gatewayId: dtoIn.gatewayId
    });
    const node = await this.iotNodeDao.get({ sourceId: dtoIn.sourceId });

    if (
      !gateway ||
      gateway.authorizationStatus !== "verified" ||
      !node ||
      node.gatewayId !== gateway.gatewayId
    ) {
      throw new CommandError(
        "measurement/ingest",
        "unauthorizedGatewayOrSource",
        "Gateway is not verified or is not authorized for the given sourceId.",
        {
          gatewayId: dtoIn.gatewayId,
          sourceId: dtoIn.sourceId
        },
        403
      );
    }

    const point = await this.weighingPointDao.get({
      sourceId: dtoIn.sourceId
    });

    // Step 2.2: Zkontroluje duplicitu measurementId (idempotence při výpadku) -> pokud již existuje, vrátí acknowledged bez přepočtu
    const existingMeasurement = await this.measurementDao.getByMeasurementId(
      dtoIn.measurementId
    );
    if (existingMeasurement) {
      return {
        measurementId: existingMeasurement.measurementId,
        gatewayId: existingMeasurement.gatewayId,
        sourceId: existingMeasurement.sourceId,
        weighingPointId:
          point?.weighingPointId ?? existingMeasurement.weighingPointId,
        measuredAt: existingMeasurement.measuredAt,
        receivedAt: existingMeasurement.receivedAt,
        authorizationStatus: "verified",
        deliveryState: "acknowledged",
        stockEstimate: point?.lastValidStockEstimate ?? null,
        measurementStatus:
          point?.measurementStatus ?? "waitingForMeasurement",
        uuAppErrorMap
      };
    }

    // Step 2.3: Uloží záznam s původním measuredAt a časem přijetí receivedAt
    const receivedAt = new Date().toISOString();
    await this.measurementDao.create({
      measurementId: dtoIn.measurementId,
      weighingPointId: point?.weighingPointId ?? null,
      sourceId: dtoIn.sourceId,
      gatewayId: dtoIn.gatewayId,
      measuredWeight: dtoIn.measuredWeight,
      measuredAt: dtoIn.measuredAt,
      receivedAt,
      measurementQuality: dtoIn.measurementQuality
    });

    await this.iotGatewayDao.update(gateway.id, {
      deliveryState: "deliveredAndRetained"
    });
    if (node.measurementStatus === "unverified") {
      await this.iotNodeDao.update(node.id, {
        measurementStatus: "testReceived"
      });
    }

    // Step 2.4: Přepočítá odhad místa pouze pro platné, stabilní a novější měření (BUC-12)
    let evaluatedPoint = point;
    if (point) {
      evaluatedPoint =
        await this.stockEvaluationService.recalculateWeighingPoint(point);
    }

    // Step 3: Vrátí dtoOut potvrzující doručení pro retenční frontu gatewaye
    return {
      measurementId: dtoIn.measurementId,
      gatewayId: dtoIn.gatewayId,
      sourceId: dtoIn.sourceId,
      weighingPointId: evaluatedPoint?.weighingPointId ?? null,
      measuredAt: dtoIn.measuredAt,
      receivedAt,
      authorizationStatus: "verified",
      deliveryState: "acknowledged",
      stockEstimate: evaluatedPoint?.lastValidStockEstimate ?? null,
      measurementStatus:
        evaluatedPoint?.measurementStatus ?? "waitingForMeasurement",
      uuAppErrorMap
    };
  }
}
