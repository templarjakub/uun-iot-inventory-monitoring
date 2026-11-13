import { Injectable } from "@nestjs/common";
import { env } from "../../common/config/env";
import { Product } from "../schemas/product.schema";
import { StoreService, generateObjectId } from "../store.service";

@Injectable()
export class ProductDao {
  constructor(private readonly store: StoreService) {}

  async create(data: { productName: string }): Promise<Product> {
    const all = await this.store.list("product");
    const nextNum = all.length + 1;
    let productId = `PRD-${String(nextNum).padStart(3, "0")}`;
    while (all.some((p) => p.productId === productId)) {
      productId = `PRD-${String(Math.floor(100 + Math.random() * 900))}`;
    }
    const now = new Date().toISOString();
    const entity: Product = {
      id: generateObjectId(),
      awid: env.AWID,
      productId,
      productName: data.productName,
      unitWeight: null,
      minimumStock: null,
      sys: { cts: now, mts: now, rev: 0 }
    };
    return this.store.insert("product", entity);
  }

  async get(filter: { id?: string; productId?: string }): Promise<Product | null> {
    const all = await this.store.list("product");
    return (
      all.find(
        (p) =>
          (filter.id && p.id === filter.id) ||
          (filter.productId && p.productId === filter.productId)
      ) ?? null
    );
  }

  async list(): Promise<{ itemList: Product[] }> {
    const itemList = await this.store.list("product");
    return { itemList };
  }

  async update(
    id: string,
    patch: Partial<Pick<Product, "productName" | "unitWeight" | "minimumStock">>
  ): Promise<Product | null> {
    return this.store.update("product", id, (existing) => ({
      ...existing,
      ...patch
    }));
  }

  async delete(id: string): Promise<void> {
    await this.store.delete("product", id);
  }
}
