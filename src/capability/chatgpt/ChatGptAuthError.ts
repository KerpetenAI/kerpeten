/** A ChatGPT sign-in problem whose message says what to do. It never holds a token or an authorization code. */
export class ChatGptAuthError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ChatGptAuthError";
  }
}
