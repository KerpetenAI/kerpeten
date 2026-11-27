export type AuthAction = "login" | "logout" | "status";

export interface AuthInput {
  readonly action: AuthAction;
  readonly models: boolean;
}
