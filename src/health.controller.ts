import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { StoreService } from "./persistence/store.service";

@ApiTags("0. System & Health")
@Controller()
export class HealthController {
  constructor(private readonly storeService: StoreService) {}

  @Get("health")
  @ApiOperation({
    summary: "Health check endpoint for cloud deployment (Render / IoT Gateway)"
  })
  @ApiOkResponse({
    schema: {
      example: {
        status: "ok",
        service: "biot-inventory-backend",
        storage: "mongodb",
        connected: true,
        timestamp: "2026-11-23T15:00:00.000Z"
      }
    }
  })
  getHealth() {
    const storage = this.storeService.getStorageInfo();
    return {
      status: storage.connected ? "ok" : "degraded",
      service: "biot-inventory-backend",
      storage: storage.mode,
      connected: storage.connected,
      timestamp: new Date().toISOString()
    };
  }
}
