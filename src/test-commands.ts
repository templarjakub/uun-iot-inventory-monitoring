import "reflect-metadata";
import assert from "assert";
import { createApp } from "./main";

async function runTests() {
  console.log("🧪 Starting automated test suite for all 10 BIOT NestJS + Mongoose Commands...\n");
  const app = await createApp();
  await app.listen(0);
  const serverUrl = await app.getUrl();

  async function callCommand(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>
  ) {
    const res = await fetch(`${serverUrl}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    const json = (await res.json()) as any;
    return { statusCode: res.status, json };
  }

  // 1. product/create (BUC-01)
  const res1 = await callCommand("POST", "/product/create", {
    productName: "Podložka pérová M8"
  });
  assert.strictEqual(res1.statusCode, 200, "product/create should return 200");
  const createdProduct = res1.json;
  assert.ok(createdProduct.productId, "product/create should generate productId");
  console.log(
    `✅ 1. product/create -> Created ${createdProduct.productId} (${createdProduct.productName})`
  );

  // 2. product/update (BUC-02, BUC-14)
  const res2 = await callCommand("POST", "/product/update", {
    productId: createdProduct.productId,
    productName: "Podložka pérová M8 (DIN 127)",
    minimumStock: 40
  });
  assert.strictEqual(res2.statusCode, 200, "product/update should return 200");
  assert.strictEqual(res2.json.minimumStockStatus, "unverifiable");
  console.log(
    `✅ 2. product/update -> minimumStock=40, minimumStockStatus=${res2.json.minimumStockStatus}`
  );

  // 7. gateway/register (BUC-07)
  const gwId = `BR-${Math.floor(100 + Math.random() * 899)}`;
  const res7 = await callCommand("POST", "/gateway/register", {
    gatewayId: gwId,
    gatewayName: "Brána montážní linky B"
  });
  assert.strictEqual(res7.statusCode, 200, "gateway/register should return 200");
  assert.strictEqual(res7.json.authorizationStatus, "verified");
  console.log(
    `✅ 7. gateway/register -> Registered ${gwId} (${res7.json.authorizationStatus})`
  );

  // 8. iotNode/connect (BUC-08)
  const nodeId = `UZ-${Math.floor(100 + Math.random() * 899)}`;
  const srcId = `${nodeId}/V1`;
  const res8 = await callCommand("POST", "/iotNode/connect", {
    nodeId,
    nodeName: "Uzel regálu B",
    gatewayId: gwId,
    sourceIds: [srcId]
  });
  assert.strictEqual(res8.statusCode, 200, "iotNode/connect should return 200");
  console.log(`✅ 8. iotNode/connect -> Connected ${nodeId} with source ${srcId}`);

  // 3. weighingPoint/save (BUC-03)
  const wpId = `VM-${Math.floor(100 + Math.random() * 899)}`;
  const res3 = await callCommand("POST", "/weighingPoint/save", {
    weighingPointId: wpId,
    weighingPointName: "Regál B, pozice 1",
    sourceId: srcId
  });
  assert.strictEqual(res3.statusCode, 200, "weighingPoint/save should return 200");
  console.log(`✅ 3. weighingPoint/save -> Saved ${wpId} bound to ${srcId}`);

  // 4. weighingPoint/assignProduct (BUC-04)
  const res4 = await callCommand("POST", "/weighingPoint/assignProduct", {
    weighingPointId: wpId,
    productId: createdProduct.productId
  });
  assert.strictEqual(
    res4.statusCode,
    200,
    "weighingPoint/assignProduct should return 200"
  );
  console.log(
    `✅ 4. weighingPoint/assignProduct -> Assigned ${createdProduct.productId} to ${wpId}`
  );

  // 9a. measurement/ingest – Empty box measurement (100 g) for Tare (BUC-11)
  const tareMeasId = `M-${Date.now()}-TARE`;
  const res9a = await callCommand("POST", "/measurement/ingest", {
    gatewayId: gwId,
    measurementId: tareMeasId,
    sourceId: srcId,
    measuredWeight: 100.0,
    measuredAt: new Date().toISOString(),
    measurementQuality: "validAndStable"
  });
  assert.strictEqual(
    res9a.statusCode,
    200,
    "measurement/ingest (tare) should return 200"
  );
  console.log(
    `✅ 9a. measurement/ingest -> Ingested empty box measurement (${tareMeasId}, 100g)`
  );

  // 5. weighingPoint/confirmTare (BUC-05)
  const res5 = await callCommand("POST", "/weighingPoint/confirmTare", {
    weighingPointId: wpId,
    measurementId: tareMeasId
  });
  assert.strictEqual(
    res5.statusCode,
    200,
    "weighingPoint/confirmTare should return 200"
  );
  assert.strictEqual(res5.json.tareWeight, 100.0);
  console.log(
    `✅ 5. weighingPoint/confirmTare -> Confirmed tareWeight = ${res5.json.tareWeight}g`
  );

  // 9b. measurement/ingest – Sample of 10 pieces (150 g gross -> 50 g net -> 5 g/pc)
  const calMeasId = `M-${Date.now()}-CAL`;
  const res9b = await callCommand("POST", "/measurement/ingest", {
    gatewayId: gwId,
    measurementId: calMeasId,
    sourceId: srcId,
    measuredWeight: 150.0,
    measuredAt: new Date(Date.now() + 1000).toISOString(),
    measurementQuality: "validAndStable"
  });
  assert.strictEqual(
    res9b.statusCode,
    200,
    "measurement/ingest (calibration) should return 200"
  );

  // 6. product/calibrateUnitWeight (BUC-06)
  const res6 = await callCommand("POST", "/product/calibrateUnitWeight", {
    weighingPointId: wpId,
    sampleCount: 10
  });
  assert.strictEqual(
    res6.statusCode,
    200,
    "product/calibrateUnitWeight should return 200"
  );
  assert.strictEqual(res6.json.unitWeight, 5.0);
  console.log(
    `✅ 6. product/calibrateUnitWeight -> Calibrated unitWeight = ${res6.json.unitWeight}g/pc`
  );

  // 10. stockOverview/load (BUC-13, BUC-14)
  const res10 = await callCommand(
    "GET",
    `/stockOverview/load?productId=${createdProduct.productId}`
  );
  assert.strictEqual(res10.statusCode, 200, "stockOverview/load should return 200");
  const overviewItem = res10.json.productList[0];
  assert.strictEqual(overviewItem.stockEstimate, 10);
  assert.strictEqual(overviewItem.minimumStockStatus, "belowMinimum");
  console.log(
    `✅ 10. stockOverview/load -> stockEstimate=${overviewItem.stockEstimate} ks, minimumStock=${overviewItem.minimumStock} ks, status=${overviewItem.minimumStockStatus}`
  );

  await app.close();
  console.log("\n🎉 All 10 BIOT NestJS + Mongoose Commands verified and passed!");
}

runTests().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
