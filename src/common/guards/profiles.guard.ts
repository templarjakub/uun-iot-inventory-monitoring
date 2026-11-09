import {
  CanActivate,
  ExecutionContext,
  Injectable
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  ApplicationProfile,
  PROFILES_KEY
} from "../decorators/profiles.decorator";
import { CommandError } from "../utils/uu-app-error";

@Injectable()
export class ProfilesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowedProfiles = this.reflector.getAllAndOverride<ApplicationProfile[]>(
      PROFILES_KEY,
      [context.getHandler(), context.getClass()]
    );

    if (!allowedProfiles || allowedProfiles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const rawHeader = request.headers?.["x-uu-profile"];
    const defaultProfile = allowedProfiles[0];
    const currentProfile = (
      Array.isArray(rawHeader) ? rawHeader[0] : rawHeader || defaultProfile
    ) as ApplicationProfile;

    if (!allowedProfiles.includes(currentProfile)) {
      const commandPath = (request.originalUrl || request.url || "")
        .split("?")[0]
        .replace(/^\//, "");
      throw new CommandError(
        commandPath || "command",
        "notAuthorized",
        `Current application profile '${currentProfile}' is not authorized. Allowed: ${allowedProfiles.join(", ")}.`,
        { currentProfile, allowedProfiles },
        403
      );
    }

    return true;
  }
}
