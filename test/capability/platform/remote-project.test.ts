import { describe, expect, test } from "bun:test";
import { PlatformError } from "../../../src/capability/platform/PlatformError.ts";
import { RemoteProject } from "../../../src/capability/platform/RemoteProject.ts";

const NEEDS =
  "a review of a pull request or merge request reads it from the project of the origin remote, so the remote must be the address of a project on GitHub or GitLab";

function refusal(url: string): string {
  try {
    RemoteProject.parse(url);
  } catch (error) {
    if (error instanceof PlatformError && error.kind === "no_repository") return error.message;

    throw error;
  }

  throw new Error(`${url} was read as a project`);
}

describe("remote project", () => {
  const read: [string, string, string][] = [
    ["https://github.com/Acme/Shop.git", "github.com", "Acme/Shop"],
    ["https://github.com/Acme/Shop", "github.com", "Acme/Shop"],
    ["https://github.com/Acme/Shop.git/", "github.com", "Acme/Shop"],
    ["https://github.com//Acme/Shop//", "github.com", "Acme/Shop"],
    ["http://GitHub.COM/Acme/Shop.git", "github.com", "Acme/Shop"],
    ["ssh://git@github.com/Acme/Shop.git", "github.com", "Acme/Shop"],
    ["ssh://git@GitLab.com:2222/acme/group/shop.git", "gitlab.com", "acme/group/shop"],
    ["git://gitlab.com/acme/shop.git", "gitlab.com", "acme/shop"],
    ["git@github.com:Acme/Shop.git", "github.com", "Acme/Shop"],
    ["git@gitlab.com:acme/group/sub-group/shop.git", "gitlab.com", "acme/group/sub-group/shop"],
    ["git@gitlab.com:/acme/shop.git", "gitlab.com", "acme/shop"],
    ["gitlab.com:acme/shop", "gitlab.com", "acme/shop"],
    ["GIT@GITHUB.COM:Acme/Shop.git", "github.com", "Acme/Shop"],
    ["https://oauth2:not-a-token@gitlab.com/acme/shop.git", "gitlab.com", "acme/shop"],
    ["https://git.example.com:8443/acme/shop.git", "git.example.com", "acme/shop"],
    ["https://10.0.0.7/acme/shop.git", "10.0.0.7", "acme/shop"],
    ["https://gitlab.com/acme/my_shop.v2-x.git", "gitlab.com", "acme/my_shop.v2-x"],
    ["https://github.com/Acme/Shop.git.git", "github.com", "Acme/Shop.git"],
  ];

  for (const [url, host, path] of read) {
    test(`${url} names ${path} on ${host}`, () => {
      const project = RemoteProject.parse(url);

      expect({ host: project.host, path: project.path, name: project.name }).toEqual({
        host,
        path,
        name: `${host}/${path}`,
      });
    });
  }

  test("git's remote helper form is read when its address is a URL with a host", () => {
    const helped: [string, string, string][] = [
      ["https::https://gitlab.com/acme/shop.git", "gitlab.com", "acme/shop"],
      ["ssh::ssh://git@gitlab.com/acme/shop.git", "gitlab.com", "acme/shop"],
      ["helper-1.x+y::https://GitHub.com/Acme/Shop", "github.com", "Acme/Shop"],
    ];

    for (const [url, host, path] of helped) {
      expect(RemoteProject.parse(url)).toMatchObject({ host, path });
    }
  });

  test("a remote helper whose address is no URL with a host names no project", () => {
    expect(refusal("ext::ssh -q git@gitlab.com %S acme/shop")).toBe(
      `the origin remote uses git's remote helper ext, whose address is no URL with a host: ${NEEDS}`,
    );

    expect(refusal("codecommit::eu-west-1://shop")).toStartWith('the origin remote names shop/"", which cannot be');

    expect(refusal("persistent-https::gitlab.com/acme/shop")).toStartWith(
      "the origin remote uses git's remote helper persistent-https, whose address is no URL with a host: ",
    );

    expect(refusal("https::file:///srv/git/shop.git")).toBe(`the origin remote is a path on this machine: ${NEEDS}`);
  });

  test("a path on this machine names no project", () => {
    for (const url of ["/srv/git/shop.git", "../shop.git", "./a:b/shop.git", "file:///srv/git/shop.git", "shop"]) {
      expect(refusal(url)).toBe(`the origin remote is a path on this machine: ${NEEDS}`);
    }
  });

  test("a path that cannot be the path of a project is refused, with the host and the path and never a password", () => {
    const refused: [string, string][] = [
      ["git@github.com:Acme/Shop/../../user", '"Acme/Shop/../../user"'],
      ["ssh://git@github.com/Acme/Shop/../Other", '"Acme/Shop/../Other"'],
      ["https://github.com/Acme/Shop/../Other", '"Acme/Shop/../Other"'],
      ["https://github.com/Acme/Shop/%2e%2e/Other", '"Acme/Shop/%2e%2e/Other"'],
      ["https://github.com\\Acme\\Shop", '""'],
      ["https://github.com/Acme/Shop?", '"Acme/Shop?"'],
      ["https://github.com/Acme/Shop%2F..%2F..", '"Acme/Shop%2F..%2F.."'],
      ["https://user:hunter2@github.com/Acme/Sh%20op", '"Acme/Sh%20op"'],
      ["git@github.com:{owner}/{repo}", '"{owner}/{repo}"'],
      ["git@github.com::fullpath", '":fullpath"'],
      ["git@github.com:Acme/./Shop", '"Acme/./Shop"'],
      ["git@github.com:Acme//Shop", '"Acme//Shop"'],
      ["git@github.com:Acme/Shop;rm", '"Acme/Shop;rm"'],
      ["git@github.com:Acme/Şhop", '"Acme/Şhop"'],
      ["git@github.com:Acme/Shop\u0080", '"Acme/Shop�"'],
      ["https://github.com/", '""'],
      ["https://github.com", '""'],
    ];

    for (const [url, shown] of refused) {
      const message = refusal(url);

      expect(message).toBe(
        `the origin remote names github.com/${shown}, which cannot be the path of a project: a path is names of letters, digits, \`.\`, \`_\` and \`-\` joined by \`/\`: ${NEEDS}`,
      );

      expect(message).not.toContain("hunter2");
    }
  });

  test("a space or a control character is refused, so nothing of the remote can become a second argument", () => {
    const blank = `the URL of the origin remote has a space or a control character in it: ${NEEDS}`;

    for (const url of [
      "git@github.com:Acme/Shop --method DELETE",
      "https://github.com/Acme/Shop --jq .",
      "https://git\nhub.com/Acme/Shop",
      "https://github.com/Acme/Shop\trepos/Other/Shop",
      "git@github.com:Acme/Shop\u001b[31m",
      "https::https://github.com/Acme/Shop -X DELETE",
    ]) {
      expect(refusal(url)).toBe(blank);
    }
  });

  test("a query or a fragment is refused and never shown", () => {
    const withQuery = `the URL of the origin remote has a query or a fragment, which the address of a project does not have: ${NEEDS}`;

    for (const url of [
      "https://github.com/Acme/Shop?token=hunter2",
      "https://github.com/Acme/Shop.git#hunter2",
      "git@github.com:Acme/Shop?per_page=hunter2",
      "git@github.com:Acme/Shop#hunter2",
      "https::https://github.com/Acme/Shop?x=hunter2",
    ]) {
      expect(refusal(url)).toBe(withQuery);
    }
  });

  test("a host that is no host name is refused", () => {
    const refused: [string, string][] = [
      ["git@-oProxyCommand=evil:Acme/Shop", '"-oproxycommand=evil"'],
      ["--hostname=evil.example:Acme/Shop", '"--hostname=evil.example"'],
      ["https://[::1]/Acme/Shop", '"[::1]"'],
      ["git@git_hub.com:Acme/Shop", '"git_hub.com"'],
      ["git@github.com.:Acme/Shop", '"github.com."'],
    ];

    for (const [url, shown] of refused) {
      expect(refusal(url)).toBe(
        `the origin remote is on ${shown}, which is no host name of letters, digits, \`.\` and \`-\`: ${NEEDS}`,
      );
    }
  });

  test("a URL that cannot be read is refused without showing it", () => {
    expect(refusal("https://user:hunter2@/Acme/Shop")).not.toContain("hunter2");
    expect(refusal("https://user:hunter2@exa mple.com/Acme/Shop")).not.toContain("hunter2");
  });

  test("the path is one segment for GitLab, its names apart for GitHub, and compared without case", () => {
    const project = RemoteProject.parse("git@gitlab.com:Acme/Group/Shop.git");

    expect(project.segment).toBe("Acme%2FGroup%2FShop");
    expect(project.names).toEqual(["Acme", "Group", "Shop"]);
    expect(project.is("acme/group/shop")).toBe(true);
    expect(project.is("ACME/GROUP/SHOP")).toBe(true);
    expect(project.is("acme/group")).toBe(false);
    expect(project.is("acme/group/shop/x")).toBe(false);
  });
});
