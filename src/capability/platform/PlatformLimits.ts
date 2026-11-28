/**
 * The budget of one read of a platform's command line tool. A list of a merge request with thousands of comments
 * stays far below both limits; they are there so that an answer without an end cannot fill the memory or hold the
 * review for ever.
 */
export class PlatformLimits {
  public static readonly READ_BYTES = 20_000_000;

  public static readonly READ_MS = 120_000;
}
