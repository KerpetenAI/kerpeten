export class ToolLimits {
  public static readonly GLOB_MAX_RESULTS = 1000;

  public static readonly LIST_DIR_MAX_ENTRIES = 500;

  public static readonly READ_FILE_MAX_LINES = 2000;

  public static readonly READ_FILE_MAX_BYTES = 200 * 1024;

  public static readonly READ_FILE_MAX_LINE_CHARS = 2000;

  public static readonly READ_FILE_TAIL_LINES = 100;

  public static readonly LINE_CUT_SUFFIX = `... (line truncated to ${ToolLimits.READ_FILE_MAX_LINE_CHARS} chars)`;
}
