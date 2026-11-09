# IoT Inventory Monitoring

A semester project developed at Unicorn University for the Internet of Things course (`BIOT – Tým 4`).

## Overview

The project aims to develop an IoT-based inventory monitoring system for small parts and materials, such as screws, nuts, and bolts.

The system estimates the number of items in storage containers using weight measurements. Multiple weighing stations can track the same product, allowing inventory quantities to be aggregated automatically.

## Key Features

- Automatic inventory estimation based on weight
- Calibration using a known number of items
- Support for multiple products and weighing stations
- Aggregated inventory across multiple containers
- Low-stock indicators
- Measurement availability and freshness monitoring

## Architecture

The solution consists of three main components:

- **IoT Nodes** – Collect weight measurements (`ESP32 + HX711 + Load Cell`)
- **Gateway** – Processes, persists in a local SQLite queue, and forwards measurements
- **Cloud Application** – Stores data and provides inventory management

---

## Tech Stack & Architecture Decisions (`Základní implementace backendu`)

The backend combines **Option B (Enterprise NestJS Modularity)** and **Option C (Formal Mongoose `@Schema()` / `@Prop()` ODM Models)** so every layer of `BIOT DL Application Model - Tým 4` has a dedicated, easy-to-read class:

| Layer | Technology | Why It Was Chosen |
| :--- | :--- | :--- |
| **Application Framework** | **NestJS 10 + TypeScript (`@Module`, `@Controller`, `@Injectable`)** | Clean separation between HTTP route declarations (`*.controller.ts`) and pure business logic steps (`*.service.ts`). |
| **Persistence & ODM** | **Mongoose 8 + `@nestjs/mongoose` (`@Schema`, `@Prop`)** | Formal ODM Schema classes for all 5 entities (`Product`, `WeighingPoint`, `Measurement`, `IotNode`, `IotGateway`) and `@Injectable()` DAO classes. Connects to **MongoDB Atlas (Free M0)** in the cloud or automatically uses local Mongoose-validated JSON storage (`./data/biot-store.json`) with zero setup. |
| **Validation & DTOs** | **`class-validator` + `class-transformer`** | Declarative DTO classes (`*.dto.ts`) enforcing `dtoInValidationSchema` rules and automatically formatting `invalidDtoIn` in `uuAppErrorMap`. |
| **Interactive API Docs** | **OpenAPI 3.0 + `@nestjs/swagger` (`/docs`)** | Pre-populated interactive Swagger UI at `http://localhost:3000/docs` where anyone can inspect and execute all 10 Commands with 1 click. |
| **Authorization & Errors** | **NestJS `@Profiles()` Guard & `UuAppExceptionFilter`** | Enforces `Authorities`, `Readers`, and `Gateways` profiles and formats every error/warning into the standard `uuAppErrorMap`. |

---

## Project Structure (1:1 Mapping to `BIOT DL Application Model - Tým 4`)

```text
src/
├── main.ts                                 # NestJS bootstrap + Swagger UI (/docs)
├── app.module.ts                           # Root NestJS Module
├── common/
│   ├── decorators/profiles.decorator.ts    # @Profiles('Authorities', 'Readers', 'Gateways')
│   ├── guards/profiles.guard.ts            # Application Profile authorization guard
│   ├── filters/uu-app-exception.filter.ts  # Standard uuAppErrorMap exception filter
│   └── utils/uu-app-error.ts               # CommandError & unsupportedKeys helper
├── persistence/                            # Persistence Layer (Mongoose Schemas + DAOs)
│   ├── schemas/                            # 5 @Schema() classes matching Persistence Layer.pdf
│   │   ├── product.schema.ts
│   │   ├── weighing-point.schema.ts
│   │   ├── measurement.schema.ts
│   │   ├── iot-node.schema.ts
│   │   └── iot-gateway.schema.ts
│   └── dao/                                # 5 @Injectable() DAO classes matching DAO Method List
│       ├── product.dao.ts
│       ├── weighing-point.dao.ts
│       ├── measurement.dao.ts
│       ├── iot-node.dao.ts
│       └── iot-gateway.dao.ts
└── modules/                                # 5 Feature Modules (Controllers + Services + DTOs)
    ├── product/                            # Commands 1, 2, 6 (product/create, update, calibrateUnitWeight)
    ├── weighing-point/                     # Commands 3, 4, 5 (weighingPoint/save, assignProduct, confirmTare)
    ├── iot/                                # Commands 7, 8 (gateway/register, iotNode/connect)
    ├── measurement/                        # Command 9 (measurement/ingest)
    └── stock-overview/                     # Command 10 (stockOverview/load) + BUC-12/BUC-14 evaluation
```

---

## Quick Start (Local Review – Zero Database Setup Required)

When `MONGODB_URI` is not set, the backend validates all documents against the **Mongoose Schemas** and persists them to `./data/biot-store.json` (pre-seeded with `PRD-001 Šroub M6 × 20 mm`, `VM-001`, `UZ-001`, `BR-001`).

```bash
npm install
npm run dev
```

- **Interactive Swagger / OpenAPI UI**: Open `http://localhost:3000/docs` in your browser to test every Command with 1 click.
- **Automated End-to-End Command Tests**:
  ```bash
  npm test
  ```

---

## Free Cloud Deployment (0 Kč – MongoDB Atlas M0 + Render.com)

1. **Free Database (`MongoDB Atlas M0`)**: Create a free 512 MB cluster at [mongodb.com/atlas](https://www.mongodb.com/atlas) (no credit card required) and copy the connection string into `MONGODB_URI`.
2. **Free Web Service (`Render.com`)**: Connect this GitHub repository on [render.com](https://render.com) (automatically uses `render.yaml`) and set `MONGODB_URI` in the Environment settings.
