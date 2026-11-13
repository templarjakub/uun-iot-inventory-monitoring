import { Injectable } from "@nestjs/common";
import { IotGatewayDao } from "../../persistence/dao/iot-gateway.dao";
import { IotNodeDao } from "../../persistence/dao/iot-node.dao";
import { MeasurementDao } from "../../persistence/dao/measurement.dao";
import {
  addWarning,
  checkUnsupportedKeys,
  CommandError
} from "../../common/utils/uu-app-error";
import {
  GatewayRegisterDtoIn,
  GatewayRegisterDtoOut,
  IotNodeConnectDtoIn,
  IotNodeConnectDtoOut
} from "./iot.dto";

@Injectable()
export class IotService {
  constructor(
    private readonly iotGatewayDao: IotGatewayDao,
    private readonly iotNodeDao: IotNodeDao,
    private readonly measurementDao: MeasurementDao
  ) {}

  /**
   * 7. Command: gateway/register (BUC-07)
   */
  async registerGateway(
    dtoIn: GatewayRegisterDtoIn,
    rawBody: unknown
  ): Promise<GatewayRegisterDtoOut> {
    // Step 1: Standardní validace dtoIn
    const uuAppErrorMap = checkUnsupportedKeys(
      rawBody,
      ["gatewayId", "gatewayName"],
      "gateway/register"
    );

    // Step 2.1: Ověří jedinečnost gatewayId (zabrání duplicitní registraci) -> jinak Error gatewayAlreadyRegistered
    const existing = await this.iotGatewayDao.get({
      gatewayId: dtoIn.gatewayId
    });
    if (existing) {
      throw new CommandError(
        "gateway/register",
        "gatewayAlreadyRegistered",
        "Gateway with this gatewayId is already registered.",
        { gatewayId: dtoIn.gatewayId },
        400
      );
    }

    // Step 2.2: Uloží registraci a ověří identitu/oprávnění brány; při úspěchu nastaví authorizationStatus = "verified"
    const created = await this.iotGatewayDao.create({
      gatewayId: dtoIn.gatewayId.trim(),
      gatewayName: dtoIn.gatewayName.trim(),
      authorizationStatus: "verified"
    });

    return {
      id: created.id,
      gatewayId: created.gatewayId,
      gatewayName: created.gatewayName,
      authorizationStatus: created.authorizationStatus,
      nodeIds: created.nodeIds,
      uuAppErrorMap
    };
  }

  /**
   * 8. Command: iotNode/connect (BUC-08)
   */
  async connectNode(
    dtoIn: IotNodeConnectDtoIn,
    rawBody: unknown
  ): Promise<IotNodeConnectDtoOut> {
    // Step 1: Standardní validace dtoIn
    const uuAppErrorMap = checkUnsupportedKeys(
      rawBody,
      ["nodeId", "nodeName", "gatewayId", "sourceIds"],
      "iotNode/connect"
    );

    // Step 2.1: Ověří, že cílová gatewayId existuje a je "verified" -> jinak Error gatewayNotVerified
    const gateway = await this.iotGatewayDao.get({
      gatewayId: dtoIn.gatewayId
    });
    if (!gateway || gateway.authorizationStatus !== "verified") {
      throw new CommandError(
        "iotNode/connect",
        "gatewayNotVerified",
        "Target gateway does not exist or its authorization is not verified.",
        { gatewayId: dtoIn.gatewayId },
        400
      );
    }

    // Step 2.2: Ověří globální jedinečnost všech sourceIds napříč uzly -> jinak Error ambiguousSourceId
    const { itemList: allNodes } = await this.iotNodeDao.list();
    const conflictingSourceIds: string[] = [];
    const uniqueInputSources = new Set<string>();
    for (const src of dtoIn.sourceIds) {
      if (uniqueInputSources.has(src)) {
        conflictingSourceIds.push(src);
      }
      uniqueInputSources.add(src);

      const otherNode = allNodes.find(
        (n) => n.nodeId !== dtoIn.nodeId && n.sourceIds.includes(src)
      );
      if (otherNode) {
        conflictingSourceIds.push(src);
      }
    }

    if (conflictingSourceIds.length > 0) {
      throw new CommandError(
        "iotNode/connect",
        "ambiguousSourceId",
        "One or more sourceIds are already bound to another IoT node.",
        { conflictingSourceIds: Array.from(new Set(conflictingSourceIds)) },
        400
      );
    }

    // Step 2.3: Uloží uzel, naváže jej na gateway a ověří přijetí zkušebního měření
    let hasTestMeasurement = false;
    for (const src of dtoIn.sourceIds) {
      const latest = await this.measurementDao.getLatestBySourceId(src);
      if (latest) {
        hasTestMeasurement = true;
        break;
      }
    }

    const measurementStatus = hasTestMeasurement ? "testReceived" : "unverified";
    const existingNode = await this.iotNodeDao.get({ nodeId: dtoIn.nodeId });

    let savedNode;
    if (existingNode) {
      savedNode = await this.iotNodeDao.update(existingNode.id, {
        nodeName: dtoIn.nodeName.trim(),
        gatewayId: dtoIn.gatewayId.trim(),
        sourceIds: dtoIn.sourceIds,
        measurementStatus
      });
    } else {
      savedNode = await this.iotNodeDao.create({
        nodeId: dtoIn.nodeId.trim(),
        nodeName: dtoIn.nodeName.trim(),
        gatewayId: dtoIn.gatewayId.trim(),
        sourceIds: dtoIn.sourceIds,
        measurementStatus
      });
    }

    if (!gateway.nodeIds.includes(dtoIn.nodeId)) {
      await this.iotGatewayDao.update(gateway.id, {
        nodeIds: [...gateway.nodeIds, dtoIn.nodeId]
      });
    }

    if (!hasTestMeasurement) {
      addWarning(
        uuAppErrorMap,
        "iotNode/connect",
        "testMeasurementNotReceived",
        "Node saved, but test measurement has not arrived yet.",
        { nodeId: dtoIn.nodeId }
      );
    }

    const result = savedNode!;
    return {
      id: result.id,
      nodeId: result.nodeId,
      nodeName: result.nodeName,
      gatewayId: result.gatewayId,
      sourceIds: result.sourceIds,
      measurementStatus: result.measurementStatus,
      uuAppErrorMap
    };
  }
}
