import { isJsonObject, isStringList, type JsonValue } from "./json";

export type User = {
  admin: boolean;
  avatar: string | null;
  id: string;
  name: string;
  permissions: string[];
};

export type Viewer = User & { expires: number };

export type Session = {
  delaySeconds: number;
  streamConfigured: boolean;
  streamUrl: string;
  user: User;
};

export type RolePermissions = { [roleId: string]: string[] };

export function isRolePermissions(value: JsonValue): value is RolePermissions {
  return isJsonObject(value) && Object.values(value).every(isStringList);
}
