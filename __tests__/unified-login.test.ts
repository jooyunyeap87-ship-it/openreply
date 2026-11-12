import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMissingInstagramOAuthEnv, isUnifiedLogin } from "../lib/env";
import { exchangeCodeForToken, getAuthorizationUrl } from "../lib/meta/oauth";
import { getUserInfo, getUserMedia } from "../lib/meta/client";

beforeEach(() => {
  vi.stubEnv("NEXTAUTH_SECRET", "test-secret-with-enough-length");
  vi.stubEnv(
    "ENCRYPTION_KEY",
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  );
  vi.stubEnv("META_LOGIN_MODE", "unified");
  vi.stubEnv("FACEBOOK_APP_ID", "fb-app-1");
  vi.stubEnv("FACEBOOK_APP_SECRET", "fb-secret");
  vi.stubEnv("META_LOGIN_CONFIG_ID", "cfg-9");
  vi.stubEnv("META_GRAPH_API_VERSION", "v25.0");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Unified login", () => {
  it("is off unless META_LOGIN_MODE=unified", () => {
    expect(isUnifiedLogin()).toBe(true);
    vi.stubEnv("META_LOGIN_MODE", "");
    expect(isUnifiedLogin()).toBe(false);
  });

  it("requires the Facebook app and config id instead of the Instagram app", () => {
    expect(getMissingInstagramOAuthEnv()).toEqual([]);
    vi.stubEnv("META_LOGIN_CONFIG_ID", "");
    expect(getMissingInstagramOAuthEnv()).toEqual(["META_LOGIN_CONFIG_ID"]);
  });

  it("builds the Facebook Login for Business dialog with the config id", () => {
    const url = new URL(getAuthorizationUrl("https://x.test/api/instagram/callback", "st"));
    expect(url.origin + url.pathname).toBe("https://www.facebook.com/dialog/oauth");
    expect(url.searchParams.get("client_id")).toBe("fb-app-1");
    expect(url.searchParams.get("config_id")).toBe("cfg-9");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("scope")).toBeNull();
  });

  it("exchanges the code on graph.facebook.com", async () => {
    const fetchMock = vi.fn(async (_input: string | URL) =>
      new Response(JSON.stringify({ access_token: "bisu" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await exchangeCodeForToken("c0de", "https://x.test/cb");
    expect(result.accessToken).toBe("bisu");
    const called = new URL(String(fetchMock.mock.calls[0][0]));
    expect(called.host).toBe("graph.facebook.com");
    expect(called.pathname).toBe("/v25.0/oauth/access_token");
    expect(called.searchParams.get("client_secret")).toBe("fb-secret");
  });

  it("reads the account and media through the assigned Instagram account id", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/me/assigned_instagram_accounts")) {
        return new Response(JSON.stringify({ data: [{ id: "1784", username: "jay" }] }));
      }
      if (url.pathname.endsWith("/1784/media")) {
        return new Response(JSON.stringify({ data: [{ id: "m1" }] }));
      }
      if (url.pathname.endsWith("/1784")) {
        return new Response(JSON.stringify({ id: "1784", username: "jay" }));
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const info = await getUserInfo("tok-a");
    expect(info.user_id).toBe("1784");
    expect(info.username).toBe("jay");

    const media = await getUserMedia("tok-a");
    expect(media.map((m) => m.id)).toEqual(["m1"]);
    for (const [input] of fetchMock.mock.calls) {
      expect(new URL(String(input)).host).toBe("graph.facebook.com");
    }
  });
});
