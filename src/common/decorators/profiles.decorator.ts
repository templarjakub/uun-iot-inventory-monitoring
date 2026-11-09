import { SetMetadata } from "@nestjs/common";

/**
 * Application Profiles defined in BIOT DL Application Model - Tým 4 (Profiles):
 * - Authorities (Správce)
 * - Readers (Skladník)
 * - Gateways (Gateway)
 */
export type ApplicationProfile = "Authorities" | "Readers" | "Gateways";

export const PROFILES_KEY = "uu_application_profiles";

export const Profiles = (...profiles: ApplicationProfile[]) =>
  SetMetadata(PROFILES_KEY, profiles);
