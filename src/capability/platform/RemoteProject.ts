import { terminalLine } from "../../text/text-utils.ts";
import { PlatformError } from "./PlatformError.ts";

/**
 * The project a git remote names: the host of the platform and the path of the project there, read from the URL of
 * the remote. This is the one place that reads such a URL.
 *
 * It reads a URL with a scheme (`https://`, `ssh://`, `git://`), the `git@host:path` form, and git's remote helper
 * form `<helper>::<address>` when the address is itself a URL with a host. The host is in lowercase, without user and
 * without port: the tools of the platforms take a host name only. The path is without the slashes around it and
 * without one `.git` at its end.
 *
 * The URL is outside data and its parts become arguments of a tool. So a host is letters, digits, `.` and `-`, and a
 * path is names of letters, digits, `.`, `_` and `-` joined by `/`, none of them `.` or `..`; anything else, and a
 * URL with a query or a fragment, is a `PlatformError` that shows the host and the path and never a password. The
 * path is checked as it is written in the URL, not as a URL parser would rewrite it.
 */
export class RemoteProject {
  private static readonly NEEDS =
    "a review of a pull request or merge request reads it from the project of the origin remote, so the remote must be the address of a project on GitHub or GitLab";

  private static readonly HELPER = /^([A-Za-z][A-Za-z0-9+.-]*)::(.*)$/s;

  private static readonly SCP_LIKE = /^(?:[^@/\s]+@)?([^:/\s]+):(.*)$/s;

  private static readonly HOST = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

  private static readonly NAME = /^[A-Za-z0-9._-]+$/;

  private static readonly AFTER_PATH = /[?#]/;

  private static readonly SPACE = 0x20;

  private static readonly DELETE = 0x7f;

  private static readonly AUTHORITY = "://";

  private static readonly SHOWN_CHARS = 200;

  public readonly host: string;
  public readonly path: string;

  private constructor(host: string, path: string) {
    this.host = host;
    this.path = path;
  }

  /** The project the remote URL `url` names; a URL that names none throws a `PlatformError`. */
  public static parse(url: string): RemoteProject {
    const helper = RemoteProject.HELPER.exec(url);
    const address = helper === null ? url : (helper[2] ?? "");

    if (helper !== null && !address.includes(RemoteProject.AUTHORITY)) {
      throw RemoteProject.refused(
        `the origin remote uses git's remote helper ${helper[1] ?? ""}, whose address is no URL with a host`,
      );
    }

    if (RemoteProject.hasBlank(address)) {
      throw RemoteProject.refused("the URL of the origin remote has a space or a control character in it");
    }

    if (address.includes(RemoteProject.AUTHORITY)) return RemoteProject.fromUrl(address);

    const scp = RemoteProject.SCP_LIKE.exec(address);

    if (scp === null) throw RemoteProject.refused("the origin remote is a path on this machine");

    const [, host = "", path = ""] = scp;

    if (RemoteProject.AFTER_PATH.test(path)) throw RemoteProject.withQuery();

    return RemoteProject.checked(host, path);
  }

  /** Whether the text has a space or an ASCII control character in it. */
  private static hasBlank(text: string): boolean {
    for (let at = 0; at < text.length; at++) {
      const code = text.charCodeAt(at);

      if (code <= RemoteProject.SPACE || code === RemoteProject.DELETE) return true;
    }

    return false;
  }

  private static fromUrl(text: string): RemoteProject {
    let url: URL;

    try {
      url = new URL(text);
    } catch {
      throw RemoteProject.refused("the URL of the origin remote cannot be read");
    }

    if (url.hostname === "") throw RemoteProject.refused("the origin remote is a path on this machine");
    if (url.search !== "" || url.hash !== "") throw RemoteProject.withQuery();

    const path = text.indexOf("/", text.indexOf(RemoteProject.AUTHORITY) + RemoteProject.AUTHORITY.length);

    return RemoteProject.checked(url.hostname, path < 0 ? "" : text.slice(path));
  }

  private static checked(rawHost: string, rawPath: string): RemoteProject {
    const host = rawHost.toLowerCase();

    const path = rawPath
      .replace(/^\/+/, "")
      .replace(/\/+$/, "")
      .replace(/\.git$/, "");

    if (!RemoteProject.HOST.test(host)) {
      throw RemoteProject.refused(
        `the origin remote is on ${RemoteProject.shown(host)}, which is no host name of letters, digits, \`.\` and \`-\``,
      );
    }

    const names = path.split("/");

    if (names.some((name) => !RemoteProject.NAME.test(name) || name === "." || name === "..")) {
      throw RemoteProject.refused(
        `the origin remote names ${host}/${RemoteProject.shown(path)}, which cannot be the path of a project: a path is names of letters, digits, \`.\`, \`_\` and \`-\` joined by \`/\``,
      );
    }

    return new RemoteProject(host, path);
  }

  private static withQuery(): PlatformError {
    return RemoteProject.refused(
      "the URL of the origin remote has a query or a fragment, which the address of a project does not have",
    );
  }

  private static refused(reason: string): PlatformError {
    return new PlatformError("no_repository", `${reason}: ${RemoteProject.NEEDS}`);
  }

  private static shown(text: string): string {
    return JSON.stringify(terminalLine(text).slice(0, RemoteProject.SHOWN_CHARS));
  }

  /** The project as a message shows it: `<host>/<path>`. */
  public get name(): string {
    return `${this.host}/${this.path}`;
  }

  /** The names the path is made of: the owner and the repository on GitHub, the groups and the project on GitLab. */
  public get names(): readonly string[] {
    return this.path.split("/");
  }

  /** The path as one segment of a URL path, as GitLab's API takes a project. */
  public get segment(): string {
    return encodeURIComponent(this.path);
  }

  /** Whether `path` is the path of this project; the platforms do not tell upper from lower case in a path. */
  public is(path: string): boolean {
    return path.toLowerCase() === this.path.toLowerCase();
  }
}
