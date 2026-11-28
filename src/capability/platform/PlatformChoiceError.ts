/** The platform of the repository cannot be told; the message says how to name it in the configuration. */
export class PlatformChoiceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PlatformChoiceError";
  }
}
